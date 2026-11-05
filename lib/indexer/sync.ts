import type { Pool, PoolClient } from "pg";
import type { Address } from "viem";
import { decodeTransfers, type TokenStandard, type Transfer } from "./events";
import type { ChainBlock, ChainReader } from "./reader";

export const INDEXER_CHAIN_ID = 18881;
type RegistryRow = { contract_address: string; token_standard: TokenStandard; deployment_block: string };
type StateRow = { start_block: string; last_block: string; last_hash: string };

export type ScanResult = {
  chainId: 18881; status: "no-collections" | "not-yet-final" | "scanned";
  lastBlock: string | null; scannedBlocks: number; transferItems: number; rolledBackBlocks: number;
};

function checkBlock(block: ChainBlock, height: bigint) {
  if (block.number !== height || !/^0x[0-9a-fA-F]{64}$/.test(block.hash) ||
      !/^0x[0-9a-fA-F]{64}$/.test(block.parentHash)) throw new Error("RPC returned an invalid block");
}
function bigintOption(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid " + name);
  return BigInt(value);
}
async function putBlock(db: PoolClient, block: ChainBlock) {
  await db.query(
    "INSERT INTO nft_indexer_blocks(chain_id,block_number,block_hash,parent_hash) VALUES($1,$2,$3,$4)",
    [INDEXER_CHAIN_ID, block.number.toString(), block.hash.toLowerCase(), block.parentHash.toLowerCase()],
  );
}
async function putTransfer(db: PoolClient, item: Transfer): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO nft_token_transfers(chain_id,contract_address,token_standard,block_number,block_hash,tx_hash,tx_index,log_index,item_index,token_id,from_address,to_address,amount)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING tx_hash`,
    [INDEXER_CHAIN_ID, item.contract, item.standard, item.blockNumber.toString(), item.blockHash, item.txHash,
      item.txIndex, item.logIndex, item.itemIndex, item.tokenId, item.from, item.to, item.amount],
  );
  if (result.rowCount === 0) throw new Error("Duplicate or conflicting event inside a single indexed block");
  return true;
}

/**
 * One bounded scan step, under an advisory + row lock. The index is a projection
 * of the canonical event journal. Deleting orphan blocks cascades orphan transfers,
 * so ERC-721/1155 ownership queries automatically roll back with chain reorganisations.
 */
export async function scanOnce(
  reader: ChainReader, pool: Pool,
  options: { startBlock: bigint; confirmations?: number; maxBlocks?: number },
): Promise<ScanResult> {
  if (await reader.chainId() !== INDEXER_CHAIN_ID) throw new Error("Wrong chain; Ultra EVM Testnet only");
  if (options.startBlock < 1n) throw new Error("startBlock must be at least 1");
  const confirmations = bigintOption(options.confirmations ?? 12, 1, 256, "confirmation depth");
  const maxBlocks = Number(bigintOption(options.maxBlocks ?? 25, 1, 200, "batch length"));
  const head = await reader.head();
  if (head < confirmations) return { chainId: INDEXER_CHAIN_ID, status: "not-yet-final", lastBlock: null, scannedBlocks: 0, transferItems: 0, rolledBackBlocks: 0 };
  const finalized = head - confirmations;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Serialise all indexer runners and operator collection additions for this chain.
    await db.query("SELECT pg_advisory_xact_lock($1)", [INDEXER_CHAIN_ID]);
    const reg = await db.query<RegistryRow>(
      "SELECT contract_address, token_standard, deployment_block FROM nft_collections WHERE chain_id=$1 ORDER BY contract_address",
      [INDEXER_CHAIN_ID],
    );
    if (reg.rows.length === 0) {
      await db.query("COMMIT");
      return { chainId: INDEXER_CHAIN_ID, status: "no-collections", lastBlock: null, scannedBlocks: 0, transferItems: 0, rolledBackBlocks: 0 };
    }
    if (reg.rows.some((c) => BigInt(c.deployment_block) < options.startBlock)) {
      throw new Error("Indexer startBlock is later than a registered collection's deployment block");
    }
    let state = await db.query<StateRow>(
      "SELECT start_block,last_block,last_hash FROM nft_indexer_state WHERE chain_id=$1 FOR UPDATE", [INDEXER_CHAIN_ID],
    );
    if (state.rowCount === 0) {
      const anchorHeight = options.startBlock - 1n;
      if (anchorHeight > finalized) throw new Error("Indexer startBlock is above current finalized height");
      const anchor = await reader.block(anchorHeight);
      checkBlock(anchor, anchorHeight);
      await putBlock(db, anchor);
      await db.query(
        "INSERT INTO nft_indexer_state(chain_id,start_block,last_block,last_hash) VALUES($1,$2,$3,$4)",
        [INDEXER_CHAIN_ID, options.startBlock.toString(), anchor.number.toString(), anchor.hash.toLowerCase()],
      );
      state = { rows: [{ start_block: options.startBlock.toString(), last_block: anchorHeight.toString(), last_hash: anchor.hash.toLowerCase() }], rowCount: 1 } as typeof state;
    }
    const current = state.rows[0];
    if (BigInt(current.start_block) !== options.startBlock) throw new Error("Configured startBlock changed: explicit rescan required");
    let cursor = BigInt(current.last_block);
    let cursorHash = current.last_hash;
    let rolledBackBlocks = 0;
    const anchorHeight = options.startBlock - 1n;
    // Verify current persisted tip against RPC before scanning. Fail closed
    // when the fork goes below the anchor, instead of inventing older history.
    while (true) {
      const live = cursor <= head ? await reader.block(cursor) : null;
      if (live) checkBlock(live, cursor);
      if (live?.hash.toLowerCase() === cursorHash && cursor <= finalized) break;
      if (cursor <= anchorHeight) throw new Error("Reorg crossed indexer anchor; operator must perform a full rescan");
      await db.query("DELETE FROM nft_indexer_blocks WHERE chain_id=$1 AND block_number=$2", [INDEXER_CHAIN_ID, cursor.toString()]);
      cursor -= 1n;
      rolledBackBlocks++;
      const last = await db.query<{ block_hash: string }>(
        "SELECT block_hash FROM nft_indexer_blocks WHERE chain_id=$1 AND block_number=$2",
        [INDEXER_CHAIN_ID, cursor.toString()],
      );
      if (!last.rows[0]) throw new Error("Missing indexer ancestor; operator rescan required");
      cursorHash = last.rows[0].block_hash;
    }
    let scannedBlocks = 0;
    let transferItems = 0;
    for (let height = cursor + 1n; height <= finalized && scannedBlocks < maxBlocks; height++) {
      const block = await reader.block(height);
      checkBlock(block, height);
      if (block.parentHash.toLowerCase() !== cursorHash) throw new Error("Chain changed while scanning; retry with canonical blocks");
      const active = reg.rows.filter((c) => BigInt(c.deployment_block) <= height);
      const byAddress = new Map(active.map((c) => [c.contract_address, c.token_standard]));
      const logs = await reader.logs(height, active.map((c) => c.contract_address as Address));
      // Validate all returned RPC logs belong to the requested block and approved contracts.
      const items: Transfer[] = [];
      for (const log of logs) {
        const standard = byAddress.get(log.address.toLowerCase());
        if (!standard || log.blockNumber !== height || log.blockHash?.toLowerCase() !== block.hash.toLowerCase())
          throw new Error("RPC returned an unapproved, wrong-block or wrong-hash event");
        items.push(...decodeTransfers(log, standard));
      }
      await putBlock(db, block);
      for (const item of items) {
        await putTransfer(db, item);
        transferItems++;
      }
      cursor = height;
      cursorHash = block.hash.toLowerCase();
      scannedBlocks++;
    }
    await db.query(
      "UPDATE nft_indexer_state SET last_block=$2,last_hash=$3,updated_at=now() WHERE chain_id=$1",
      [INDEXER_CHAIN_ID, cursor.toString(), cursorHash],
    );
    await db.query("COMMIT");
    return { chainId: INDEXER_CHAIN_ID, status: "scanned", lastBlock: cursor.toString(), scannedBlocks, transferItems, rolledBackBlocks };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { db.release(); }
}
