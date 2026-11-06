import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {SignJWT} from "jose";
import {getDb} from "../lib/server/db";
import {currentNoGoAssessment,persistNoGoAssessment,
 getRecentNoGoReviews,M12_PREDECESSOR_COMMIT} from "../lib/m12/final";
import {verifyHumanReviewAssertion,recordSignedHumanCandidate,
 type ReviewerTrust} from "../lib/m12/human";
const alice="0x"+randomBytes(20).toString("hex");
const bob="0x"+randomBytes(20).toString("hex");
const keysA=generateKeyPairSync("ed25519"),keysB=generateKeyPairSync("ed25519");
const security:ReviewerTrust={role:"security_reviewer",issuer:"https://security-reviewer.test.example",
 keyId:"security-human-2026",reviewerWallet:alice,
 publicKeyPem:keysA.publicKey.export({type:"spki",format:"pem"}).toString()};
const operator:ReviewerTrust={role:"release_operator",issuer:"https://release-reviewer.test.example",
 keyId:"release-human-2026",reviewerWallet:bob,
 publicKeyPem:keysB.publicKey.export({type:"spki",format:"pem"}).toString()};
const trust={security,release:operator};
function dbOnly(){
 const url=process.env.DATABASE_URL||"";
 if(!/^(postgres|postgresql):\/\/[^\s]*(127\.0\.0\.1|localhost):5432\/lookenft$/.test(url))
  throw Error("M12 synthetic fixtures REQUIRE ephemeral localhost 5432/lookenft only");
 return getDb();
}
function enableCI(){
 const names=["M11_ACCEPTANCE_READ_ENABLED","M11_EVIDENCE_SUBMISSIONS_ENABLED",
 "M12_OPERATOR_RECORD_NO_GO","M12_SIGNED_HUMAN_CANDIDATES_ENABLED","M11_OPERATOR_WALLETS"];
 const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 process.env.NEXT_PUBLIC_ULTRA_NETWORK="testnet";
 for(const name of names.slice(0,4))process.env[name]="true";
 process.env.M11_OPERATOR_WALLETS=alice;
 return ()=>{for(const name of names){
  if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];
 }};
}
async function statement(role:ReviewerTrust,reviewId:string,bundleSha:string,decision="NO_GO"){
 const iat=Math.floor(Date.now()/1000)-3;
 return new SignJWT({chainId:18881,milestone:12,version:1,
  role:role.role,reviewId,bundleSha256:bundleSha,decision,
  financialExecutionAuthorised:false,mainnetAuthorised:false})
 .setProtectedHeader({alg:"EdDSA",kid:role.keyId})
 .setIssuer(role.issuer).setAudience("lookenft-m12-final-review")
 .setSubject(role.reviewerWallet)
 .setJti(randomBytes(12).toString("hex"))
 .setIssuedAt(iat).setExpirationTime(iat+90)
 .sign(role.role==="security_reviewer"?keysA.privateKey:keysB.privateKey);
}
async function cleanup(id:string){
 const db=getDb();
 await db.query("DELETE FROM nft_m12_human_attestation_candidates WHERE review_id=$1",[id]);
 await db.query("DELETE FROM nft_m12_readonly_source_observations WHERE review_id=$1",[id]);
 await db.query("DELETE FROM nft_m12_gate_observations WHERE review_id=$1",[id]);
 await db.query("DELETE FROM nft_m12_final_reviews WHERE id=$1",[id]);
}
test("M12 REAL disposable PostgreSQL: exact 18-gate NO_GO snapshot, tamper/replay resistance, no GO status allowed",async()=>{
 const db=dbOnly(),restore=enableCI();let id="";
 try{
  const observed=await currentNoGoAssessment(alice);
  assert.equal(observed.bundle.acceptanceGates.length,18);
  assert.equal(observed.bundle.decision,"NO_GO");
  assert.equal(observed.bundle.humanReleaseApproved,false);
  const saved=await persistNoGoAssessment(alice);
  id=saved.id;
  assert.equal(saved.decision,"NO_GO");
  assert.equal(saved.humanApproval,false);
  assert.equal(saved.sourceProofsApproved,false);
  const row=await db.query<{
   decision:string;human_release_approved:boolean;execution_authorised:boolean;
   source_commit:string;evidence_bundle_sha256:string
  }>("SELECT * FROM nft_m12_final_reviews WHERE id=$1",[id]);
  assert.equal(row.rowCount,1);
  assert.equal(row.rows[0].source_commit,M12_PREDECESSOR_COMMIT);
  assert.equal(row.rows[0].human_release_approved,false);
  assert.equal(row.rows[0].execution_authorised,false);
  assert.equal(row.rows[0].evidence_bundle_sha256,observed.sha256);
  const gates=await db.query<{gate:string;observed_state:string}>(
   "SELECT gate,observed_state FROM nft_m12_gate_observations WHERE review_id=$1",[id]);
  assert.equal(gates.rowCount,18);
  assert.ok(gates.rows.every(r=>r.observed_state!=="approved"));
  await assert.rejects(persistNoGoAssessment(alice),/Identical NO-GO review already recorded/);
  await assert.rejects(db.query(
   "UPDATE nft_m12_final_reviews SET decision='GO' WHERE id=$1",[id]),/check constraint/);
  await assert.rejects(db.query(
   "UPDATE nft_m12_final_reviews SET human_release_approved=true WHERE id=$1",[id]),/check constraint/);
  await assert.rejects(db.query(
   "UPDATE nft_m12_final_reviews SET execution_authorised=true WHERE id=$1",[id]),/check constraint/);
  await assert.rejects(db.query(
   "UPDATE nft_m12_gate_observations SET observed_state='approved' WHERE review_id=$1",
   [id]),/check constraint/);
  const recent=await getRecentNoGoReviews();
  assert.ok(recent.some(x=>x.id===id));
 }finally{if(id)await cleanup(id);restore();}
});
test("M12 REAL PostgreSQL: two independent EdDSA signers only create source-unverified human candidates, never GO",async()=>{
 const db=dbOnly(),restore=enableCI();let id="";
 try{
  const r=await persistNoGoAssessment(alice);id=r.id;
  const first=await statement(security,id,r.sha256);
  const provedA=await verifyHumanReviewAssertion(first,security);
  const savedA=await recordSignedHumanCandidate(provedA,trust);
  assert.equal(savedA.status,"signature_valid_source_unverified");
  assert.equal(savedA.decision,"NO_GO");
  await assert.rejects(recordSignedHumanCandidate(provedA,trust),/twice|replayed/);
  const second=await statement(operator,id,r.sha256,"GO_PROPOSAL_UNVERIFIED");
  const provedB=await verifyHumanReviewAssertion(second,operator);
  const savedB=await recordSignedHumanCandidate(provedB,trust);
  assert.equal(savedB.decision,"NO_GO");
  const signatures=await db.query<{role:string;claimed_decision:string;verification_status:string}>(
   "SELECT role,claimed_decision,verification_status FROM nft_m12_human_attestation_candidates WHERE review_id=$1",[id]);
  assert.equal(signatures.rowCount,2);
  assert.ok(signatures.rows.every(x=>x.verification_status==="signature_valid_source_unverified"));
  assert.ok(signatures.rows.some(x=>x.claimed_decision==="GO_PROPOSAL_UNVERIFIED"));
  const review=await db.query<{decision:string;execution_authorised:boolean;human_release_approved:boolean}>(
   "SELECT decision,execution_authorised,human_release_approved FROM nft_m12_final_reviews WHERE id=$1",[id]);
  assert.equal(review.rows[0].decision,"NO_GO");
  assert.equal(review.rows[0].execution_authorised,false);
  assert.equal(review.rows[0].human_release_approved,false);
  const wrong=await statement(security,id,"f".repeat(64));
  const wrongClaim=await verifyHumanReviewAssertion(wrong,security);
  await assert.rejects(recordSignedHumanCandidate(wrongClaim,trust),/mismatches immutable/);
 }finally{if(id)await cleanup(id);restore();}
});
test("M12 REAL PostgreSQL: source observations never become independent approval, invalid reviewer gate or evidence cannot write",async()=>{
 const db=dbOnly(),restore=enableCI();let id="";
 try{
  const r=await persistNoGoAssessment(alice);id=r.id;
  await db.query(`INSERT INTO nft_m12_readonly_source_observations(
   review_id,source_kind,observation,summary_sha256)
   VALUES($1,'blockscout','unavailable',$2)`,[id,randomBytes(32).toString("hex")]);
  await assert.rejects(db.query(`INSERT INTO nft_m12_readonly_source_observations(
   review_id,source_kind,observation)
   VALUES($1,'primary_rpc','verified')`,[id]),/check constraint/);
  await assert.rejects(db.query(`UPDATE nft_m12_gate_observations
   SET observed_state='passed' WHERE review_id=$1`,[id]),/check constraint/);
  const row=await db.query(
   "SELECT source_kind,observation FROM nft_m12_readonly_source_observations WHERE review_id=$1",[id]);
  assert.equal(row.rowCount,1);
  assert.equal(row.rows[0].observation,"unavailable");
 }finally{if(id)await cleanup(id);restore();}
});
