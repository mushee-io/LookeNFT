import { NextRequest } from "next/server";
import { createPublicClient, http, parseAbi, isAddress } from "viem";
import { ACTIVE_NETWORK } from "@/lib/network";
import { getDb } from "@/lib/server/db";
import { apiFailure, noStore } from "@/lib/server/http";
import { loadMetadata, metadataUrl } from "@/lib/indexer/metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ERC721 = parseAbi(["function tokenURI(uint256) view returns (string)"]);
const ERC1155 = parseAbi(["function uri(uint256) view returns (string)"]);

export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get("collection") || "";
    const idText = request.nextUrl.searchParams.get("tokenId") || "";
    if (!isAddress(address, { strict: false }) || !/^\d{1,78}$/.test(idText))
      return noStore({ error: "Valid contract and decimal token ID required" }, 400);
    const tokenId = BigInt(idText);
    if (tokenId > (1n << 256n) - 1n) return noStore({ error: "Token ID out of range" }, 400);
    const result = await getDb().query<{ token_standard: string }>(
      "SELECT token_standard FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",
      [address.toLowerCase()],
    );
    if (result.rowCount !== 1) return noStore({ error: "Collection is not in the approved Testnet registry" }, 404);
    const standard = result.rows[0].token_standard;
    const rpc = createPublicClient({ transport: http(ACTIVE_NETWORK.rpcUrl, { timeout: 8000, retryCount: 1 }) });
    if (await rpc.getChainId() !== 18881) throw new Error("Metadata RPC is on the wrong network");
    const raw = standard === "erc721"
      ? await rpc.readContract({ address, abi: ERC721, functionName: "tokenURI", args: [tokenId] })
      : await rpc.readContract({ address, abi: ERC1155, functionName: "uri", args: [tokenId] });
    const url = metadataUrl(raw, tokenId);
    if (!url) return noStore({ status: "unavailable", reason: "On-chain metadata URI is not on an operator-approved HTTPS gateway", metadata: null }, 422);
    const metadata = await loadMetadata(url);
    return noStore({ chainId: 18881, collection: address.toLowerCase(), tokenId: idText, status: "read-only", url, metadata });
  } catch (error) { return apiFailure(error); }
}
