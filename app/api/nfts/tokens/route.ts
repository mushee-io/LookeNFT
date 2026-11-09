import { NextRequest } from "next/server";
import { createPublicClient, http, isAddress, parseAbi, type Address } from "viem";
import { getSession } from "@/lib/server/auth";
import { ULTRA_TESTNET } from "@/lib/network";
import { getDb } from "@/lib/server/db";
import { listCollectionTokens } from "@/lib/indexer/query-tokens";
import { indexerCoverage } from "@/lib/indexer/query";
import { verifiedChainTokens } from "@/lib/server/chain-token-fallback";
import { apiFailure, noStore } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const ownershipAbi=parseAbi([
 "function owner() view returns (address)",
 "function ownerOf(uint256) view returns (address)"
]);
async function authenticatedCollectionOwner(request:NextRequest,address:Address){
 const session=await getSession(request);
 if(!session||session.chainId!==18881)return false;
 const owner=await rpc.readContract({address,abi:ownershipAbi,functionName:"owner"}).catch(()=>null);
 return !!owner&&owner.toLowerCase()===session.wallet.toLowerCase();
}
// A hidden ERC-721 is suppressed only while the wallet that hid it still owns it.
// If it is transferred, ownership changes and public visibility is restored.
async function galleryTokens<T extends {tokenId:string}>(
 request:NextRequest,address:Address,tokens:T[]
):Promise<Array<T&{hidden?:boolean}>>{
 const hidden=await getDb().query<{token_id:string;hidden_by:string}>(
  "SELECT token_id::text,hidden_by FROM looke_hidden_testnet_tokens WHERE chain_id=18881 AND contract_address=$1",
  [address.toLowerCase()]);
 if(!hidden.rowCount)return tokens;
 const ownerCanSee=await authenticatedCollectionOwner(request,address);
 const active=await Promise.all(hidden.rows.map(async row=>{
  const current=await rpc.readContract({address,abi:ownershipAbi,functionName:"ownerOf",
   args:[BigInt(row.token_id)]}).catch(()=>null);
  return current?.toLowerCase()===row.hidden_by?row.token_id:null;
 }));
 const suppressed=new Set(active.filter((value):value is string=>value!==null));
 return tokens.filter(t=>ownerCanSee||!suppressed.has(t.tokenId))
   .map(t=>({...t,hidden:suppressed.has(t.tokenId)}));
}

export async function GET(request: NextRequest) {
 try {
  const contract = request.nextUrl.searchParams.get("collection") || "";
  if (!isAddress(contract, { strict: false })) return noStore({ error: "Invalid contract address" }, 400);
  const address = contract.toLowerCase();
  const rows = await getDb().query<{token_standard:string;code_hash:string;cover_url:string|null;archived_at:Date|null}>(
   `SELECT n.token_standard,n.code_hash,c.cover_url,c.archived_at FROM nft_collections n
      LEFT JOIN looke_curated_collections c
      ON n.chain_id=c.chain_id AND n.contract_address=c.contract_address
      WHERE n.chain_id=18881 AND n.contract_address=$1`, [address]
  );
  if(rows.rowCount!==1)return noStore({ error:"Unregistered collection" },404);
  if(rows.rows[0].archived_at&&
     !(await authenticatedCollectionOwner(request,address as Address)))
   return noStore({error:"Collection removed from LookeNFT"},404);
  const [tokens,coverage]=await Promise.all([listCollectionTokens(address),indexerCoverage()]);
  if(tokens.length>0 || rows.rows[0].token_standard!=="erc721")
   return noStore({contract:address,chainId:18881,coverage,
    tokens:rows.rows[0].token_standard==="erc721"?
     await galleryTokens(request,address as Address,tokens):tokens,
    source:"read-only-indexed-events"});
  try {
   const snapshot=await verifiedChainTokens(
    address as Address,rows.rows[0].code_hash,rows.rows[0].cover_url,10
   );
   return noStore({contract:address,chainId:18881,coverage,
    tokens:await galleryTokens(request,address as Address,snapshot.tokens),source:"read-only-on-chain-ownership-snapshot",
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
