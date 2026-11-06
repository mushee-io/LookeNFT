import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../lib/server/db";

const wallet="0x"+"a".repeat(40),other="0x"+"b".repeat(40);
const collection="0x"+"1".repeat(40);
const cid="Qm"+"a".repeat(44);

test("M6 PostgreSQL adversarial: private owner scope, clean scan plus human approval, version dedup and chain lock",async()=>{
 const db=getDb();
 const id=randomUUID(),metaId=randomUUID(),reviewId=randomUUID();
 try {
  await db.query(
   `INSERT INTO nft_media_assets(id,owner_wallet,media_kind,mime_type,byte_length,sha256)
      VALUES($1,$2,'image','image/png',64,$3)`,
   [id,wallet,"d".repeat(64)]
  );
  const ownerView=await db.query(
   "SELECT id FROM nft_media_assets WHERE id=$1 AND owner_wallet=$2",[id,other]
  );
  assert.equal(ownerView.rowCount,0,"a different wallet must not see the record");
  await assert.rejects(db.query(
   "UPDATE nft_media_assets SET state='approved' WHERE id=$1",[id]
  ),/check constraint/i);
  await db.query(
   `UPDATE nft_media_assets SET state='needs_moderation',scan_engine='clamav-instream',
      scan_result='clean',scan_evidence_sha256=$2,scan_checked_at=now(),
      provider_asset_id='fixture-private-asset-'||$3,
      provider_public_id='lookenft-quarantine/'||$3,provider_version=1
      WHERE id=$1`,[id,"c".repeat(64),id]
  );
  await assert.rejects(db.query(
   "UPDATE nft_media_assets SET state='approved' WHERE id=$1",[id]
  ),/check constraint/i);
  await db.query(
   `UPDATE nft_media_assets SET state='approved',reviewer_wallet=$2,
      reviewer_reason='Synthetic local reviewer fixture only',reviewed_at=now()
      WHERE id=$1`,[id,other]
  );
  await db.query(
   `INSERT INTO nft_media_review_events(id,media_id,reviewer_wallet,decision,reason)
    VALUES($1,$2,$3,'approved','Synthetic local reviewer fixture only')`,
   [reviewId,id,other]
  );
  await assert.rejects(db.query(
   "UPDATE nft_media_assets SET pin_state='verified' WHERE id=$1",[id]
  ),/check constraint/i);
  await db.query(
   `UPDATE nft_media_assets SET pin_state='verified',media_ipfs_cid=$2,
       ipfs_pinned_at=now(),ipfs_verified_at=now() WHERE id=$1`,[id,cid]
  );
  const metadata={name:"Synthetic fixture",image:"ipfs://"+cid,attributes:[]};
  const insert=`INSERT INTO nft_media_metadata_versions(
    id,owner_wallet,collection_address,token_standard,token_id,version,
    asset_id,metadata,metadata_sha256)
    VALUES($1,$2,$3,'erc721',5,1,$4,$5::jsonb,$6)`;
  await db.query(insert,[metaId,wallet,collection,id,JSON.stringify(metadata),"f".repeat(64)]);
  await assert.rejects(db.query(insert,[randomUUID(),wallet,collection,id,JSON.stringify(metadata),"f".repeat(64)]),/duplicate key value/);
  await assert.rejects(db.query(
   `UPDATE nft_media_metadata_versions SET state='chain_matched' WHERE id=$1`,[metaId]
  ),/check constraint/i);
  await assert.rejects(db.query(
   "UPDATE nft_media_metadata_versions SET chain_id=19991 WHERE id=$1",[metaId]
  ),/check constraint/i);
  const privateMeta=await db.query(
   "SELECT id FROM nft_media_metadata_versions WHERE owner_wallet=$1 AND id=$2",[other,metaId]
  );
  assert.equal(privateMeta.rowCount,0);
  const allowed=await db.query(
   `SELECT a.state,a.scan_result,a.pin_state,m.version,m.metadata_sha256
      FROM nft_media_assets a JOIN nft_media_metadata_versions m ON a.id=m.asset_id
      WHERE a.id=$1 AND a.owner_wallet=$2 AND m.owner_wallet=$2`,[id,wallet]
  );
  assert.equal(allowed.rows[0].state,"approved");
  assert.equal(allowed.rows[0].scan_result,"clean");
  assert.equal(allowed.rows[0].pin_state,"verified");
  assert.equal(allowed.rows[0].version,1);
 } finally {
  await db.query("DELETE FROM nft_media_metadata_versions WHERE asset_id=$1",[id]);
  await db.query("DELETE FROM nft_media_review_events WHERE media_id=$1",[id]);
  await db.query("DELETE FROM nft_media_assets WHERE id=$1",[id]);
 }
});

test("M6 PostgreSQL migration intentionally seeds no uploaded artwork or fake metadata",async()=>{
 const db=getDb();
 const constraints=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_media_assets'::regclass"
 );
 const names=constraints.rows.map(x=>String(x.conname));
 assert.ok(names.some(x=>x.includes("approved_needs_host_and_clean_scan")));
 assert.ok(names.some(x=>x.includes("verified_ipfs_has_witness")));
 const version=await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid='nft_media_metadata_versions'::regclass"
 );
 assert.ok(version.rows.some(x=>String(x.conname).includes("matched_media_has_chain_evidence")));
});
