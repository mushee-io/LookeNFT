import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { curatedCollections } from "@/lib/server/curation";
import { apiFailure, noStore } from "@/lib/server/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  try{
    const address=request.nextUrl.searchParams.get("address")||"";
    if(address && !isAddress(address,{strict:false}))return noStore({error:"Invalid collection"},400);
    if(!process.env.DATABASE_URL && !address)
      return noStore({chainId:18881,network:"Ultra EVM Testnet",collections:[],
        catalogueReady:false,warning:"Collection catalogue and minting are not configured"});
    const collections=await curatedCollections(true,address?address.toLowerCase():undefined);
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
