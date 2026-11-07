import { NextRequest } from "next/server";
import { isAddress, type Address } from "viem";
import { getDb } from "@/lib/server/db";
import { listCollectionTokens } from "@/lib/indexer/query-tokens";
import { indexerCoverage } from "@/lib/indexer/query";
import { verifiedChainTokens } from "@/lib/server/chain-token-fallback";
import { apiFailure, noStore } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
 try {
  const contract = request.nextUrl.searchParams.get("collection") || "";
  if (!isAddress(contract, { strict: false })) return noStore({ error: "Invalid contract address" }, 400);
  const address = contract.toLowerCase();
  const rows = await getDb().query<{token_standard:string;code_hash:string;cover_url:string|null}>(
   `SELECT n.token_standard,n.code_hash,c.cover_url FROM nft_collections n
      LEFT JOIN looke_curated_collections c
      ON n.chain_id=c.chain_id AND n.contract_address=c.contract_address
      WHERE n.chain_id=18881 AND n.contract_address=$1`, [address]
  );
  if(rows.rowCount!==1)return noStore({ error:"Unregistered collection" },404);
  const [tokens,coverage]=await Promise.all([listCollectionTokens(address),indexerCoverage()]);
  if(tokens.length>0 || rows.rows[0].token_standard!=="erc721")
   return noStore({contract:address,chainId:18881,coverage,tokens,source:"read-only-indexed-events"});
  try {
   const snapshot=await verifiedChainTokens(
    address as Address,rows.rows[0].code_hash,rows.rows[0].cover_url,10
   );
   return noStore({contract:address,chainId:18881,coverage,
    tokens:snapshot.tokens,source:"read-only-on-chain-ownership-snapshot",
    checkedBlock:snapshot.checkedBlock,partial:snapshot.partial,
    note:"Live ownerOf proof; no fabricated mint events or transaction hashes"});
  }catch(error){
   return noStore({contract:address,chainId:18881,coverage,tokens:[],
    source:"not-yet-indexed",
    warning:"Token ownership could not be independently verified from Ultra Testnet RPC",
    details:error instanceof Error?error.message:"Unavailable"});
  }
 }catch(error){return apiFailure(error);}
}
