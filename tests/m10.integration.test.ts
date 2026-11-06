import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {SignJWT} from "jose";
import {getDb} from "../lib/server/db";
import {saveSocialSnapshot,limitSocialWallet} from "../lib/m10/bridge";
import type {SocialTrust} from "../lib/m10/claims";

const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const trust:SocialTrust={
 issuer:"https://integration.looke.test.example",
 publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString(),
 expectedSourceCommit:"f".repeat(40),mediaHosts:[]
};
function wallet():string{return "0x"+randomBytes(20).toString("hex");}
const id="123e4567-e89b-42d3-a456-426614174000";
function dbOnly(){
 if(!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL||""))
  throw Error("M10 local JWT/PostgreSQL fixtures MUST NOT touch real operator databases");
 return getDb();
}
async function jwt(owner:string,opt:{
 jti?:string;issued?:number;handle?:string;posts?:unknown[];publicApproved?:boolean;
 suspended?:boolean;sourceCommit?:string;wallet?:string
}={}){
 const issued=opt.issued??Math.floor(Date.now()/1000)-10;
 const h=opt.handle||"creator_"+owner.slice(2,9);
 return new SignJWT({
  chainId:18881,source:"looke-social-postgres",version:1,
  sourceCommit:opt.sourceCommit||trust.expectedSourceCommit,
  wallet:opt.wallet||owner,profileId:owner,
  profile:{address:owner,handle:h,displayName:"Local CI fixture",
   bio:"NOT REAL SOCIALLY VERIFIED",publicApproved:opt.publicApproved??true,
   suspended:opt.suspended??false},
  posts:opt.posts??[{
   id,author:owner,body:"Local-only signed JWT test post",
   hidden:false,deleted:false,moderationApproved:true,
   mediaKind:null,mediaUrl:null,createdAt:new Date(Date.now()-20000).toISOString()
  }]
 })
 .setProtectedHeader({alg:"EdDSA"})
 .setIssuer(trust.issuer).setAudience("lookenft-social-proof")
 .setSubject(owner).setJti(opt.jti||randomBytes(12).toString("hex"))
 .setIssuedAt(issued).setExpirationTime(issued+300).sign(privateKey);
}
test("M10 REAL ephemeral PostgreSQL: signed wallet-linked Looke source import, replay prevention, stale rejection and cross-account isolation",async()=>{
 const db=dbOnly(),alice=wallet(),bob=wallet();
 const signed=await jwt(alice);
 const jtiRows:string[]=[];
 try{
  await db.query("INSERT INTO nft_profile_links(wallet_address,profile_id) VALUES($1,$1),($2,$2)",[alice,bob]);
  await assert.rejects(saveSocialSnapshot(bob,signed,trust),/different authenticated wallet/);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m10_social_profiles WHERE wallet_address=$1",[alice])).rows[0].n,0);
  const first=await saveSocialSnapshot(alice,signed,trust);
  assert.equal(first.wallet,alice);
  assert.equal(first.posts.length,1);
  let row=await db.query<{handle:string;source_commit_sha:string;public_approved:boolean}>(
   "SELECT handle,source_commit_sha,public_approved FROM nft_m10_social_profiles WHERE wallet_address=$1",[alice]);
  assert.equal(row.rows[0].source_commit_sha,trust.expectedSourceCommit);
  assert.equal(row.rows[0].public_approved,true);
  assert.match(row.rows[0].handle,/^creator_/);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m10_visible_posts WHERE wallet_address=$1",[alice])).rows[0].n,1);
  await assert.rejects(saveSocialSnapshot(alice,signed,trust),/Stale|replayed/);
  const expiredSource=await jwt(alice,{issued:Math.floor(Date.now()/1000)-20});
  await assert.rejects(saveSocialSnapshot(alice,expiredSource,trust),/Stale|replayed/);
  const latest=await jwt(alice,{issued:Math.floor(Date.now()/1000)-8,posts:[]});
  const changed=await saveSocialSnapshot(alice,latest,trust);
  assert.equal(changed.posts.length,0);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m10_visible_posts WHERE wallet_address=$1",[alice])).rows[0].n,0);
  await assert.rejects(saveSocialSnapshot(alice,latest,trust),/Stale|replayed/);
  const suspended=await jwt(alice,{issued:Math.floor(Date.now()/1000)-3,suspended:true});
  await assert.rejects(saveSocialSnapshot(alice,suspended,trust),/suspended/);
  const forgedPost=await jwt(alice,{issued:Math.floor(Date.now()/1000)-2,
   posts:[{id,author:bob,body:"Forged",hidden:false,deleted:false,moderationApproved:true,
    mediaKind:null,mediaUrl:null,createdAt:new Date().toISOString()}]});
  await assert.rejects(saveSocialSnapshot(alice,forgedPost,trust),/authentic author/);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m10_social_profiles WHERE wallet_address=$1",[bob])).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int n FROM nft_m10_assertion_jtis WHERE wallet_address=$1",[alice])).rows[0].n,2);
 }finally{
  await db.query("DELETE FROM nft_profile_links WHERE wallet_address IN($1,$2)",[alice,bob]);
  await db.query("DELETE FROM nft_m10_assertion_jtis WHERE wallet_address IN($1,$2)",[alice,bob]);
 }
});
test("M10 REAL ephemeral PostgreSQL: unapproved avatar/checkpoint proof, private spam bucket and orphaned historical NFT visibility",async()=>{
 const db=dbOnly(),alice=wallet(),nft=wallet(),block=BigInt(200000000+randomBytes(3).readUIntBE(0,3));
 const bHash="0x"+randomBytes(32).toString("hex"),parent="0x"+randomBytes(32).toString("hex");
 const codeHash="0x"+randomBytes(32).toString("hex");
 let collection=false,canonical=false,profileLinked=false,snapshot=false;
 try{
  await db.query("INSERT INTO nft_profile_links(wallet_address,profile_id) VALUES($1,$1)",[alice]);
  profileLinked=true;
  await saveSocialSnapshot(alice,await jwt(alice,{posts:[]}),trust);snapshot=true;
  await assert.rejects(db.query(
   `INSERT INTO nft_m10_verified_nft_avatars(
     owner_wallet,collection_address,token_standard,token_id,verified_balance,
     block_number,block_hash,contract_code_hash,primary_rpc,independent_rpc,explorer_block_url,
     verified_at,expires_at) VALUES($1,$2,'erc721',7,1,$3,$4,$5,
    'https://primary.example.test','https://independent.example.test',
    'https://explorer.example.test/block/1',now(),now()+interval '5 minutes')`,
   [alice,nft,block.toString(),bHash,codeHash]),/foreign key/);
  await db.query(`INSERT INTO nft_collections(
   chain_id,contract_address,token_standard,deployment_block,code_hash,
   checked_block,source_verified,operator_evidence)
   VALUES(18881,$1,'erc721',1,$2,1,true,'CI ONLY: not a real NFT collection')`,[nft,codeHash]);
  collection=true;
  await db.query(`INSERT INTO nft_indexer_blocks(
   chain_id,block_number,block_hash,parent_hash) VALUES(18881,$1,$2,$3)`,
   [block.toString(),bHash,parent]);canonical=true;
  await db.query(`INSERT INTO nft_m10_verified_nft_avatars(
   owner_wallet,collection_address,token_standard,token_id,verified_balance,
   block_number,block_hash,contract_code_hash,primary_rpc,independent_rpc,explorer_block_url,
   verified_at,expires_at) VALUES($1,$2,'erc721',7,1,$3,$4,$5,
   'https://primary.example.test','https://independent.example.test',
   'https://explorer.example.test/block/1',now(),now()+interval '5 minutes')`,
   [alice,nft,block.toString(),bHash,codeHash]);
  const verified=await db.query(`SELECT a.owner_wallet FROM nft_m10_verified_nft_avatars a
    JOIN nft_indexer_blocks b ON b.chain_id=a.chain_id
     AND b.block_number=a.block_number AND b.block_hash=a.block_hash
    WHERE a.owner_wallet=$1 AND a.expires_at>now()`,[alice]);
  assert.equal(verified.rowCount,1);
  await assert.rejects(db.query(`INSERT INTO nft_m10_verified_nft_avatars(
   owner_wallet,collection_address,token_standard,token_id,verified_balance,
   block_number,block_hash,contract_code_hash,primary_rpc,independent_rpc,explorer_block_url,
   verified_at,expires_at) VALUES($1,$2,'erc721',7,0,$3,$4,$5,
   'https://primary.example.test','https://independent.example.test',
   'https://explorer.example.test/block/1',now(),now()+interval '5 minutes')`,
   [wallet(),nft,block.toString(),bHash,codeHash]),/foreign key|check constraint/);
  await limitSocialWallet(alice,"read",2);
  await limitSocialWallet(alice,"read",2);
  await assert.rejects(limitSocialWallet(alice,"read",2),/Too many/);
  await db.query("DELETE FROM nft_indexer_blocks WHERE chain_id=18881 AND block_number=$1",[block.toString()]);
  canonical=false;
  const orphan=await db.query(`SELECT a.owner_wallet FROM nft_m10_verified_nft_avatars a
    JOIN nft_indexer_blocks b ON b.chain_id=a.chain_id
     AND b.block_number=a.block_number AND b.block_hash=a.block_hash
    WHERE a.owner_wallet=$1 AND a.expires_at>now()`,[alice]);
  assert.equal(orphan.rowCount,0,"Orphaned historical block must not display NFT PFP as verified");
 }finally{
  await db.query("DELETE FROM nft_m10_holder_collection_links WHERE wallet_address=$1",[alice]);
  await db.query("DELETE FROM nft_m10_verified_nft_avatars WHERE owner_wallet=$1",[alice]);
  await db.query("DELETE FROM nft_m10_request_buckets WHERE wallet_address=$1",[alice]);
  if(canonical)await db.query("DELETE FROM nft_indexer_blocks WHERE chain_id=18881 AND block_number=$1",[block.toString()]);
  if(collection)await db.query("DELETE FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",[nft]);
  if(profileLinked)await db.query("DELETE FROM nft_profile_links WHERE wallet_address=$1",[alice]);
  await db.query("DELETE FROM nft_m10_assertion_jtis WHERE wallet_address=$1",[alice]);
 }
});
