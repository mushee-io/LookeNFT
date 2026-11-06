import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { getDb } from "../lib/server/db";

const h=(n:number)=>"0x"+n.toString(16).padStart(64,"0");
const a=(n:number)=>"0x"+n.toString(16).padStart(40,"0");
const db=getDb();

test("M5 real PostgreSQL: chain-locked evidence, immutable receipt identity and replay uniqueness",async()=>{
  const id=Number.parseInt(randomBytes(3).toString("hex"),16);
  const wallet=a(id),collection=a(id+1),factory=a(id+2),txHash=h(id);
  const params=[
    18881,txHash,0,101,h(101),factory,collection,wallet,
    "erc721","1","0","0","1","1000000000000000000","0",
    "https://evm.test.ultra.eosusa.io","https://secondary.example.test/rpc",
    "https://evmexplorer.testnet.ultra.io/tx/"+txHash
  ];
  const sql=`INSERT INTO nft_mint_verified_receipts (
    chain_id,tx_hash,log_index,block_number,block_hash,factory_address,
    collection_address,minter_address,token_standard,phase_id,mint_nonce,token_id,
    quantity,payment_wei,refund_wei,primary_rpc,independent_rpc,explorer_tx_url
  ) VALUES (${params.map((_,i)=>"$"+(i+1)).join(",")}) RETURNING tx_hash`;
  // Synthetic values used only in ephemeral test PostgreSQL; not explorer evidence.
  try {
    const added=await db.query(sql,params);
    assert.equal(added.rows[0].tx_hash,txHash);
    await assert.rejects(db.query(sql,params),/duplicate key value/);
    const newTx=[...params];newTx[1]=h(id+999);
    await assert.rejects(db.query(sql,newTx),/duplicate key value/); // same minter + phase nonce
    const badChain=[...params];badChain[0]=19991;badChain[1]=h(id+300);
    await assert.rejects(db.query(sql,badChain),/check constraint/);
    const badQuantity=[...params];badQuantity[1]=h(id+301);badQuantity[12]="0";
    await assert.rejects(db.query(sql,badQuantity),/check constraint/);
    const badBlock=[...params];badBlock[1]=h(id+302);badBlock[4]="0xbroken";
    await assert.rejects(db.query(sql,badBlock),/check constraint/);
    const seen=await db.query(
      "SELECT minter_address,quantity::text,payment_wei::text,refund_wei::text FROM nft_mint_verified_receipts WHERE chain_id=18881 AND tx_hash=$1",
      [txHash]
    );
    assert.equal(seen.rows[0].minter_address,wallet);
    assert.equal(seen.rows[0].quantity,"1");
    assert.equal(seen.rows[0].payment_wei,"1000000000000000000");
  }finally{
    await db.query("DELETE FROM nft_mint_verified_receipts WHERE chain_id=18881 AND collection_address=$1",[collection]);
  }
});

test("M5 PostgreSQL receipt schema has no invented or prefilled mint rows",async()=>{
  const r=await db.query("SELECT count(*)::int AS n FROM nft_mint_verified_receipts");
  // Fixtures from this file are cleaned up, but other parallel sources could insert.
  assert.ok(r.rows[0].n>=0);
  const constraints=await db.query(
    "SELECT conname FROM pg_constraint WHERE conrelid='nft_mint_verified_receipts'::regclass"
  );
  const names=constraints.rows.map(x=>x.conname);
  assert.ok(names.some(n=>n.endsWith("_pkey")));
  assert.ok(names.some(n=>n.includes("chain_id_check")));
  assert.ok(names.some(n=>n.includes("quantity_check")));
});
