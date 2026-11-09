import { indexerCoverage, recentTransfers } from "@/lib/indexer/query";
import { apiFailure, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const coverage = await indexerCoverage();
    if (!coverage.active) return noStore({ coverage, events: [], status: "index-not-started" });
    const events = await recentTransfers();
    return noStore({ chainId: 18881, coverage, events, status: "indexed", source: "canonical-transfer-events-not-sales" });
  } catch (error) { return apiFailure(error); }
}
