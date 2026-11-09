import { getDb } from "@/lib/server/db";

export async function listCollectionTokens(contract: string, limit = 50) {
  const records = await getDb().query<{
    token_id: string; token_standard: string; block_number: string; tx_hash: string;
  }>(
    `SELECT DISTINCT ON (token_id) token_id::text,token_standard,
       block_number::text,tx_hash
     FROM nft_token_transfers WHERE chain_id=18881 AND contract_address=$1
     ORDER BY token_id,block_number DESC,tx_index DESC,log_index DESC,item_index DESC
     LIMIT $2`, [contract, limit],
  );
  return records.rows.map((row) => ({
    tokenId: row.token_id, standard: row.token_standard,
    lastObservedBlock: row.block_number, lastTxHash: row.tx_hash,
  }));
}
