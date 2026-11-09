import {NextRequest} from "next/server";
import {createPublicClient,http,type Address} from "viem";
import {ULTRA_TESTNET} from "@/lib/network";
import {requireSession} from "@/lib/server/auth";
import {getDb} from "@/lib/server/db";
import {ApiError,apiFailure,noStore} from "@/lib/server/http";
import {M8_VAULT,offerAbi,offerHash,offerJson,type Offer} from "@/lib/m8/offers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Row={offer_hash:string;vault_address:string;buyer_wallet:string;collection_address:string;
 token_standard:"erc721"|"erc1155";token_id:string;quantity:string;total_price_wei:string;
 nonce:string;expires_at:Date;allowed_seller:string|null;min_seller_proceeds_wei:string;
 max_fee_bps:number;max_royalty_bps:number;signature:string;state:string};
export function storedOffer(r:Row):Offer{
 return {buyer:r.buyer_wallet as Address,collection:r.collection_address as Address,
  tokenId:BigInt(r.token_id),quantity:BigInt(r.quantity),totalPriceWei:BigInt(r.total_price_wei),
  nonce:BigInt(r.nonce),deadline:BigInt(Math.floor(new Date(r.expires_at).getTime()/1000)),
  allowedSeller:(r.allowed_seller||"0x0000000000000000000000000000000000000000") as Address,
  minSellerProceedsWei:BigInt(r.min_seller_proceeds_wei),
  maxFeeBps:r.max_fee_bps,maxRoyaltyBps:r.max_royalty_bps,
  standard:r.token_standard==="erc721"?1:2};
}
export async function GET(req:NextRequest,context:{params:Promise<{hash:string}>}){
 try{
  const who=await requireSession(req);
  const {hash}=await context.params;
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new ApiError(400,"Invalid offer digest");
  const stored=await getDb().query<Row>(
   "SELECT * FROM nft_m8_offer_candidates WHERE offer_hash=$1 AND chain_id=18881",
   [hash.toLowerCase()]
  );
  const row=stored.rows[0];
  if(!row)throw new ApiError(404,"No source-backed funded offer is registered");
  if(row.buyer_wallet.toLowerCase()!==who.wallet.toLowerCase()&&
     row.state!=="independently_funded")
   throw new ApiError(403,"Unverified buyer funding is private and cannot be offered to sellers");
  const vault=M8_VAULT as Address;
  if(!vault||vault.toLowerCase()!==row.vault_address.toLowerCase())
   throw new ApiError(409,"Independent offer-vault deployment not configured");
  const o=storedOffer(row);
  const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
  const [chain,code,version,digest,status,locked,quote,nonceFloor,nonceCancelled]=await Promise.all([
   rpc.getChainId(),rpc.getCode({address:vault}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"VERSION"}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"offerHash",args:[o]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"offerState",args:[row.offer_hash as `0x${string}`]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"buyerLockedWei",args:[o.buyer]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"quote",args:[o]}).catch(()=>null),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"minimumNonce",args:[o.buyer]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"invalidNonces",args:[o.buyer,o.nonce]})
  ]);
  if(chain!==18881||!code||code==="0x"||version!==1n||digest.toLowerCase()!==row.offer_hash)
   throw new ApiError(409,"On-chain vault version, account or order digest cannot be verified");
  const currentlyFunded=status===1&&locked>=o.totalPriceWei&&o.nonce>=nonceFloor&&
   !nonceCancelled&&BigInt(Math.floor(Date.now()/1000))<=o.deadline;
  return noStore({
   offer:offerJson(o),offerHash:row.offer_hash,
   signature:currentlyFunded&&row.state==="independently_funded"?row.signature:null,
   status:row.state,currentlyFunded,
   quote:quote?{feeWei:quote[0].toString(),royaltyRecipient:quote[1],
      royaltyWei:quote[2].toString(),sellerProceedsWei:quote[3].toString()}:null,
   chainProof:"primary-rpc-snapshot-only",
   independentlyFunded:row.state==="independently_funded",
   warning:"Seller approval, expiry, escrow funding and royalty can change. Wallet may not sign settlement until all fresh checks pass."
  });
 }catch(e){return apiFailure(e);}
}
