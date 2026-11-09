import { getDb } from "../lib/server/db";
import { createChainReader } from "../lib/indexer/reader";
import { scanOnce } from "../lib/indexer/sync";

async function main() {
  if (process.env.NEXT_PUBLIC_ULTRA_NETWORK !== "testnet") throw new Error("Indexer refuses non-Testnet configuration");
  if (!/^\d+$/.test(process.env.NFT_START_BLOCK || "")) throw new Error("Set NFT_START_BLOCK to the earliest registered contract deployment block");
  const start = BigInt(process.env.NFT_START_BLOCK!);
  if (start < 1n) throw new Error("NFT_START_BLOCK must be >=1");
  const confirmations = Number(process.env.NFT_CONFIRMATIONS || "12");
  const maxBlocks = Number(process.env.NFT_MAX_BLOCKS || "25");
  const result = await scanOnce(createChainReader(), getDb(), { startBlock: start, confirmations, maxBlocks });
  console.log(JSON.stringify({ ...result, readOnly: true, source: "Ultra EVM Testnet RPC" }));
}

main().catch((error) => {
  console.error("Indexer stopped (no synthetic fallback):", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}).finally(async () => { await getDb().end().catch(() => {}); });
