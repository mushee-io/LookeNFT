import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {SignJWT} from "jose";
import {getDb} from "../lib/server/db";
import {persistRevocation,consumeVisibilityDecision,
 verifyRevocation,verifyVisibility} from "../lib/m11/source";
import {acceptanceReport,storeEvidenceCandidate} from "../lib/m11/acceptance";
import {saveSocialSnapshot} from "../lib/m10/bridge";
import {inspectExistingMediaCandidate} from "../lib/m11/media";
import type {SocialTrust} from "../lib/m10/claims";
const keys=generateKeyPairSync("ed25519");
const trust:SocialTrust={issuer:"https://operator-looke-ci.example",
 publicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}).toString(),
 expectedSourceCommit:"f".repeat(40),mediaHosts:[]};
const owner=()=>("0x"+randomBytes(20).toString("hex"));
const sha=()=>randomBytes(32).toString("hex");
const clock=()=>Math.floor(Date.now()/1000);
function dbOnly(){
 if(!/^(postgres|postgresql):\/\/.*(127\.0\.0\.1|localhost):5432\/lookenft$/.test(
  process.env.DATABASE_URL||""))
  throw Error("M11 synthetic fixtures require disposable localhost PostgreSQL /lookenft, never operator DB");
 return getDb();
}
async function signed(
 audience:"lookenft-social-proof"|"lookenft-revocation"|"lookenft-visibility",
 wallet:string,extra:Record<string,unknown>,issued=clock()-3
){
 return new SignJWT({
  chainId:18881,version:1,source:"looke-social-postgres",sourceCommit:trust.expectedSourceCommit,
  wallet,profileId:wallet,...extra
 }).setProtectedHeader({alg:"EdDSA"}).setIssuer(trust.issuer).setAudience(audience)
 .setSubject(wallet).setJti(randomBytes(14).toString("hex"))
 .setIssuedAt(issued).setExpirationTime(issued+55).sign(keys.privateKey);
}
test("M11 REAL disposable PostgreSQL: signed revocation invalidates M2/M10 linked profile, posts, avatar and blocks replay/re-link",async()=>{
 const db=dbOnly(),alice=owner(),nonce=sha(),token=sha();
 try{
  await db.query("INSERT INTO nft_profile_links(wallet_address,profile_id) VALUES($1,$1)",[alice]);
  await db.query(`INSERT INTO nft_wallet_sessions(token_hash,wallet_address,chain_id,expires_at)
   VALUES($1,$2,18881,now()+interval '1 hour')`,[token,alice]);
  const now=clock();
  const social=await signed("lookenft-social-proof",alice,{
   profile:{address:alice,handle:"alice_123",displayName:"CI local fixture",
    bio:"Synthetic source for local DB test",publicApproved:true,suspended:false},
   posts:[]},now-8);
  const imported=await saveSocialSnapshot(alice,social,trust);
  assert.equal(imported.wallet,alice);
  const revoke=await signed("lookenft-revocation",alice,{
   action:"revoke",reason:"security_hold"},now-2);
  const data=await verifyRevocation(revoke,trust);
  const applied=await persistRevocation(data);
  assert.equal(applied.accountLinkInvalidated,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM nft_profile_links WHERE wallet_address=$1",[alice])).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM nft_m10_social_profiles WHERE wallet_address=$1",[alice])).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM nft_m11_social_revocations WHERE wallet_address=$1",[alice])).rows[0].n,1);
  const session=await db.query<{revoked_at:Date|null}>(
   "SELECT revoked_at FROM nft_wallet_sessions WHERE token_hash=$1",[token]);
  assert.notEqual(session.rows[0].revoked_at,null);
  await assert.rejects(persistRevocation(data),/already recorded/);
  await db.query("INSERT INTO nft_profile_links(wallet_address,profile_id) VALUES($1,$1)",[alice]);
  const freshSocial=await signed("lookenft-social-proof",alice,{
   profile:{address:alice,handle:"alice_123",displayName:"CI local fixture",
    bio:"Synthetic source for local DB test",publicApproved:true,suspended:false},
   posts:[]},now-1);
  await assert.rejects(saveSocialSnapshot(alice,freshSocial,trust),/revoked/);
 }finally{
  await db.query("DELETE FROM nft_profile_links WHERE wallet_address=$1",[alice]);
  await db.query("DELETE FROM nft_wallet_sessions WHERE wallet_address=$1",[alice]);
  await db.query("DELETE FROM nft_m11_social_revocations WHERE wallet_address=$1",[alice]);
  await db.query("DELETE FROM nft_m10_assertion_jtis WHERE wallet_address=$1",[alice]);
 }
});
test("M11 REAL disposable PostgreSQL: one-use viewer-scoped visibility, denial and foreign-wallet separation",async()=>{
 const db=dbOnly(),viewer=owner(),subject=owner(),attacked=owner();
 const now=clock();
 const jwt=await signed("lookenft-visibility",viewer,{
  action:"view_profile",viewer,subjectWallet:subject,policy:"blocked_by_subject",
  policyCheckedAt:now-3},now-4);
 const proof=await verifyVisibility(jwt,trust);
 try{
  await assert.rejects(consumeVisibilityDecision(proof,attacked,db),/reused/);
  const denied=await consumeVisibilityDecision(proof,viewer,db);
  assert.equal(denied.allowed,false);
  assert.equal(denied.subject,subject);
  await assert.rejects(consumeVisibilityDecision(proof,viewer,db),/already consumed/);
  assert.equal((await db.query(
   "SELECT count(*)::int AS n FROM nft_m11_visibility_consumed WHERE viewer_wallet=$1",
   [attacked])).rows[0].n,0);
 }finally{
  await db.query("DELETE FROM nft_m11_visibility_consumed WHERE viewer_wallet=$1",[viewer]);
 }
});
test("M11 REAL PostgreSQL: submitted reviewer evidence remains unverified, no automatic audit success",async()=>{
 const db=dbOnly(),operator=owner(),id=sha(),jti=randomBytes(14).toString("hex");
 try{
  const candidate=await storeEvidenceCandidate({
   gate:"contract_security_audit",sourceUri:"https://audit.example/ci-only-report",
   sha256:id,format:"signed_report",reviewerWallet:operator,
   issuer:"https://reviewer.example",jti,assertionSha256:sha(),
   observedAt:new Date(Date.now()-10000),issuedAt:new Date(Date.now()-8000)
  });
  assert.equal(candidate.status,"submitted_unverified");
  assert.equal(candidate.acceptedAsReleaseProof,false);
  const report=await acceptanceReport();
  assert.equal(report.releaseDecision,"NO_GO");
  assert.equal(report.humanReviewPassed,false);
  assert.equal(report.independentSourcePassed,false);
  const gate=report.gates.find(g=>g.gate==="contract_security_audit");
  assert.equal(gate?.state,"submitted_unverified");
  assert.equal(gate?.approved,false);
  const result=await db.query("SELECT status FROM nft_m11_evidence_candidates WHERE id=$1",[candidate.id]);
  assert.equal(result.rows[0].status,"submitted_unverified");
  await assert.rejects(db.query(
   "UPDATE nft_m11_evidence_candidates SET status='approved' WHERE id=$1",[candidate.id]),
   /check constraint/);
 }finally{
  await db.query("DELETE FROM nft_m11_evidence_candidates WHERE source_sha256=$1",[id]);
 }
});
test("M11 REAL PostgreSQL: media acceptance refuses missing Cloudinary/ClamAV/Pinata/moderation evidence",async()=>{
 const db=dbOnly(),wallet=owner(),assetId="123e4567-e89b-42d3-a456-426614174001";
 await assert.rejects(inspectExistingMediaCandidate(assetId,wallet,db),/No user-owned/);
 const row=await db.query("SELECT conname FROM pg_constraint WHERE conrelid='nft_m11_media_witness_checks'::regclass");
 assert.ok(row.rows.some(x=>String(x.conname).includes("_pkey")));
 const constrained=await db.query("SELECT conname FROM pg_constraint WHERE conrelid='nft_m11_evidence_candidates'::regclass");
 assert.ok(constrained.rows.some(x=>String(x.conname).includes("status_check")));
});
