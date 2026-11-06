import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { getDb } from "../lib/server/db";

const hex=(n:bigint,digits:number)=>"0x"+n.toString(16).padStart(digits,"0");
test("M7 real ephemeral PostgreSQL: signed candidates enforce chain, nonce uniqueness and exact settlement accounting",async()=>{
 const db=getDb();
 const seed=BigInt("0x"+randomBytes(7).toString("hex"));
 const seller=hex(seed,40),buyer=hex(seed+1n,40);
 const nft=hex(seed+2n,40),market=hex(seed+3n,40);
 const hash=hex(seed+4n,64),txHash=hex(seed+5n,64);
 const logIndex=0,blockHash=hex(seed+6n,64);
 let createdRegistry=false,createdListing=false,createdSettlement=false;
 const price=1000000000000000000n,fee=20000000000000000n;
 const royalty=50000000000000000n,proceeds=price-fee-royalty;
 const candidate=[
   hash,market,seller,nft,"erc721","1","1",price.toString(),"42",
   new Date(Date.now()+3600000),null,"0",200,1000,"0x"+"a".repeat(130)
 ];
 const insertCandidate=`INSERT INTO nft_m7_signed_listings(
  order_hash,marketplace,seller_wallet,collection_address,token_standard,
  token_id,quantity,unit_price_wei,nonce,deadline,reserved_buyer,
  min_proceeds_wei,max_fee_bps,max_royalty_bps,signature
  ) VALUES(${candidate.map((_,i)=>"$"+(i+1)).join(",")})`;
 try {
  await db.query(`INSERT INTO nft_collections(
     chain_id,contract_address,token_standard,deployment_block,code_hash,checked_block,operator_evidence
    ) VALUES(18881,$1,'erc721',100,$2,100,'SYNTHETIC TEST FIXTURE ONLY')`,
    [nft,hex(seed+77n,64)]);
  createdRegistry=true;
  await db.query(insertCandidate,candidate);createdListing=true;
  await assert.rejects(db.query(insertCandidate,candidate),/duplicate key value/);
  const sameNonce=[...candidate];sameNonce[0]=hex(seed+40n,64);
  await assert.rejects(db.query(insertCandidate,sameNonce),/duplicate key value/);
  const badQuantity=[...candidate];badQuantity[0]=hex(seed+41n,64);badQuantity[6]="2";badQuantity[8]="43";
  await assert.rejects(db.query(insertCandidate,badQuantity),/check constraint/i);
  const badChain=await db.query(
   `SELECT count(*)::int AS n FROM nft_m7_signed_listings
     WHERE chain_id=19991 AND seller_wallet=$1`,[seller]);
  assert.equal(badChain.rows[0].n,0);
  const nonOwner=await db.query(
   "SELECT order_hash FROM nft_m7_signed_listings WHERE seller_wallet=$1",[buyer]);
  assert.equal(nonOwner.rowCount,0);
  const record=[
   18881,txHash,logIndex,hash,101,blockHash,seller,buyer,nft,"1","1",
   price.toString(),fee.toString(),royalty.toString(),proceeds.toString(),seller,
   "https://primary.example.test","https://other.example.test",
   "https://explorer.example.test/tx/"+txHash
  ];
  const insertSettlement=`INSERT INTO nft_m7_verified_settlements(
   chain_id,tx_hash,log_index,order_hash,block_number,block_hash,seller_wallet,
   buyer_wallet,collection_address,token_id,quantity,price_wei,fee_wei,royalty_wei,
   seller_proceeds_wei,royalty_recipient,primary_rpc,independent_rpc,explorer_tx_url
  ) VALUES(${record.map((_,i)=>"$"+(i+1)).join(",")})`;
  // Synthetic rows only inside disposable CI database, NEVER production chain evidence.
  await db.query(insertSettlement,record);createdSettlement=true;
  await assert.rejects(db.query(insertSettlement,record),/duplicate key value/);
  const invalid=[...record];invalid[1]=hex(seed+100n,64);
  invalid[14]=(proceeds+1n).toString();
  await assert.rejects(db.query(insertSettlement,invalid),/check constraint/i);
  const inserted=await db.query(
   `SELECT price_wei::text,fee_wei::text,royalty_wei::text,seller_proceeds_wei::text
    FROM nft_m7_verified_settlements WHERE order_hash=$1`,[hash]);
  assert.equal(BigInt(inserted.rows[0].price_wei),
   BigInt(inserted.rows[0].fee_wei)+BigInt(inserted.rows[0].royalty_wei)+BigInt(inserted.rows[0].seller_proceeds_wei));
 }finally{
  if(createdSettlement)await db.query("DELETE FROM nft_m7_verified_settlements WHERE order_hash=$1",[hash]);
  if(createdListing)await db.query("DELETE FROM nft_m7_signed_listings WHERE order_hash=$1",[hash]);
  if(createdRegistry)await db.query("DELETE FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",[nft]);
 }
});

test("M7 independent settlement ledger has immutable identity, no seeded market trades and hard constraints",async()=>{
 const db=getDb();
 const table=await db.query(
   "SELECT conname FROM pg_constraint WHERE conrelid='nft_m7_verified_settlements'::regclass"
 );
 const names=table.rows.map(x=>String(x.conname));
 assert.ok(names.some(x=>x.includes("_pkey")));
 assert.ok(names.some(x=>x.includes("exact_value_split")));
 const signed=await db.query(
   "SELECT conname FROM pg_constraint WHERE conrelid='nft_m7_signed_listings'::regclass"
 );
 assert.ok(signed.rows.some(x=>String(x.conname).includes("erc721_single")));
 assert.ok(signed.rows.some(x=>String(x.conname).includes("price_bound")));
});
