import { getDb } from "@/lib/server/db";
import { INDEXER_CHAIN_ID } from "./sync";

export async function indexerCoverage() {
  const row = await getDb().query<{ start_block: string; last_block: string; last_hash: string; updated_at: Date }>(
    "SELECT start_block,last_block,last_hash,updated_at FROM nft_indexer_state WHERE chain_id=$1",
    [INDEXER_CHAIN_ID],
  );
  return row.rows[0] ? {
    active: true, startBlock: row.rows[0].start_block,
    lastBlock: row.rows[0].last_block, blockHash: row.rows[0].last_hash,
    updatedAt: row.rows[0].updated_at.toISOString(),
  } : { active: false, startBlock: null, lastBlock: null, blockHash: null, updatedAt: null };
}

export async function listCollections(limit = 30, search = "") {
  const found = await getDb().query<{
    contract_address: string; token_standard: string; deployment_block: string;
    checked_block: string; code_hash: string; source_verified: boolean;
    token_count: string; transfer_count: string; last_event_block: string | null;
  }>(
    `SELECT c.contract_address,c.token_standard,c.deployment_block,c.checked_block,c.code_hash,
     c.source_verified, COUNT(DISTINCT t.token_id)::text AS token_count,
     COUNT(t.tx_hash)::text AS transfer_count,
     MAX(t.block_number)::text AS last_event_block
     FROM nft_collections c
     LEFT JOIN nft_token_transfers t ON t.chain_id=c.chain_id AND t.contract_address=c.contract_address
     WHERE c.chain_id=$1 AND c.contract_address LIKE $2
     GROUP BY c.chain_id,c.contract_address
     ORDER BY c.created_at DESC,c.contract_address
     LIMIT $3`,
    [INDEXER_CHAIN_ID, search ? "%" + search.toLowerCase() + "%" : "%", limit],
  );
  return found.rows.map((row) => ({
    address: row.contract_address,
    standard: row.token_standard,
    deploymentBlock: row.deployment_block,
    bytecodeCheckedAtBlock: row.checked_block,
    codeHash: row.code_hash,
    sourceVerified: row.source_verified,
    observedTokenCount: row.token_count,
    observedTransferItems: row.transfer_count,
    lastObservedBlock: row.last_event_block,
  }));
}

export async function getOwnership(owner: string, limit = 50) {
  const db = getDb();
  const erc721 = await db.query<{
    contract_address: string; token_id: string; amount: string; tx_hash: string; block_number: string;
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (contract_address,token_id)
        contract_address,token_id,to_address,tx_hash,block_number
       FROM nft_token_transfers
       WHERE chain_id=$1 AND token_standard='erc721'
       ORDER BY contract_address,token_id,block_number DESC,tx_index DESC,log_index DESC,item_index DESC
     )
     SELECT contract_address,token_id,'1' AS amount,tx_hash,block_number
     FROM latest WHERE to_address=$2
     ORDER BY contract_address,token_id LIMIT $3`,
    [INDEXER_CHAIN_ID, owner, limit],
  );
  const erc1155 = await db.query<{
    contract_address: string; token_id: string; balance: string; last_block: string;
  }>(
    `SELECT contract_address,token_id,
       SUM(CASE WHEN to_address=$2 THEN amount ELSE 0 END
           - CASE WHEN from_address=$2 THEN amount ELSE 0 END)::text AS balance,
       MAX(block_number)::text AS last_block
     FROM nft_token_transfers
     WHERE chain_id=$1 AND token_standard='erc1155'
       AND (from_address=$2 OR to_address=$2)
     GROUP BY contract_address,token_id
     HAVING SUM(CASE WHEN to_address=$2 THEN amount ELSE 0 END
           - CASE WHEN from_address=$2 THEN amount ELSE 0 END) > 0
     ORDER BY contract_address,token_id LIMIT $3`,
    [INDEXER_CHAIN_ID, owner, limit],
  );
  return [
    ...erc721.rows.map((r) => ({ collection: r.contract_address, standard: "erc721", tokenId: r.token_id, balance: "1", lastBlock: r.block_number, lastTxHash: r.tx_hash })),
    ...erc1155.rows.map((r) => ({ collection: r.contract_address, standard: "erc1155", tokenId: r.token_id, balance: r.balance, lastBlock: r.last_block, lastTxHash: null })),
  ].slice(0, limit);
}

export async function recentTransfers(limit = 40) {
  const result = await getDb().query<{
    contract_address: string; token_standard: string; token_id: string; amount: string;
    from_address: string; to_address: string; tx_hash: string; block_number: string; log_index: number;
  }>(
    `SELECT contract_address,token_standard,token_id::text,amount::text,
      from_address,to_address,tx_hash,block_number::text,log_index
     FROM nft_token_transfers WHERE chain_id=$1
     ORDER BY block_number DESC,tx_index DESC,log_index DESC,item_index DESC
     LIMIT $2`,
    [INDEXER_CHAIN_ID, limit],
  );
  return result.rows.map((r) => ({
    collection: r.contract_address, standard: r.token_standard, tokenId: r.token_id,
    amount: r.amount, from: r.from_address, to: r.to_address,
    txHash: r.tx_hash, block: r.block_number, logIndex: r.log_index,
  }));
}
