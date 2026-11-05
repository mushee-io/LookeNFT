/**
 * Explicit operator-only rescan. Keeps verified registry, removes indexed
 * canonical history and cursor. Never operates on mainnet.
 */
import { getDb, inTransaction } from "../lib/server/db";
async function main() {
  if (process.env.NEXT_PUBLIC_ULTRA_NETWORK !== "testnet" ||
      process.env.NFT_CONFIRM_REINDEX !== "REINDEX_ULTRA_TESTNET_EVENTS") {
    throw new Error("Refusing rescan without Testnet and NFT_CONFIRM_REINDEX=REINDEX_ULTRA_TESTNET_EVENTS");
  }
  await inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [18881]);
    await db.query("DELETE FROM nft_indexer_blocks WHERE chain_id=18881");
    await db.query("DELETE FROM nft_indexer_state WHERE chain_id=18881");
  });
  console.log("Canonical indexed blocks, transfers and cursor reset on Ultra EVM Testnet only; collection registry retained. Next scanner must begin at or before earliest deployment.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1;
}).finally(async () => { await getDb().end().catch(() => {}); });
