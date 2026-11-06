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
    const collections=await curatedCollections(true,address?address.toLowerCase():undefined);
    if(address && collections.length===0)return noStore({error:"Collection not published"},404);
    return noStore({chainId:18881,network:"Ultra EVM Testnet",collections,
      source:"operator-approved-and-indexer-registered-only",
      warning:"No sample NFTs, inferred mint activity, or unsupported marketplace statistics"});
  }catch(e){return apiFailure(e);}
}
