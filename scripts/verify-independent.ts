/**
 * Read-only operator acceptance. Reports no verification if any independent
 * source is missing, unreachable or contradictory; does not seed any NFTs.
 */
import { getDb } from "../lib/server/db";
import { createChainReader } from "../lib/indexer/reader";
import { verifyIndependentSources } from "../lib/indexer/verify";

async function main() {
  if (process.env.NEXT_PUBLIC_ULTRA_NETWORK !== "testnet") throw new Error("Testnet-only independent verification");
  const secondary = process.env.NFT_INDEPENDENT_RPC_URL || "";
  if (!secondary) throw new Error("NFT_INDEPENDENT_RPC_URL required: a genuinely separate HTTPS EVM RPC provider");
  const primaryUrl = "https://evm.test.ultra.eosusa.io";
  const a = new URL(primaryUrl), b = new URL(secondary);
  if (b.protocol !== "https:" || a.hostname === b.hostname || b.username || b.password)
    throw new Error("Independent RPC must be HTTPS and hosted independently of primary RPC");
  const explorer = async (height: bigint) => {
    const url = "https://evmexplorer.testnet.ultra.io/api/v2/blocks/" + height;
    const result = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: "error", cache: "no-store" });
    if (!result.ok) throw new Error("Blockscout independent block endpoint unavailable: " + result.status);
    const raw: unknown = await result.json();
    if (!raw || typeof raw !== "object" || !("hash" in raw) || typeof raw.hash !== "string")
      throw new Error("Blockscout did not supply a comparable block hash");
    return { hash: raw.hash };
  };
  const result = await verifyIndependentSources(getDb(), createChainReader(primaryUrl), createChainReader(secondary), explorer);
  console.log(JSON.stringify({ ...result, verification: "success", readOnly: true }));
}
main().catch((error) => {
  console.error(JSON.stringify({ verification: "BLOCKED_OR_FAILED", reason: error instanceof Error ? error.message : "Unknown error", noApprovalInferred: true }));
  process.exitCode = 1;
}).finally(async () => { await getDb().end().catch(() => {}); });
