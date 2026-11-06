import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync} from "node:crypto";
import {SignJWT} from "jose";
import {readFile} from "node:fs/promises";
import {verifyRevocation,verifyVisibility,m11SourceGate} from "../lib/m11/source";
import {verifyEvidenceSubmission,M11_GATES,requireAcceptanceOperator} from "../lib/m11/acceptance";
import {verifyPinnedMetadata,normalizedMetadataURI} from "../lib/m11/nft";
import {mediaAcceptanceDependencies} from "../lib/m11/media";
import type {SocialTrust} from "../lib/m10/claims";
const keys=generateKeyPairSync("ed25519");
const privateKey=keys.privateKey;
const trust:SocialTrust={issuer:"https://source.looke.example",
 publicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}).toString(),
 expectedSourceCommit:"f".repeat(40),mediaHosts:[]};
const alice=("0x"+"1".repeat(40));
const bob=("0x"+"2".repeat(40));
const now=Math.floor(Date.now()/1000);
async function sign(kind:"lookenft-revocation"|"lookenft-visibility"|"lookenft-m11-evidence",
 payload:Record<string,unknown>,args:{sub?:string;jti?:string;exp?:number;issued?:number;issuer?:string}={}){
 const iat=args.issued??now-3;
 return new SignJWT({chainId:18881,source:"looke-social-postgres",version:1,
  sourceCommit:trust.expectedSourceCommit,...payload})
 .setProtectedHeader({alg:"EdDSA",typ:"JWT"})
 .setIssuer(args.issuer||trust.issuer).setAudience(kind)
 .setSubject(args.sub||alice).setJti(args.jti||"m11-unique-JTI-123")
 .setIssuedAt(iat).setExpirationTime(args.exp??iat+50).sign(privateKey);
}
test("M11 revocation JWT requires real pinned EdDSA issuer, wallet subject, scope and reason",async()=>{
 const token=await sign("lookenft-revocation",{action:"revoke",
  reason:"account_suspended",wallet:alice});
 const proof=await verifyRevocation(token,trust);
 assert.equal(proof.wallet,alice);
 assert.equal(proof.reason,"account_suspended");
 assert.match(proof.assertionSha256,/^[a-f0-9]{64}$/);
 await assert.rejects(verifyRevocation(token+"tamper",trust),/Untrusted/);
 await assert.rejects(verifyRevocation(await sign("lookenft-revocation",
  {action:"revoke",wallet:alice,reason:"not_on_list"}),trust),/Unrecognised/);
 await assert.rejects(verifyRevocation(await sign("lookenft-revocation",
  {action:"revoke",wallet:bob,reason:"account_deleted"}),trust),/wallet mismatch/);
 await assert.rejects(verifyRevocation(await sign("lookenft-visibility",
  {action:"revoke",wallet:alice,reason:"security_hold"}),trust),/Untrusted/);
 await assert.rejects(verifyRevocation(await sign("lookenft-revocation",
  {action:"revoke",wallet:alice,reason:"security_hold",chainId:19991}),trust),/Untrusted/);
 await assert.rejects(verifyRevocation(await sign("lookenft-revocation",
  {action:"revoke",wallet:alice,reason:"security_hold"},
  {issued:now-900,exp:now-700}),trust),/Untrusted/);
});
test("M11 visibility is viewer+subject bound; blocks and mutes are denied, not public profiles",async()=>{
 const allowed=await sign("lookenft-visibility",{
  action:"view_profile",viewer:alice,subjectWallet:bob,policy:"allowed",policyCheckedAt:now-2
 });
 const decision=await verifyVisibility(allowed,trust);
 assert.equal(decision.allowed,true);assert.equal(decision.viewer,alice);
 const blocked=await verifyVisibility(await sign("lookenft-visibility",{
  action:"view_profile",viewer:alice,subjectWallet:bob,policy:"blocked_by_subject",policyCheckedAt:now-2
 }),trust);
 assert.equal(blocked.allowed,false);
 const muted=await verifyVisibility(await sign("lookenft-visibility",{
  action:"view_profile",viewer:alice,subjectWallet:bob,policy:"muted_by_viewer",policyCheckedAt:now-2
 }),trust);
 assert.equal(muted.allowed,false);
 await assert.rejects(verifyVisibility(await sign("lookenft-visibility",{
  action:"view_profile",viewer:bob,subjectWallet:alice,policy:"allowed",policyCheckedAt:now-2
 }),trust),/viewer\/subject/);
 await assert.rejects(verifyVisibility(await sign("lookenft-visibility",{
  action:"view_profile",viewer:alice,subjectWallet:bob,policy:"allowed",policyCheckedAt:now-200
 }),trust),/not fresh/);
 await assert.rejects(verifyVisibility(await sign("lookenft-visibility",{
  action:"view_profile",viewer:alice,subjectWallet:alice,policy:"allowed",policyCheckedAt:now-2
 }),trust),/not fresh/);
});
test("M11 independent human reviewer JWT can submit only unapproved, bounded evidence",async()=>{
 const assertion=await sign("lookenft-m11-evidence",{
  gate:"contract_security_audit",sha256:"a".repeat(64),
  sourceUri:"https://audit.example/report-123",format:"signed_report",observedAt:now-5
 });
 const verified=await verifyEvidenceSubmission(assertion,{
  issuer:trust.issuer,publicKeyPem:trust.publicKeyPem,operatorWallet:alice
 });
 assert.equal(verified.gate,"contract_security_audit");
 assert.equal(verified.reviewerWallet,alice);
 assert.equal(M11_GATES.length,18);
 await assert.rejects(verifyEvidenceSubmission(assertion,{
  issuer:trust.issuer,publicKeyPem:trust.publicKeyPem,operatorWallet:bob
 }),/not bound/);
 await assert.rejects(verifyEvidenceSubmission(await sign("lookenft-m11-evidence",{
  gate:"contract_security_audit",sha256:"a".repeat(64),
  sourceUri:"http://localhost/report",format:"signed_report",observedAt:now-5
 }),{issuer:trust.issuer,publicKeyPem:trust.publicKeyPem,operatorWallet:alice}),/HTTPS/);
 await assert.rejects(verifyEvidenceSubmission(await sign("lookenft-m11-evidence",{
  gate:"not_a_gate",sha256:"a".repeat(64),
  sourceUri:"https://audit.example/report",format:"signed_report",observedAt:now-5
 }),{issuer:trust.issuer,publicKeyPem:trust.publicKeyPem,operatorWallet:alice}),/gate/);
});
test("M11 metadata verifies byte-exact pinned JSON and two onchain URI witnesses",async()=>{
 const text='{"name":"CI Synthetic Token","image":"ipfs://bafy'+ "a".repeat(50)+'"}';
 const cid="bafy"+"a".repeat(50),uri="ipfs://"+cid+"/metadata.json";
 const h=createHash("sha256").update(text).digest("hex");
 const good=await verifyPinnedMetadata({standard:"erc721",tokenId:7n,primaryUri:uri,
  independentUri:uri,storedUri:uri,storedSha256:h,ipfsJson:text});
 assert.equal(good.matched,true);
 assert.equal(good.sha256,h);
 await assert.rejects(verifyPinnedMetadata({standard:"erc721",tokenId:7n,
  primaryUri:uri,independentUri:uri+"/wrong",storedUri:uri,storedSha256:h,ipfsJson:text}),/mismatch/);
 await assert.rejects(verifyPinnedMetadata({standard:"erc721",tokenId:7n,
  primaryUri:uri,independentUri:uri,storedUri:uri,storedSha256:"f".repeat(64),ipfsJson:text}),/sha256/);
 assert.throws(()=>normalizedMetadataURI("https://127.0.0.1/media","erc721",2n),/IPFS/);
});
test("M11 all financial + source operator execution gates default OFF",async()=>{
 const env=await readFile(new URL("../.env.example",import.meta.url),"utf8");
 const flags=["M11_REVOCATION_SYNC_ENABLED","M11_VISIBILITY_CHECK_ENABLED",
  "M11_ACCEPTANCE_READ_ENABLED","M11_EVIDENCE_SUBMISSIONS_ENABLED",
  "M11_MEDIA_RECONCILE_ENABLED","M11_NFT_WITNESS_RECHECK_ENABLED",
  "M11_OPERATOR_READONLY_CHECK_ENABLED","M11_LOCAL_RESTORE_REHEARSAL"];
 for(const f of flags)assert.match(env,new RegExp("^"+f+"=false$","m"));
 assert.throws(()=>m11SourceGate("visibility"),/disabled/);
 assert.throws(()=>requireAcceptanceOperator(alice),/authorised/);
 assert.equal(mediaAcceptanceDependencies().releaseApproved,false);
 for(const f of ["NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT","NEXT_PUBLIC_M5_ENABLE_MINTING",
  "NEXT_PUBLIC_M7_ENABLE_SETTLEMENT","NEXT_PUBLIC_M8_ENABLE_FUNDING"])
  assert.match(env,new RegExp("^"+f+"=false$","m"));
});
