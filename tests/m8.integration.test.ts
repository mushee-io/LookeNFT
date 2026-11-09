import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {getDb} from "../lib/server/db";

const hex=(x:bigint,len:number)=>"0x"+x.toString(16).padStart(len,"0");
test("M8 real PostgreSQL: no fake bids, unique buyer nonce, chain-locked escrow and value accounting",async()=>{
 const db=getDb(),n=BigInt("0x"+randomBytes(7).toString("hex"));
 const buyer=hex(n,40),seller=hex(n+1n,40),nft=hex(n+2n,40),vault=hex(n+3n,40);
 const digest=hex(n+4n,64),fundHash=hex(n+5n,64),blockHash=hex(n+6n,64);
 const price="1000000000000000000",fee="20000000000000000";
 const royalty="50000000000000000",proceeds="930000000000000000";
 let registry=false,candidate=false,verified=false;
 const args=[digest,vault,buyer,nft,"erc721","7","1",price,"103",
  new Date(Date.now()+3600000),null,"0",200,1000,"0x"+"a".repeat(130),
  fundHash,100,blockHash];
 const sql=`INSERT INTO nft_m8_offer_candidates(
  offer_hash,vault_address,buyer_wallet,collection_address,token_standard,token_id,
  quantity,total_price_wei,nonce,expires_at,allowed_seller,min_seller_proceeds_wei,
  max_fee_bps,max_royalty_bps,signature,funding_tx_hash,funding_block_number,funding_block_hash
 ) VALUES(${args.map((_,i)=>"$"+(i+1)).join(",")})`;
 try {
  await db.query(`INSERT INTO nft_collections(
   chain_id,contract_address,token_standard,deployment_block,code_hash,checked_block,operator_evidence
  ) VALUES (18881,$1,'erc721',100,$2,100,'SYNTHETIC M8 CI FIXTURE NOT AN NFT')`,
   [nft,hex(n+20n,64)]);registry=true;
  await db.query(sql,args);candidate=true;
  await assert.rejects(db.query(sql,args),/duplicate key value/i);
  const doubleNonce=[...args];doubleNonce[0]=hex(n+25n,64);doubleNonce[15]=hex(n+26n,64);
  await assert.rejects(db.query(sql,doubleNonce),/duplicate key value/i);
  const overfund=[...args];overfund[0]=hex(n+30n,64);overfund[8]="104";
  overfund[15]=hex(n+31n,64);overfund[7]="1001000000000000000000";
  await assert.rejects(db.query(sql,overfund),/check constraint/i);
  const fakeQuantity=[...args];fakeQuantity[0]=hex(n+40n,64);
  fakeQuantity[8]="105";fakeQuantity[15]=hex(n+41n,64);fakeQuantity[6]="2";
  await assert.rejects(db.query(sql,fakeQuantity),/check constraint/i);
  const wrongOwner=await db.query("SELECT offer_hash FROM nft_m8_offer_candidates WHERE buyer_wallet=$1",[seller]);
  assert.equal(wrongOwner.rowCount,0);
  const row=[18881,fundHash,0,digest,"funded",100,blockHash,buyer,null,nft,price,
    "0","0","0","https://primary.testnet.example","https://secondary.testnet.example",
    "https://explorer.example/tx/"+fundHash];
  const insert=`INSERT INTO nft_m8_verified_offer_events(
   chain_id,tx_hash,log_index,offer_hash,event_kind,block_number,block_hash,
   buyer_wallet,counterparty_wallet,collection_address,total_price_wei,
   fee_wei,royalty_wei,seller_proceeds_wei,primary_rpc,independent_rpc,explorer_url
  ) VALUES(${row.map((_,i)=>"$"+(i+1)).join(",")})`;
  await db.query(insert,row);verified=true;
  await assert.rejects(db.query(insert,row),/duplicate key value/i);
  const invalid=[...row];invalid[1]=hex(n+77n,64);invalid[4]="accepted";
  invalid[11]=fee;invalid[12]=royalty;invalid[13]="1";
  await assert.rejects(db.query(insert,invalid),/check constraint/i);
  const refundedWrong=[...row];refundedWrong[1]=hex(n+80n,64);refundedWrong[4]="refunded";
  refundedWrong[11]=fee;
  await assert.rejects(db.query(insert,refundedWrong),/check constraint/i);
  const found=await db.query(
   "SELECT state,total_price_wei::text,nonce::text FROM nft_m8_offer_candidates WHERE offer_hash=$1",
   [digest]);
  assert.equal(found.rows[0].state,"primary_rpc_funded_unverified");
  assert.equal(found.rows[0].total_price_wei,price);
 }finally{
  if(verified)await db.query("DELETE FROM nft_m8_verified_offer_events WHERE offer_hash=$1",[digest]);
  if(candidate)await db.query("DELETE FROM nft_m8_offer_candidates WHERE offer_hash=$1",[digest]);
  if(registry)await db.query("DELETE FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",[nft]);
 }
});

test("M8 ephemeral PostgreSQL constraints enforce event kind and exact full seller split",async()=>{
 const db=getDb();
 const constraints=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_m8_verified_offer_events'::regclass"
 );
 const names=constraints.rows.map(x=>String(x.conname));
 assert.ok(names.some(x=>x==="m8_full_payout"));
 assert.ok(names.some(x=>x.includes("_pkey")));
 const candidate=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_m8_offer_candidates'::regclass"
 );
 assert.ok(candidate.rows.some(x=>String(x.conname).includes("_pkey")));
 assert.ok(candidate.rows.some(x=>String(x.conname).includes("chain_id_check")));
});
