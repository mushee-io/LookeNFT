import type {Pool,PoolClient} from "pg";
import {decodeMarketLog,equalWitnessLogs,hasAncestorContinuity,
 type MarketHeader,type RawMarketLog,type MarketEvent} from "./market";
import type {Address} from "viem";

export type MarketReader={
 chainIds():Promise<[number,number]>;
 heads():Promise<[bigint,bigint]>;
 header(height:bigint,source:"primary"|"independent"):Promise<MarketHeader>;
 logs(from:bigint,to:bigint,source:"primary"|"independent"):Promise<RawMarketLog[]>;
 explorerAgrees(header:MarketHeader):Promise<boolean>;
 contractChecks():Promise<boolean>;
};
export type SyncOptions={
 startBlock:bigint;confirmations:number;maxBlocks:number;maxReorgDepth:number;
 listing:Address;vault:Address;
};
export function assertSyncConfig(o:SyncOptions):void{
 if(o.startBlock<1n||!Number.isSafeInteger(o.confirmations)||o.confirmations<12||
  !Number.isSafeInteger(o.maxBlocks)||o.maxBlocks<1||o.maxBlocks>25||
  !Number.isSafeInteger(o.maxReorgDepth)||o.maxReorgDepth<1||o.maxReorgDepth>100)
  throw Error("M9 configuration must be Testnet, >=12 confirmations, at most 25 blocks and bounded 100-block rollback");
}
const lc=(s:string)=>s.toLowerCase();
async function sameHeader(reader:MarketReader,height:bigint):Promise<MarketHeader>{
 const [a,b]=await Promise.all([reader.header(height,"primary"),reader.header(height,"independent")]);
 if(a.number!==height||b.number!==height||lc(a.hash)!==lc(b.hash)||
  lc(a.parentHash)!==lc(b.parentHash))throw Error("Independent RPC canonical header mismatch");
 return a;
}
async function notifyVerifiedOnly(db:PoolClient){
 // No primary-RPC-only sale event is sufficient: exact independently attested
 // M7/M8 transaction, block hash and log index must match canonical M9 scan.
 await db.query(`
 INSERT INTO nft_m9_notifications(
  chain_id,recipient_wallet,source_kind,tx_hash,log_index,event_kind,block_number,block_hash)
 SELECT m.chain_id,r.wallet,'m7_sale',m.tx_hash,m.log_index,'sale',m.block_number,m.block_hash
 FROM nft_m9_market_events m
 JOIN nft_m7_verified_settlements s ON s.chain_id=m.chain_id AND s.tx_hash=m.tx_hash
  AND s.log_index=m.log_index AND s.block_number=m.block_number AND s.block_hash=m.block_hash
 CROSS JOIN LATERAL (VALUES (s.seller_wallet),(s.buyer_wallet)) r(wallet)
 WHERE m.chain_id=18881 AND m.event_kind='listing_filled'
  AND m.order_hash=s.order_hash AND r.wallet IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM nft_m9_quarantined_evidence q WHERE
   q.chain_id=m.chain_id AND q.source_kind='m7_sale' AND q.tx_hash=m.tx_hash
   AND q.log_index=m.log_index)
 ON CONFLICT DO NOTHING`);
 await db.query(`
 INSERT INTO nft_m9_notifications(
  chain_id,recipient_wallet,source_kind,tx_hash,log_index,event_kind,block_number,block_hash)
 SELECT m.chain_id,r.wallet,'m8_offer',m.tx_hash,m.log_index,
  CASE s.event_kind WHEN 'accepted' THEN 'offer_accepted'
   WHEN 'refunded' THEN 'offer_refunded' ELSE 'offer_funded' END,
  m.block_number,m.block_hash
 FROM nft_m9_market_events m
 JOIN nft_m8_verified_offer_events s ON s.chain_id=m.chain_id AND s.tx_hash=m.tx_hash
  AND s.log_index=m.log_index AND s.block_number=m.block_number AND s.block_hash=m.block_hash
 CROSS JOIN LATERAL (VALUES (s.buyer_wallet),
  (CASE WHEN s.event_kind='accepted' THEN s.counterparty_wallet ELSE NULL END)) r(wallet)
 WHERE m.chain_id=18881 AND m.event_kind=CASE s.event_kind
  WHEN 'accepted' THEN 'offer_accepted' WHEN 'refunded' THEN 'offer_refunded'
  ELSE 'offer_funded' END
  AND m.order_hash=s.offer_hash AND r.wallet IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM nft_m9_quarantined_evidence q WHERE
   q.chain_id=m.chain_id AND q.source_kind='m8_offer' AND q.tx_hash=m.tx_hash
   AND q.log_index=m.log_index)
 ON CONFLICT DO NOTHING`);
}
export async function reconcileOnce(reader:MarketReader,pool:Pool,o:SyncOptions){
 assertSyncConfig(o);
 const ids=await reader.chainIds();
 if(ids[0]!==18881||ids[1]!==18881)throw Error("M9 refuses wrong-chain RPC");
 if(!await reader.contractChecks())throw Error("M7/M8 Testnet contract version and bytecode not independently verified");
 const heads=await reader.heads();
 const finalHead=[heads[0]-BigInt(o.confirmations),heads[1]-BigInt(o.confirmations)]
  .reduce((a,b)=>a<b?a:b);
 if(finalHead<o.startBlock-1n)throw Error("Not enough independently confirmed Ultra Testnet blocks");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(18881,9009)");
  const initial=await client.query<{start_block:string;last_block:string;last_hash:string}>(
   "SELECT start_block,last_block,last_hash FROM nft_m9_market_cursor WHERE chain_id=18881 FOR UPDATE"
  );
  let cursor:MarketHeader;
  if(initial.rowCount===0){
   const anchor=await sameHeader(reader,o.startBlock-1n);
   if(!await reader.explorerAgrees(anchor))throw Error("Independent Blockscout anchor failed");
   await client.query(`INSERT INTO nft_m9_market_cursor(chain_id,start_block,last_block,last_hash)
    VALUES(18881,$1,$2,$3)`,[o.startBlock.toString(),anchor.number.toString(),lc(anchor.hash)]);
   await client.query(`INSERT INTO nft_m9_market_blocks(chain_id,block_number,block_hash,parent_hash)
    VALUES(18881,$1,$2,$3)`,[anchor.number.toString(),lc(anchor.hash),lc(anchor.parentHash)]);
   cursor=anchor;
  }else {
   const state=initial.rows[0];
   if(BigInt(state.start_block)!==o.startBlock)throw Error("M9 cannot silently change indexer start block");
   let height=BigInt(state.last_block);
   if(height>finalHead)throw Error("Stored cursor exceeds independent confirmed head");
   const actual=await sameHeader(reader,height);
   if(lc(actual.hash)!==lc(state.last_hash)){
    let ancestor:MarketHeader|null=null;
    for(let depth=0;depth<=o.maxReorgDepth&&height>=o.startBlock-1n;depth++,height--){
     const saved=await client.query<{block_hash:string}>(
      "SELECT block_hash FROM nft_m9_market_blocks WHERE chain_id=18881 AND block_number=$1",
      [height.toString()]);
     if(saved.rowCount!==1)throw Error("Indexer canonical journal is incomplete");
     const remote=await sameHeader(reader,height);
     if(lc(saved.rows[0].block_hash)===lc(remote.hash)){ancestor=remote;break;}
    }
    if(!ancestor)throw Error("Market reorg exceeds bounded rollback; operator recovery required");
    // Historical source claims beyond ancestor must not survive as verified volume.
    for(const source of ["m7_sale","m8_offer"] as const){
     const table=source==="m7_sale"?"nft_m7_verified_settlements":"nft_m8_verified_offer_events";
     await client.query(`
      INSERT INTO nft_m9_quarantined_evidence(
       chain_id,source_kind,tx_hash,log_index,orphaned_block,orphaned_hash)
      SELECT chain_id,$1,tx_hash,log_index,block_number,block_hash
      FROM ${table} WHERE chain_id=18881 AND block_number>$2
      ON CONFLICT DO NOTHING`,[source,ancestor.number.toString()]);
    }
    await client.query(
     "DELETE FROM nft_m9_market_blocks WHERE chain_id=18881 AND block_number>$1",
     [ancestor.number.toString()]);
    await client.query(
     "UPDATE nft_m9_market_cursor SET last_block=$1,last_hash=$2,updated_at=now() WHERE chain_id=18881",
     [ancestor.number.toString(),lc(ancestor.hash)]);
    cursor=ancestor;
   }else cursor=actual;
  }
  const end=cursor.number+BigInt(o.maxBlocks)<finalHead?
   cursor.number+BigInt(o.maxBlocks):finalHead;
  if(end<=cursor.number){
   await notifyVerifiedOnly(client);
   await client.query("COMMIT");
   return {chainId:18881,processed:0,from:cursor.number.toString(),to:cursor.number.toString(),
    independent:true,replaySafe:true,financialExecution:false};
  }
  const start=cursor.number+1n;
  // Entire range must have matching log witnesses; NEVER fallback to fake data.
  const [a,b]=await Promise.all([
   reader.logs(start,end,"primary"),reader.logs(start,end,"independent")
  ]);
  if(!equalWitnessLogs(a,b))throw Error("Independent market logs disagree: no checkpoint changes committed");
  const entries=new Map<string,MarketEvent[]>();
  for(const l of a){
   if(l.blockNumber<start||l.blockNumber>end)throw Error("RPC returned out-of-window market event");
   const decoded=decodeMarketLog(l,o.listing,o.vault);
   if(decoded){
    const key=l.blockNumber.toString();const list=entries.get(key)||[];
    list.push(decoded);entries.set(key,list);
   }
  }
  let previous=cursor;
  for(let number=start;number<=end;number++){
   const current=await sameHeader(reader,number);
   if(!hasAncestorContinuity(previous,current))throw Error("Parent hash divergence in confirmed range");
   if(!await reader.explorerAgrees(current))throw Error("Blockscout 404 or canonical block mismatch; no market evidence saved");
   await client.query(`INSERT INTO nft_m9_market_blocks(chain_id,block_number,block_hash,parent_hash)
    VALUES(18881,$1,$2,$3)`,[number.toString(),lc(current.hash),lc(current.parentHash)]);
   for(const e of entries.get(number.toString())||[]){
    if(lc(e.blockHash)!==lc(current.hash))throw Error("Log cites orphaned or fake block");
    const v=[e.txHash,e.logIndex,e.blockNumber,e.blockHash,e.marketAddress,e.kind,
     e.orderHash,e.actor,e.counterparty,e.collection,e.tokenId,e.nonce,e.quantity,e.totalPriceWei];
    const inserted=await client.query(`INSERT INTO nft_m9_market_events(
      chain_id,tx_hash,log_index,block_number,block_hash,market_address,
      event_kind,order_hash,actor_wallet,counterparty_wallet,
      collection_address,token_id,nonce,quantity,total_price_wei)
      VALUES(18881,${v.map((_,i)=>"$"+(i+1)).join(",")})
      ON CONFLICT DO NOTHING RETURNING tx_hash`,v);
    if(inserted.rowCount!==1)throw Error("Unexpected duplicate market log in supposedly new block");
   }
   previous=current;
  }
  await client.query(
   "UPDATE nft_m9_market_cursor SET last_block=$1,last_hash=$2,updated_at=now() WHERE chain_id=18881",
   [end.toString(),lc(previous.hash)]);
  await notifyVerifiedOnly(client);
  await client.query("COMMIT");
  return {chainId:18881,processed:Number(end-start+1n),from:start.toString(),
   to:end.toString(),events:a.length,independent:true,replaySafe:true,
   financialExecution:false};
 }catch(error){await client.query("ROLLBACK");throw error;}
 finally{client.release();}
}
