import type {Pool} from "pg";
import {createPublicClient,http,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "../network";
import {marketAbi,type Listing} from "../m7/market";
import {offerAbi,type Offer} from "../m8/offers";
import {M9_MARKET_ADDRESS,M9_VAULT_ADDRESS,validateMarketAddresses} from "./market";

type Candidate={kind:"m7_listing"|"m8_offer";hash:string;order:Listing|Offer;signature:Hex|null};
type Check={kind:"m7_listing"|"m8_offer";hash:string;fillable:boolean;reason:string};
type RpcPair={primary:ReturnType<typeof createPublicClient>;secondary:ReturnType<typeof createPublicClient>};

async function checkCandidate(pair:RpcPair,c:Candidate,at:bigint):Promise<Check>{
 const {listing,vault}=validateMarketAddresses(M9_MARKET_ADDRESS,M9_VAULT_ADDRESS);
 const test=async(source:ReturnType<typeof createPublicClient>):Promise<boolean>=>{
  if(c.kind==="m7_listing"){
   if(!c.signature)return false;
   return source.readContract({address:listing,abi:marketAbi,functionName:"isFillable",
    args:[c.order as Listing,c.signature],blockNumber:at});
  }
  const o=c.order as Offer,hash=c.hash as Hex;
  const [status,nonce,floor,locked]=await Promise.all([
   source.readContract({address:vault,abi:offerAbi,functionName:"offerState",args:[hash],blockNumber:at}),
   source.readContract({address:vault,abi:offerAbi,functionName:"invalidNonces",
    args:[o.buyer,o.nonce],blockNumber:at}),
   source.readContract({address:vault,abi:offerAbi,functionName:"minimumNonce",
    args:[o.buyer],blockNumber:at}),
   source.readContract({address:vault,abi:offerAbi,functionName:"buyerLockedWei",
    args:[o.buyer],blockNumber:at}),
  ]);
  return status===1 && !nonce && floor<=o.nonce && locked>=o.totalPriceWei;
 };
 const [a,b]=await Promise.all([test(pair.primary),test(pair.secondary)]);
 if(a!==b)throw Error("M9 independent RPCs disagree on NFT listing or funded offer state");
 return {kind:c.kind,hash:c.hash,fillable:a,reason:a?"snapshot_valid_not_executable":"not_currently_fillable"};
}
export async function refreshOrderSnapshots(pool:Pool,independentUrl:string){
 if(process.env.M9_READONLY_SYNC_ENABLED!=="true"||
    process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw Error("M9 read-only snapshots require operator-approved Testnet sync");
 const {listing,vault}=validateMarketAddresses(M9_MARKET_ADDRESS,M9_VAULT_ADDRESS);
 const primary=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
 const secondary=createPublicClient({transport:http(independentUrl,{timeout:12000,retryCount:1})});
 if(await primary.getChainId()!==18881||await secondary.getChainId()!==18881)
  throw Error("Independent snapshot RPC chain ID not 18881");
 const cursor=await pool.query<{last_block:string;last_hash:string}>(
  "SELECT last_block::text,last_hash FROM nft_m9_market_cursor WHERE chain_id=18881"
 );
 if(cursor.rowCount!==1)throw Error("M9 canonical indexer is not started");
 const at=BigInt(cursor.rows[0].last_block),originalHash=cursor.rows[0].last_hash;
 const [b1,b2]=await Promise.all([primary.getBlock({blockNumber:at}),secondary.getBlock({blockNumber:at})]);
 if(b1.hash.toLowerCase()!==originalHash||b2.hash.toLowerCase()!==originalHash)
  throw Error("Canonical block changed; orders cannot be labelled verified");
 const listings=await pool.query<{
  order_hash:string;seller_wallet:string;collection_address:string;token_id:string;
  quantity:string;unit_price_wei:string;nonce:string;deadline:Date;reserved_buyer:string|null;
  min_proceeds_wei:string;max_fee_bps:number;max_royalty_bps:number;token_standard:string;signature:string
 }>(
  `SELECT l.order_hash,l.seller_wallet,l.collection_address,l.token_id::text,
   l.quantity::text,l.unit_price_wei::text,l.nonce::text,l.deadline,
   l.reserved_buyer,l.min_proceeds_wei::text,l.max_fee_bps,l.max_royalty_bps,
   l.token_standard,l.signature FROM nft_m7_signed_listings l
   JOIN nft_collections k ON k.chain_id=l.chain_id AND k.contract_address=l.collection_address
   WHERE l.chain_id=18881 AND k.source_verified=true AND l.marketplace=$1
    AND l.state='unverified_candidate' AND l.deadline>now()
   ORDER BY l.created_at DESC LIMIT 30`,[listing.toLowerCase()]
 );
 const funded=await pool.query<{
  offer_hash:string;buyer_wallet:string;collection_address:string;token_id:string;
  quantity:string;total_price_wei:string;nonce:string;expires_at:Date;
  allowed_seller:string|null;min_seller_proceeds_wei:string;max_fee_bps:number;
  max_royalty_bps:number;token_standard:string
 }>(
  `SELECT o.offer_hash,o.buyer_wallet,o.collection_address,o.token_id::text,
    o.quantity::text,o.total_price_wei::text,o.nonce::text,o.expires_at,
    o.allowed_seller,o.min_seller_proceeds_wei::text,o.max_fee_bps,o.max_royalty_bps,
    o.token_standard FROM nft_m8_offer_candidates o
    JOIN nft_collections k ON k.chain_id=o.chain_id AND k.contract_address=o.collection_address
    JOIN nft_m9_market_events e ON e.chain_id=o.chain_id AND e.order_hash=o.offer_hash
      AND e.event_kind='offer_funded'
    JOIN nft_m8_verified_offer_events v ON v.chain_id=e.chain_id
      AND v.offer_hash=o.offer_hash AND v.event_kind='funded'
      AND v.tx_hash=e.tx_hash AND v.log_index=e.log_index
      AND v.block_hash=e.block_hash
    WHERE o.chain_id=18881 AND o.vault_address=$1 AND k.source_verified=true
      AND o.state='independently_funded' AND o.expires_at>now()
      AND NOT EXISTS(SELECT 1 FROM nft_m9_quarantined_evidence q WHERE
       q.chain_id=e.chain_id AND q.source_kind='m8_offer' AND q.tx_hash=e.tx_hash
       AND q.log_index=e.log_index)
    ORDER BY o.first_seen_at DESC LIMIT 30`,[vault.toLowerCase()]
 );
 const entries:Candidate[]=[];
 for(const x of listings.rows){
  entries.push({kind:"m7_listing",hash:x.order_hash,signature:x.signature as Hex,
   order:{seller:x.seller_wallet as Address,collection:x.collection_address as Address,
    tokenId:BigInt(x.token_id),quantity:BigInt(x.quantity),
    unitPriceWei:BigInt(x.unit_price_wei),nonce:BigInt(x.nonce),
    deadline:BigInt(Math.floor(new Date(x.deadline).getTime()/1000)),
    reservedBuyer:(x.reserved_buyer||"0x0000000000000000000000000000000000000000") as Address,
    minSellerProceedsWei:BigInt(x.min_proceeds_wei),
    maxFeeBps:x.max_fee_bps,maxRoyaltyBps:x.max_royalty_bps,
    standard:x.token_standard==="erc721"?1:2}
  });
 }
 for(const x of funded.rows){
  entries.push({kind:"m8_offer",hash:x.offer_hash,signature:null,
   order:{buyer:x.buyer_wallet as Address,collection:x.collection_address as Address,
    tokenId:BigInt(x.token_id),quantity:BigInt(x.quantity),
    totalPriceWei:BigInt(x.total_price_wei),nonce:BigInt(x.nonce),
    deadline:BigInt(Math.floor(new Date(x.expires_at).getTime()/1000)),
    allowedSeller:(x.allowed_seller||"0x0000000000000000000000000000000000000000") as Address,
    minSellerProceedsWei:BigInt(x.min_seller_proceeds_wei),
    maxFeeBps:x.max_fee_bps,maxRoyaltyBps:x.max_royalty_bps,
    standard:x.token_standard==="erc721"?1:2}
  });
 }
 const checks:Check[]=[];
 for(const candidate of entries)checks.push(await checkCandidate({primary,secondary},candidate,at));
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(18881,9009)");
  const latest=await client.query<{last_block:string;last_hash:string}>(
   "SELECT last_block::text,last_hash FROM nft_m9_market_cursor WHERE chain_id=18881 FOR UPDATE"
  );
  if(latest.rows[0]?.last_block!==at.toString()||latest.rows[0]?.last_hash!==originalHash)
   throw Error("Canonical indexer changed during orderbook verification");
  for(const check of checks){
   await client.query(`INSERT INTO nft_m9_order_checks(
    chain_id,source_kind,order_hash,block_number,block_hash,fillable_snapshot,reason)
    VALUES(18881,$1,$2,$3,$4,$5,$6)
    ON CONFLICT(chain_id,source_kind,order_hash)
    DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,
      fillable_snapshot=excluded.fillable_snapshot,reason=excluded.reason,checked_at=now()`,
    [check.kind,check.hash,at.toString(),originalHash,check.fillable,check.reason]);
  }
  await client.query("COMMIT");
  return {checked:checks.length,atBlock:at.toString(),
   independentlyMatched:true,tradeExecution:false};
 }catch(e){await client.query("ROLLBACK");throw e;}
 finally{client.release();}
}
