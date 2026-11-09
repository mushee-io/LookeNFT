import { NextRequest } from "next/server";
import { createPublicClient,http,isAddress, type Address,type Hex } from "viem";
import { ULTRA_TESTNET } from "@/lib/network";
import { requireSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ApiError,apiFailure,noStore } from "@/lib/server/http";
import { M7_MARKET_ADDRESS,marketAbi,type Listing } from "@/lib/m7/market";
export const runtime="nodejs";
export const dynamic="force-dynamic";

type Stored={
 order_hash:string;marketplace:string;seller_wallet:string;collection_address:string;
 token_standard:string;token_id:string;quantity:string;unit_price_wei:string;
 nonce:string;deadline:Date;reserved_buyer:string|null;min_proceeds_wei:string;
 max_fee_bps:number;max_royalty_bps:number;signature:string;state:string
};
export function unpackStoredOrder(row:Stored):Listing{
 return {
   seller:row.seller_wallet as Address,collection:row.collection_address as Address,
   tokenId:BigInt(row.token_id),quantity:BigInt(row.quantity),
   unitPriceWei:BigInt(row.unit_price_wei),nonce:BigInt(row.nonce),
   deadline:BigInt(Math.floor(new Date(row.deadline).getTime()/1000)),
   reservedBuyer:(row.reserved_buyer||"0x0000000000000000000000000000000000000000") as Address,
   minSellerProceedsWei:BigInt(row.min_proceeds_wei),
   maxFeeBps:row.max_fee_bps,maxRoyaltyBps:row.max_royalty_bps,
   standard:row.token_standard==="erc721"?1:2
 };
}
export function jsonOrder(order:Listing){
 return {
  seller:order.seller,collection:order.collection,tokenId:order.tokenId.toString(),
  quantity:order.quantity.toString(),unitPriceWei:order.unitPriceWei.toString(),
  nonce:order.nonce.toString(),deadline:order.deadline.toString(),reservedBuyer:order.reservedBuyer,
  minSellerProceedsWei:order.minSellerProceedsWei.toString(),
  maxFeeBps:order.maxFeeBps,maxRoyaltyBps:order.maxRoyaltyBps,standard:order.standard
 };
}

export async function GET(request:NextRequest,ctx:{params:Promise<{hash:string}>}){
 try{
  const session=await requireSession(request);
  const {hash}=await ctx.params;
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new ApiError(400,"Valid signed listing hash required");
  const r=await getDb().query<Stored>(
    `SELECT * FROM nft_m7_signed_listings WHERE chain_id=18881 AND order_hash=$1`,
    [hash.toLowerCase()]
  );
  const row=r.rows[0];
  if(!row)throw new ApiError(404,"No genuine signed candidate exists for this order hash");
  const market=M7_MARKET_ADDRESS;
  if(!isAddress(market,{strict:false})||row.marketplace!==market.toLowerCase()||
     row.state!=="unverified_candidate")
    throw new ApiError(409,"Marketplace operator is not configured or order is no longer a candidate");
  const o=unpackStoredOrder(row);
  const client=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
  if(await client.getChainId()!==18881)throw new ApiError(503,"Primary RPC wrong chain");
  const [code,version,hashFromChain,fillable,amount]=await Promise.all([
   client.getCode({address:market}),
   client.readContract({address:market,abi:marketAbi,functionName:"VERSION"}),
   client.readContract({address:market,abi:marketAbi,functionName:"hashListing",args:[o]}),
   client.readContract({address:market,abi:marketAbi,functionName:"isFillable",args:[o,row.signature as Hex]}),
   client.readContract({address:market,abi:marketAbi,functionName:"quote",args:[o]})
  ]);
  if(!code||code==="0x"||version!==1n||
    hashFromChain.toLowerCase()!==row.order_hash||!fillable)
    throw new ApiError(409,"Signed listing ownership/approval/expiry/nonce not currently verifiable on Testnet");
  if(o.reservedBuyer!=="0x0000000000000000000000000000000000000000"&&
     o.reservedBuyer.toLowerCase()!==session.wallet.toLowerCase()&&
     o.seller.toLowerCase()!==session.wallet.toLowerCase())
    throw new ApiError(403,"Reserved sale is not offered to this wallet");
  return noStore({
    order:jsonOrder(o),signature:row.signature,hash:row.order_hash,
    quote:{
      totalWei:amount[0].toString(),feeWei:amount[1].toString(),
      royaltyRecipient:amount[2],royaltyWei:amount[3].toString(),
      sellerProceedsWei:amount[4].toString()
    },
    verified:"primary-RPC-snapshot-only",
    warning:"Approval and price may change before settlement. Buyer must explicitly confirm wallet transaction; no escrow or payment is implied.",
  });
 }catch(e){return apiFailure(e);}
}
