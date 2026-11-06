import {NextRequest} from "next/server";
import {createPublicClient,http,isAddress,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "@/lib/network";
import {requireSession} from "@/lib/server/auth";
import {getDb} from "@/lib/server/db";
import {ApiError,apiFailure,noStore} from "@/lib/server/http";
import {marketAbi,type Listing} from "@/lib/m7/market";
import {offerAbi,type Offer} from "@/lib/m8/offers";
import {weiSplit,validateMarketAddresses} from "@/lib/m9/market";
import {limitMarketWallet} from "@/lib/m9/readmodel";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const hashPattern=/^0x[0-9a-fA-F]{64}$/;
function same(a:readonly unknown[],b:readonly unknown[]){
 return a.length===b.length&&a.every((v,i)=>String(v).toLowerCase()===String(b[i]).toLowerCase());
}
export async function GET(req:NextRequest){
 try{
  if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
   throw new ApiError(503,"M9 quote is Testnet-only");
  const session=await requireSession(req);
  await limitMarketWallet(session.wallet,"quote",20);
  const kind=req.nextUrl.searchParams.get("kind"),digest=req.nextUrl.searchParams.get("hash");
  if(!["listing","offer"].includes(kind||"")||!digest||!hashPattern.test(digest))
   throw new ApiError(400,"Exact Testnet order kind and hash required");
  const {listing,vault}=validateMarketAddresses(
   process.env.M9_LISTING_MARKET_ADDRESS||"",
   process.env.M9_OFFER_VAULT_ADDRESS||""
  );
  const rpcURL=process.env.M9_INDEPENDENT_RPC_URL||"";
  const url=new URL(rpcURL);
  if(url.protocol!=="https:"||url.hostname===new URL(ULTRA_TESTNET.rpcUrl).hostname||
   url.username||url.password)throw new ApiError(503,"Independent RPC unavailable");
  const primary=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
  const independent=createPublicClient({transport:http(rpcURL,{timeout:12000,retryCount:1})});
  const [cursor,source]=await Promise.all([
   getDb().query<{last_block:string;last_hash:string}>(
    "SELECT last_block::text,last_hash FROM nft_m9_market_cursor WHERE chain_id=18881"),
   getDb().query<{
     source_kind:string;block_number:string;block_hash:string;fillable_snapshot:boolean
    }>(`SELECT source_kind,block_number::text,block_hash,fillable_snapshot
       FROM nft_m9_order_checks WHERE chain_id=18881 AND source_kind=$1 AND order_hash=$2
         AND checked_at>now()-interval '5 minutes'`,
       [kind==="listing"?"m7_listing":"m8_offer",digest.toLowerCase()])
  ]);
  if(cursor.rowCount!==1||source.rowCount!==1||
   source.rows[0].fillable_snapshot!==true||
   source.rows[0].block_number!==cursor.rows[0].last_block||
   source.rows[0].block_hash!==cursor.rows[0].last_hash)
   throw new ApiError(409,"Current canonical market quote snapshot unavailable");
  const at=BigInt(cursor.rows[0].last_block);
  const [a,b,chainA,chainB]=await Promise.all([
   primary.getBlock({blockNumber:at}),independent.getBlock({blockNumber:at}),
   primary.getChainId(),independent.getChainId()
  ]);
  if(chainA!==18881||chainB!==18881||
    a.hash.toLowerCase()!==cursor.rows[0].last_hash||
    b.hash.toLowerCase()!==cursor.rows[0].last_hash)
   throw new ApiError(409,"Two RPC providers cannot prove same canonical block");
  let price:bigint,fee:bigint,royalty:bigint,proceeds:bigint;
  let receiver:Address,gas:bigint|null=null;
  let destination:Address;
  if(kind==="listing"){
   const row=await getDb().query<{
    seller_wallet:string;collection_address:string;token_id:string;quantity:string;
    unit_price_wei:string;nonce:string;deadline:Date;reserved_buyer:string|null;
    min_proceeds_wei:string;max_fee_bps:number;max_royalty_bps:number;
    token_standard:string;signature:string;marketplace:string
   }>("SELECT * FROM nft_m7_signed_listings WHERE chain_id=18881 AND order_hash=$1 AND state='unverified_candidate'",
    [digest.toLowerCase()]);
   if(row.rowCount!==1||row.rows[0].marketplace!==listing.toLowerCase())
    throw new ApiError(404,"Signed seller candidate unavailable");
   const x=row.rows[0];
   const order:Listing={seller:x.seller_wallet as Address,collection:x.collection_address as Address,
    tokenId:BigInt(x.token_id),quantity:BigInt(x.quantity),
    unitPriceWei:BigInt(x.unit_price_wei),nonce:BigInt(x.nonce),
    deadline:BigInt(Math.floor(new Date(x.deadline).getTime()/1000)),
    reservedBuyer:(x.reserved_buyer||"0x0000000000000000000000000000000000000000") as Address,
    minSellerProceedsWei:BigInt(x.min_proceeds_wei),maxFeeBps:x.max_fee_bps,
    maxRoyaltyBps:x.max_royalty_bps,standard:x.token_standard==="erc721"?1:2};
   destination=listing;
   const [q1,q2]=await Promise.all([
    primary.readContract({address:listing,abi:marketAbi,functionName:"quote",args:[order],blockNumber:at}),
    independent.readContract({address:listing,abi:marketAbi,functionName:"quote",args:[order],blockNumber:at})
   ]);
   if(!same(q1,q2))throw new ApiError(409,"Independent seller quote disagrees");
   [price,fee,receiver,royalty,proceeds]=q1;
   if(!weiSplit(price,fee,royalty,proceeds)||price!==order.unitPriceWei*order.quantity)
    throw new ApiError(409,"On-chain UOS seller fee or price split inconsistent");
   if(session.wallet!==x.seller_wallet){
    try{gas=await primary.estimateContractGas({address:listing,abi:marketAbi,
     functionName:"buy",args:[order,x.signature as Hex],account:session.wallet as Address,value:price});}
    catch{gas=null;}
   }
  }else{
   const row=await getDb().query<{
    buyer_wallet:string;collection_address:string;token_id:string;quantity:string;
    total_price_wei:string;nonce:string;expires_at:Date;allowed_seller:string|null;
    min_seller_proceeds_wei:string;max_fee_bps:number;max_royalty_bps:number;
    token_standard:string;vault_address:string
   }>("SELECT * FROM nft_m8_offer_candidates WHERE chain_id=18881 AND offer_hash=$1 AND state='independently_funded'",
    [digest.toLowerCase()]);
   if(row.rowCount!==1||row.rows[0].vault_address!==vault.toLowerCase())
    throw new ApiError(404,"Independent funded buyer candidate unavailable");
   const x=row.rows[0];
   const order:Offer={buyer:x.buyer_wallet as Address,collection:x.collection_address as Address,
    tokenId:BigInt(x.token_id),quantity:BigInt(x.quantity),
    totalPriceWei:BigInt(x.total_price_wei),nonce:BigInt(x.nonce),
    deadline:BigInt(Math.floor(new Date(x.expires_at).getTime()/1000)),
    allowedSeller:(x.allowed_seller||"0x0000000000000000000000000000000000000000") as Address,
    minSellerProceedsWei:BigInt(x.min_seller_proceeds_wei),
    maxFeeBps:x.max_fee_bps,maxRoyaltyBps:x.max_royalty_bps,
    standard:x.token_standard==="erc721"?1:2};
   destination=vault;price=order.totalPriceWei;
   const [q1,q2]=await Promise.all([
    primary.readContract({address:vault,abi:offerAbi,functionName:"quote",args:[order],blockNumber:at}),
    independent.readContract({address:vault,abi:offerAbi,functionName:"quote",args:[order],blockNumber:at})
   ]);
   if(!same(q1,q2))throw new ApiError(409,"Independent funded offer quote differs");
   [fee,receiver,royalty,proceeds]=q1;
   if(!weiSplit(price,fee,royalty,proceeds))
    throw new ApiError(409,"Funded offer UOS fee or royalty split inconsistent");
   if(session.wallet!==x.buyer_wallet){
    try{gas=await primary.estimateContractGas({address:vault,abi:offerAbi,
     functionName:"accept",args:[order],account:session.wallet as Address});}
    catch{gas=null;}
   }
  }
  const gasPrices=await Promise.allSettled([primary.getGasPrice(),independent.getGasPrice()]);
  const maxGasPrice=gasPrices.every(x=>x.status==="fulfilled")?
   gasPrices.reduce((v,x)=>x.status==="fulfilled"&&x.value>v?x.value:v,0n):null;
  const cost=gas!==null&&maxGasPrice!==null?gas*maxGasPrice:null;
  return noStore({chainId:18881,orderHash:digest.toLowerCase(),kind,block:at.toString(),
   contract:destination,priceWei:price.toString(),feeWei:fee.toString(),
   royaltyRecipient:receiver,royaltyWei:royalty.toString(),
   sellerProceedsWei:proceeds.toString(),
   gasUnits:gas?.toString()||null,maxObservedGasPriceWei:maxGasPrice?.toString()||null,
   indicativeGasCostWei:cost?.toString()||null,
   transactionsEnabled:false,readOnly:true,quoteValidAtBlockOnly:true,
   warning:"Two-RPC historical UOS/royalty estimate only. Gas estimation may be unavailable, insufficient funds or approvals can make the transaction revert. No money has moved."});
 }catch(err){return apiFailure(err);}
}
