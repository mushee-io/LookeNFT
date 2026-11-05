import { NextRequest } from "next/server";
import { indexerCoverage, listCollections } from "@/lib/indexer/query";
import { apiFailure, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (search.length > 42 || (search && !/^0x[0-9a-fA-F]*$/.test(search)))
      return noStore({ error: "Collection search accepts a hexadecimal address prefix only" }, 400);
    const [coverage, collections] = await Promise.all([indexerCoverage(), listCollections(40, search)]);
    return noStore({ network: "Ultra EVM Testnet", chainId: 18881, coverage, collections, source: "registered-contracts-and-canonical-indexed-events" });
  } catch (error) { return apiFailure(error); }
}
