import type { Pool } from "pg";
import { isAddress, type Address } from "viem";
import type { ChainReader } from "./reader";
import { decodeTransfers } from "./events";
import { INDEXER_CHAIN_ID } from "./sync";

export type VerificationResult = {
  source: "live-rpc-and-blockscout";
  chainId: 18881; verifiedHeight: string; hash: string;
  matchedTransferItems: number; sampleTxHash: string | null;
  blockExplorer: string; scope: "block-only" | "block-and-token-event";
};

type RegistryRow = { contract_address: string; token_standard: "erc721" | "erc1155" };
type StoredTransfer = {
  contract_address: string; token_standard: "erc721" | "erc1155";
  tx_hash: string; log_index: number; item_index: number; token_id: string;
  amount: string; from_address: string; to_address: string;
};

function canonicalEvents(logs: Awaited<ReturnType<ChainReader["logs"]>>, byAddress: Map<string, "erc721" | "erc1155">) {
  const actual: string[] = [];
  for (const log of logs) {
    const standard = byAddress.get(log.address.toLowerCase());
    if (!standard) throw new Error("Independent RPC included an unregistered address");
    for (const e of decodeTransfers(log, standard)) {
      actual.push([e.contract, e.txHash, e.logIndex, e.itemIndex, e.tokenId, e.amount, e.from, e.to].join(":"));
    }
  }
  return actual.sort();
}
function canonicalDb(e: StoredTransfer): string {
  return [e.contract_address, e.tx_hash, e.log_index, e.item_index, e.token_id, e.amount, e.from_address, e.to_address].join(":");
}

/** Requires 2 independently hosted RPCs and real Blockscout block hash evidence. */
export async function verifyIndependentSources(
  db: Pool, primary: ChainReader, independent: ChainReader,
  explorer: (height: bigint) => Promise<{ hash: string }>,
): Promise<VerificationResult> {
  if (await primary.chainId() !== 18881 || await independent.chainId() !== 18881)
    throw new Error("Independent comparison requires two Ultra EVM Testnet RPC endpoints");
  const last = await db.query<{ last_block: string; last_hash: string; start_block: string }>(
    "SELECT last_block,last_hash,start_block FROM nft_indexer_state WHERE chain_id=$1", [INDEXER_CHAIN_ID],
  );
  if (!last.rows[0] || BigInt(last.rows[0].last_block) < BigInt(last.rows[0].start_block))
    throw new Error("No indexed blocks to independently verify");
  const sample = await db.query<{ block_number: string; tx_hash: string }>(
    "SELECT block_number,tx_hash FROM nft_token_transfers WHERE chain_id=18881 ORDER BY block_number DESC,tx_index DESC LIMIT 1",
  );
  const height = sample.rows[0] ? BigInt(sample.rows[0].block_number) : BigInt(last.rows[0].last_block);
  const indexed = await db.query<{ block_hash: string }>(
    "SELECT block_hash FROM nft_indexer_blocks WHERE chain_id=18881 AND block_number=$1", [height.toString()],
  );
  if (!indexed.rows[0]) throw new Error("Indexed block checkpoint is missing");
  const [a, b, e] = await Promise.all([primary.block(height), independent.block(height), explorer(height)]);
  if (a.hash.toLowerCase() !== indexed.rows[0].block_hash ||
      b.hash.toLowerCase() !== indexed.rows[0].block_hash ||
      e.hash.toLowerCase() !== indexed.rows[0].block_hash)
    throw new Error("Primary, independent RPC, Blockscout and PostgreSQL disagree on canonical block hash");

  const registry = await db.query<RegistryRow>(
    "SELECT contract_address,token_standard FROM nft_collections WHERE chain_id=18881 AND deployment_block<=$1",
    [height.toString()],
  );
  const byAddress = new Map(registry.rows.map((r) => [r.contract_address, r.token_standard] as const));
  const addresses = registry.rows.map((r) => r.contract_address as Address);
  const [primaryLogs, independentLogs, dbLogs] = await Promise.all([
    primary.logs(height, addresses), independent.logs(height, addresses),
    db.query<StoredTransfer>(
      `SELECT contract_address,token_standard,tx_hash,log_index,item_index,token_id::text,amount::text,
      from_address,to_address FROM nft_token_transfers WHERE chain_id=18881 AND block_number=$1`,
      [height.toString()],
    ),
  ]);
  const first = canonicalEvents(primaryLogs, byAddress), second = canonicalEvents(independentLogs, byAddress),
    stored = dbLogs.rows.map(canonicalDb).sort();
  if (JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(first) !== JSON.stringify(stored))
    throw new Error("Indexed transfer items diverge from independent RPC event logs");
  return {
    source: "live-rpc-and-blockscout", chainId: 18881, verifiedHeight: height.toString(), hash: indexed.rows[0].block_hash,
    matchedTransferItems: first.length, sampleTxHash: sample.rows[0]?.tx_hash || null,
    blockExplorer: "https://evmexplorer.testnet.ultra.io/block/" + height,
    scope: sample.rows[0] ? "block-and-token-event" : "block-only",
  };
}
