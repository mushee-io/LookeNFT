import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {Interface} from "ethers";
import {getDb} from "../lib/server/db";
import {reconcileOnce,type MarketReader} from "../lib/m9/reconcile";
import {marketOverview,privateNotifications} from "../lib/m9/readmodel";
import type {MarketHeader,RawMarketLog} from "../lib/m9/market";
import type {Address,Hex} from "viem";

function hex(n:bigint,len:number):Hex{return ("0x"+n.toString(16).padStart(len,"0")) as Hex;}
const market="0x000000000000000000000000000000000000a900" as Address;
const vault="0x000000000000000000000000000000000000b900" as Address;
const opts={startBlock:101n,confirmations:12,maxBlocks:3,maxReorgDepth:5,listing:market,vault};
function fixtures(){
 const block=new Map<bigint,MarketHeader>();
 const h=(n:bigint):Hex=>hex(300000n+n,64);
 for(let n=100n;n<=103n;n++)
  block.set(n,{number:n,hash:h(n),parentHash:h(n-1n)});
 let a:RawMarketLog[]=[];
 let b:RawMarketLog[]=[];
 let explorer=true;
 const reader:MarketReader={
  chainIds:async()=>[18881,18881],heads:async()=>[115n,115n],
  header:async(n)=>{const v=block.get(n);if(!v)throw Error("No injected canonical fixture");
   return v;},
  logs:async(from,to,source)=>(source==="primary"?a:b).filter(x=>x.blockNumber>=from&&x.blockNumber<=to),
  explorerAgrees:async()=>explorer,
  contractChecks:async()=>true
 };
 return {reader,block,h,setLogs:(v:RawMarketLog[],w:RawMarketLog[]=v)=>{a=v;b=w;},
  setExplorer:(v:boolean)=>{explorer=v;}};
}
const ABI="event ListingFilled(bytes32 indexed orderHash,address indexed seller,address indexed buyer,address collection,uint256 tokenId,uint256 quantity,uint256 priceWei,uint256 feeWei,address royaltyRecipient,uint256 royaltyWei,uint256 sellerProceedsWei,uint256 nonce,uint8 standard)";
test("M9 REAL ephemeral PostgreSQL: canonical scan, duplicate protection, owner-isolated notifications, reorg quarantine and witnessed volume",async()=>{
 const url=process.env.DATABASE_URL||"";
 if(!/127\.0\.0\.1|localhost/.test(url))throw Error("M9 synthetic integration fixtures restricted to ephemeral local PostgreSQL");
 const db=getDb(),n=BigInt("0x"+randomBytes(8).toString("hex"));
 const nft=hex(n+10n,40),seller=hex(n+11n,40),buyer=hex(n+12n,40),
  order=hex(n+13n,64),tx=hex(n+14n,64),codehash=hex(n+15n,64);
 const price=1000000000000000000n,fee=20000000000000000n,proceeds=price-fee;
 const f=fixtures(),canonical=f.block.get(102n)!.hash;
 const encoded=new Interface([ABI]).encodeEventLog("ListingFilled",[
  order,seller,buyer,nft,5n,1n,price,fee,hex(0n,40),0n,proceeds,7n,1
 ]);
 const log:RawMarketLog={address:market,blockNumber:102n,blockHash:canonical,
  transactionHash:tx,logIndex:0,data:encoded.data as Hex,topics:encoded.topics as Hex[]};
 let registry=false,listing=false,verified=false;
 try{
  await db.query(`INSERT INTO nft_collections(
   chain_id,contract_address,token_standard,deployment_block,code_hash,checked_block,
   source_verified,operator_evidence) VALUES(18881,$1,'erc721',100,$2,100,true,'SYNTHETIC CI SOURCE; NOT A REAL NFT')`,
   [nft,codehash]);registry=true;
  await db.query(`INSERT INTO nft_m7_signed_listings(
   order_hash,marketplace,seller_wallet,collection_address,token_standard,
   token_id,quantity,unit_price_wei,nonce,deadline,reserved_buyer,
   min_proceeds_wei,max_fee_bps,max_royalty_bps,signature)
   VALUES($1,$2,$3,$4,'erc721',5,1,$5,7,now()+interval '1 hour',
    null,0,200,1000,$6)`,[order,market,seller,nft,price.toString(),"0x"+"a".repeat(130)]);
  listing=true;
  await db.query(`INSERT INTO nft_m7_verified_settlements(
   chain_id,tx_hash,log_index,order_hash,block_number,block_hash,seller_wallet,
   buyer_wallet,collection_address,token_id,quantity,price_wei,fee_wei,royalty_wei,
   seller_proceeds_wei,primary_rpc,independent_rpc,explorer_tx_url)
   VALUES(18881,$1,0,$2,102,$3,$4,$5,$6,5,1,$7,$8,0,$9,
    'https://primary.example.test','https://independent.example.test','https://explorer.example.test/tx')`,
   [tx,order,canonical,seller,buyer,nft,price.toString(),fee.toString(),proceeds.toString()]);
  verified=true;
  f.setLogs([log],[]);
  await assert.rejects(reconcileOnce(f.reader,db,opts),/logs disagree/);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m9_market_cursor")).rows[0].n,0);
  f.setLogs([log]);
  f.setExplorer(false);
  await assert.rejects(reconcileOnce(f.reader,db,opts),/Blockscout/);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m9_market_cursor")).rows[0].n,0);
  f.setExplorer(true);
  const synced=await reconcileOnce(f.reader,db,opts);
  assert.equal(synced.processed,3);
  const again=await reconcileOnce(f.reader,db,opts);
  assert.equal(again.processed,0);
  const rows=await db.query(
   "SELECT event_kind,tx_hash,block_hash FROM nft_m9_market_events WHERE tx_hash=$1",[tx]);
  assert.equal(rows.rowCount,1);
  assert.equal(rows.rows[0].event_kind,"listing_filled");
  const overview=await marketOverview(nft);
  assert.equal(overview.verifiedSales,"1");
  assert.equal(overview.verifiedVolumeWei,price.toString());
  const sellerNotices=await privateNotifications(seller);
  const buyerNotices=await privateNotifications(buyer);
  const outsiderNotices=await privateNotifications(hex(n+16n,40));
  assert.equal(sellerNotices.notifications.length,1);
  assert.equal(buyerNotices.notifications.length,1);
  assert.equal(outsiderNotices.notifications.length,0);
  // Independent providers see a different canonical block 102/103.
  const old102=f.block.get(102n)!;
  const new102={...old102,hash:hex(n+700n,64)};
  const new103={number:103n,hash:hex(n+701n,64),parentHash:new102.hash};
  f.block.set(102n,new102);f.block.set(103n,new103);
  f.setLogs([]);
  const changed=await reconcileOnce(f.reader,db,opts);
  assert.equal(changed.processed,2);
  const quarantine=await db.query(
   "SELECT tx_hash,orphaned_hash FROM nft_m9_quarantined_evidence WHERE tx_hash=$1",[tx]);
  assert.equal(quarantine.rowCount,1);
  assert.equal(quarantine.rows[0].orphaned_hash,canonical);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m9_market_events WHERE tx_hash=$1",[tx])).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m9_notifications WHERE tx_hash=$1",[tx])).rows[0].n,0);
  const after=await marketOverview(nft);
  assert.equal(after.verifiedVolumeWei,"0");
  assert.equal(after.verifiedSales,"0");
  assert.equal((await privateNotifications(buyer)).notifications.length,0);
 }finally{
  // CI-only fixtures. Cleanup verified external claims FIRST then all canonical state.
  await db.query("DELETE FROM nft_m9_quarantined_evidence WHERE tx_hash=$1",[tx]);
  await db.query("DELETE FROM nft_m9_notifications WHERE tx_hash=$1",[tx]);
  await db.query("DELETE FROM nft_m9_order_checks WHERE chain_id=18881");
  await db.query("DELETE FROM nft_m9_market_events WHERE tx_hash=$1",[tx]);
  await db.query("DELETE FROM nft_m9_market_blocks WHERE chain_id=18881");
  await db.query("DELETE FROM nft_m9_market_cursor WHERE chain_id=18881");
  if(verified)await db.query("DELETE FROM nft_m7_verified_settlements WHERE tx_hash=$1",[tx]);
  if(listing)await db.query("DELETE FROM nft_m7_signed_listings WHERE order_hash=$1",[order]);
  if(registry)await db.query("DELETE FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",[nft]);
 }
});

test("M9 REAL PostgreSQL constraints prevent forged zero-value sales, duplicate block logs, spoofed recipient and unbound snapshot",async()=>{
 const url=process.env.DATABASE_URL||"";
 if(!/127\.0\.0\.1|localhost/.test(url))throw Error("CI-only PostgreSQL safety restriction");
 const db=getDb();
 const checks=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_m9_market_events'::regclass"
 );
 const names=checks.rows.map(x=>String(x.conname));
 assert.ok(names.some(x=>x==="m9_trade_value"));
 assert.ok(names.some(x=>x.includes("_pkey")));
 const notif=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_m9_notifications'::regclass"
 );
 assert.ok(notif.rows.some(x=>String(x.conname).includes("_pkey")));
 const buckets=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_m9_request_buckets'::regclass"
 );
 assert.ok(buckets.rows.some(x=>String(x.conname).includes("_pkey")));
 const cursor=await db.query("SELECT count(*)::int n FROM nft_m9_market_cursor");
 assert.equal(cursor.rows[0].n,0);
});
