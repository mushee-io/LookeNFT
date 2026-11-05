import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { getDb } from "@/lib/server/db";
import { listCollectionTokens } from "@/lib/indexer/query-tokens";
import { indexerCoverage } from "@/lib/indexer/query";
import { apiFailure, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const contract = request.nextUrl.searchParams.get("collection") || "";
    if (!isAddress(contract, { strict: false })) return noStore({ error: "Invalid contract address" }, 400);
    const address = contract.toLowerCase();
    const result = await getDb().query(
      "SELECT 1 FROM nft_collections WHERE chain_id=18881 AND contract_address=$1", [address],
    );
    if (!result.rowCount) return noStore({ error: "Unregistered collection" }, 404);
    const [tokens, coverage] = await Promise.all([listCollectionTokens(address), indexerCoverage()]);
    return noStore({ contract: address, chainId: 18881, coverage, tokens, source: "read-only-indexed-events" });
  } catch (error) { return apiFailure(error); }
}
