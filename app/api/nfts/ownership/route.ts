import { NextRequest } from "next/server";
import { walletAddress } from "@/lib/server/auth";
import { getOwnership, indexerCoverage } from "@/lib/indexer/query";
import { apiFailure, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const owner = walletAddress(request.nextUrl.searchParams.get("address"));
    const coverage = await indexerCoverage();
    if (!coverage.active) return noStore({ error: "Indexer coverage is not established; cannot claim this wallet has no NFTs", coverage }, 409);
    const holdings = await getOwnership(owner);
    return noStore({ owner, chainId: 18881, coverage, holdings, source: "canonical-indexed-transfer-events" });
  } catch (error) { return apiFailure(error); }
}
