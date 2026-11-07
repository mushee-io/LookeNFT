import { NextRequest } from "next/server";
import { createPublicClient, http, isAddress, parseAbi } from "viem";
import { getSession } from "@/lib/server/auth";
import { ULTRA_TESTNET } from "@/lib/network";
import { curatedCollections } from "@/lib/server/curation";
import { apiFailure, noStore } from "@/lib/server/http";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const ownerAbi=parseAbi(["function owner() view returns (address)"]);
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  try{
    const address=request.nextUrl.searchParams.get("address")||"";
    if(address && !isAddress(address,{strict:false}))return noStore({error:"Invalid collection"},400);
    if(!process.env.DATABASE_URL && !address)
      return noStore({chainId:18881,network:"Ultra EVM Testnet",collections:[],
        catalogueReady:false,warning:"Collection catalogue and minting are not configured"});
    let collections=await curatedCollections(true,address?address.toLowerCase():undefined);
    if(address && collections.length===0){
      // An unpublished draft may be viewed by its signed-in *current*
      // contract owner for editing, but never by an unrelated wallet.
      const session=await getSession(request);
      if(session?.chainId===18881){
        const owner=await rpc.readContract({
          address:address as `0x${string}`,abi:ownerAbi,functionName:"owner"
        }).catch(()=>null);
        if(owner?.toLowerCase()===session.wallet.toLowerCase())
          collections=await curatedCollections(false,address.toLowerCase());
      }
    }
    if(address && collections.length===0)return noStore({error:"Collection not published"},404);
    return noStore({chainId:18881,network:"Ultra EVM Testnet",collections,catalogueReady:true,
      source:"confirmed-creator-owned-and-curated-contracts",
      warning:"No sample NFTs, inferred mint activity, or unsupported marketplace statistics"});
  }catch(e){
    if(!request.nextUrl.searchParams.has("address") &&
       typeof e==="object" && e!==null && "code" in e && e.code==="42P01")
      return noStore({chainId:18881,network:"Ultra EVM Testnet",collections:[],
        catalogueReady:false,warning:"Collection catalogue migration is not yet installed"});
    return apiFailure(e);
  }
}
