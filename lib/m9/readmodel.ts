import {getDb} from "../server/db";
import {ApiError} from "../server/http";
import {isAddress} from "viem";

export type M9Route="overview"|"orderbook"|"notifications"|"quote";
export async function limitMarketWallet(wallet:string,route:M9Route,maxPerMinute=40){
 if(!isAddress(wallet,{strict:false}))throw new ApiError(401,"Sign in to a genuine Testnet wallet");
 const now=Math.floor(Date.now()/60000)*60000;
 const row=await getDb().query(
  `INSERT INTO nft_m9_request_buckets(wallet_address,route,bucket_start,hits)
   VALUES($1,$2,$3,1)
   ON CONFLICT(chain_id,wallet_address,route,bucket_start)
   DO UPDATE SET hits=nft_m9_request_buckets.hits+1
    WHERE nft_m9_request_buckets.hits<$4
   RETURNING hits`,
   [wallet.toLowerCase(),route,new Date(now),maxPerMinute]
 );
 if(row.rowCount!==1)throw new ApiError(429,"Marketplace read-only request limit exceeded");
}
export function collectionParam(raw:string|null):string|null{
 if(raw===null||raw==="")return null;
 if(!isAddress(raw,{strict:false}))throw new ApiError(400,"Valid Ultra EVM NFT collection address required");
 return raw.toLowerCase();
}
export async function marketCoverage(){
 const data=await getDb().query<{last_block:string;last_hash:string;updated_at:Date}>(
  "SELECT last_block::text,last_hash,updated_at FROM nft_m9_market_cursor WHERE chain_id=18881"
 );
 if(data.rowCount!==1)return {active:false,stale:true,lastBlock:null,lastHash:null,updatedAt:null};
 const r=data.rows[0];
 return {active:true,stale:Date.now()-new Date(r.updated_at).getTime()>10*60_000,
  lastBlock:r.last_block,lastHash:r.last_hash,updatedAt:new Date(r.updated_at).toISOString()};
}
/** No independent canonical M9 coverage => null, not invented zeros. */
export async function marketOverview(collection:string|null){
 const coverage=await marketCoverage();
 if(!coverage.active)return {chainId:18881,coverage,verifiedSales:null,verifiedVolumeWei:null,
  verifiedFloorWei:null,indicativeAskFloorWei:null,
  warning:"No independent canonical marketplace coverage. No claim of sales, floor price or volume."};
 const args=collection?[collection]:[];
 const predicate=collection?"AND sale.collection_address=$1":"";
 const r=await getDb().query<{count:string;volume_wei:string}>(
  `WITH verified_sales AS (
    SELECT s.tx_hash,s.log_index,s.collection_address,s.price_wei AS paid_wei,
      s.block_number,s.block_hash,'m7_sale'::text AS source_kind
    FROM nft_m7_verified_settlements s
    UNION ALL
    SELECT e.tx_hash,e.log_index,e.collection_address,e.total_price_wei AS paid_wei,
      e.block_number,e.block_hash,'m8_offer'::text AS source_kind
    FROM nft_m8_verified_offer_events e WHERE e.event_kind='accepted'
   )
   SELECT count(*)::text AS count,coalesce(sum(sale.paid_wei),0)::text AS volume_wei
   FROM verified_sales sale
   JOIN nft_m9_market_blocks b ON b.chain_id=18881 AND b.block_number=sale.block_number
    AND b.block_hash=sale.block_hash
   JOIN nft_m9_market_events e ON e.chain_id=18881 AND e.tx_hash=sale.tx_hash
    AND e.log_index=sale.log_index AND e.block_number=sale.block_number AND e.block_hash=sale.block_hash
    AND e.event_kind IN('listing_filled','offer_accepted')
   LEFT JOIN nft_m9_quarantined_evidence q ON q.chain_id=18881
    AND q.source_kind=sale.source_kind AND q.tx_hash=sale.tx_hash
    AND q.log_index=sale.log_index
   WHERE q.tx_hash IS NULL ${predicate}`,args
 );
 const floor=await getDb().query<{floor_wei:string|null}>(
  `SELECT min(l.unit_price_wei*l.quantity)::text AS floor_wei
    FROM nft_m7_signed_listings l
    JOIN nft_m9_order_checks c ON c.chain_id=18881 AND c.source_kind='m7_listing'
      AND c.order_hash=l.order_hash AND c.fillable_snapshot=true
      AND c.checked_at>now()-interval '5 minutes'
    JOIN nft_m9_market_cursor cursor ON cursor.chain_id=c.chain_id
      AND cursor.last_block=c.block_number AND cursor.last_hash=c.block_hash
    JOIN nft_collections k ON k.chain_id=l.chain_id
      AND k.contract_address=l.collection_address AND k.source_verified=true
    WHERE l.chain_id=18881 AND l.state='unverified_candidate'
      AND l.deadline>now() ${collection?"AND l.collection_address=$1":""}`,args
 );
 return {chainId:18881,coverage,
  verifiedSales:r.rows[0].count,verifiedVolumeWei:r.rows[0].volume_wei,
  verifiedFloorWei:null,indicativeAskFloorWei:floor.rows[0].floor_wei||null,
  warning:"Counts only independently attested, M9 canonical-matched M7/M8 settlement events. Indicative ask floor is a five-minute order snapshot, NOT guaranteed executable or a verified floor. Coverage may be stale."};
}
export async function marketOrderbook(collection:string|null){
 const coverage=await marketCoverage();
 if(!coverage.active||coverage.stale)return {chainId:18881,coverage,
  asks:[],bids:[],status:"unavailable",warning:"Verified live orderbook unavailable without fresh independent block coverage"};
 const args=collection?[collection]:[];
 const asks=await getDb().query(
  `SELECT l.order_hash AS hash,l.collection_address AS collection,
    l.token_standard AS standard,l.seller_wallet AS actor,l.token_id::text AS token_id,
    l.quantity::text AS quantity,(l.unit_price_wei*l.quantity)::text AS price_wei,
    c.block_number::text AS at_block,c.checked_at
   FROM nft_m7_signed_listings l
   JOIN nft_m9_order_checks c ON c.chain_id=18881 AND c.source_kind='m7_listing'
     AND c.order_hash=l.order_hash AND c.fillable_snapshot=true
     AND c.checked_at>now()-interval '5 minutes'
   JOIN nft_m9_market_cursor cursor ON cursor.chain_id=18881
     AND cursor.last_block=c.block_number AND cursor.last_hash=c.block_hash
   JOIN nft_collections k ON k.chain_id=l.chain_id
     AND k.contract_address=l.collection_address AND k.source_verified=true
   WHERE l.chain_id=18881 AND l.state='unverified_candidate' AND l.deadline>now()
   ${collection?"AND l.collection_address=$1":""}
   ORDER BY l.unit_price_wei*l.quantity ASC,l.order_hash LIMIT 30`,args
 );
 const bids=await getDb().query(
  `SELECT o.offer_hash AS hash,o.collection_address AS collection,
    o.token_standard AS standard,o.buyer_wallet AS actor,o.token_id::text AS token_id,
    o.quantity::text AS quantity,o.total_price_wei::text AS price_wei,
    c.block_number::text AS at_block,c.checked_at
   FROM nft_m8_offer_candidates o
   JOIN nft_m9_verified_offer_events e ON e.offer_hash=o.offer_hash
    AND e.chain_id=18881 AND e.event_kind='funded'
   JOIN nft_m9_market_blocks b ON b.chain_id=e.chain_id AND b.block_number=e.block_number
    AND b.block_hash=e.block_hash
   JOIN nft_m9_order_checks c ON c.chain_id=18881 AND c.source_kind='m8_offer'
    AND c.order_hash=o.offer_hash AND c.fillable_snapshot=true
    AND c.checked_at>now()-interval '5 minutes'
   JOIN nft_m9_market_cursor cursor ON cursor.chain_id=18881
    AND cursor.last_block=c.block_number AND cursor.last_hash=c.block_hash
   JOIN nft_collections k ON k.chain_id=o.chain_id
    AND k.contract_address=o.collection_address AND k.source_verified=true
   WHERE o.chain_id=18881 AND o.state='independently_funded' AND o.expires_at>now()
    AND NOT EXISTS(SELECT 1 FROM nft_m9_quarantined_evidence q WHERE
     q.chain_id=18881 AND q.source_kind='m8_offer' AND q.tx_hash=e.tx_hash
     AND q.log_index=e.log_index)
   ${collection?"AND o.collection_address=$1":""}
   ORDER BY o.total_price_wei DESC,o.offer_hash LIMIT 30`,args
 );
 return {chainId:18881,coverage,asks:asks.rows,bids:bids.rows,status:"read-only-verified-snapshots",
  warning:"Historical snapshot is NOT an executable orderbook. Always check current ownership/approval, escrow, nonce and wallet transaction confirmation."};
}
export async function privateNotifications(wallet:string){
 const r=await getDb().query(
  `SELECT n.source_kind,n.event_kind,n.tx_hash,n.log_index,n.block_number::text,
    n.block_hash,n.created_at
   FROM nft_m9_notifications n
   JOIN nft_m9_market_blocks b ON b.chain_id=n.chain_id
    AND b.block_number=n.block_number AND b.block_hash=n.block_hash
   LEFT JOIN nft_m9_quarantined_evidence q ON q.chain_id=n.chain_id
    AND q.source_kind=n.source_kind AND q.tx_hash=n.tx_hash
    AND q.log_index=n.log_index
   WHERE n.chain_id=18881 AND n.recipient_wallet=$1 AND q.tx_hash IS NULL
   ORDER BY n.block_number DESC,n.log_index DESC LIMIT 40`,[wallet.toLowerCase()]
 );
 return {chainId:18881,wallet:wallet.toLowerCase(),notifications:r.rows,
  warning:"Only independently verified canonical events generate notifications; no offchain or speculative sales."};
}
