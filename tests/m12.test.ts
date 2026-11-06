import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {SignJWT} from "jose";
import {keccak256,type Hex} from "viem";
import {
 makeFinalNoGoBundle,defaultNoGoFindings,hashFinalBundle,
 assertGateFindings,M12_FINAL_MILESTONE,M12_DECISION,
 M12_PREDECESSOR_COMMIT
} from "../lib/m12/final";
import {verifyHumanReviewAssertion,assertIndependentReviewers,
 type ReviewerTrust} from "../lib/m12/human";
import {
 publicRpcURL,distinctRPCs,corroborateBlock,verifyReadOnlyContractCode,
 type ReadonlyWitnessProvider
} from "../lib/m12/witness";
import {readFile} from "node:fs/promises";
const wallet="0x"+"1".repeat(40);
const wallet2="0x"+"2".repeat(40);
const digest=("0x"+"a".repeat(64)) as Hex;
const parent=("0x"+"b".repeat(64)) as Hex;
const runtime=("0x60016002") as Hex;
const now=Math.floor(Date.now()/1000);
const secKey=generateKeyPairSync("ed25519"),opKey=generateKeyPairSync("ed25519");
const security:ReviewerTrust={role:"security_reviewer",issuer:"https://security.looke-tests.example",
 publicKeyPem:secKey.publicKey.export({type:"spki",format:"pem"}).toString(),
 keyId:"sec-key-2026",reviewerWallet:wallet};
const release:ReviewerTrust={role:"release_operator",issuer:"https://release.looke-tests.example",
 publicKeyPem:opKey.publicKey.export({type:"spki",format:"pem"}).toString(),
 keyId:"release-key-2026",reviewerWallet:wallet2};
const reviewId="123e4567-e89b-42d3-a456-426614174001";
async function sign(
 trust:ReviewerTrust,bundleSha:string,change:Record<string,unknown>={},
 issuance=now-2
){
 const key=trust.role==="security_reviewer"?secKey.privateKey:opKey.privateKey;
 return new SignJWT({
  chainId:18881,milestone:12,version:1,role:trust.role,
  reviewId,bundleSha256:bundleSha,decision:"NO_GO",
  financialExecutionAuthorised:false,mainnetAuthorised:false,...change
 }).setProtectedHeader({alg:"EdDSA",kid:trust.keyId})
 .setIssuer(trust.issuer).setSubject(trust.reviewerWallet)
 .setAudience("lookenft-m12-final-review")
 .setJti("m12-JTI-test-123456").setIssuedAt(issuance)
 .setExpirationTime(issuance+90).sign(key);
}
test("M12 final number and immutable NO_GO matrix cover ALL 18 gates, no automatic GO",()=>{
 assert.equal(M12_FINAL_MILESTONE,12);
 assert.equal(M12_DECISION,"NO_GO");
 const b=makeFinalNoGoBundle({operatorWallet:wallet});
 assert.equal(b.decision,"NO_GO");
 assert.equal(b.acceptanceGates.length,18);
 assert.equal(b.predecessorCommit,M12_PREDECESSOR_COMMIT);
 assert.ok(b.acceptanceGates.every(x=>x.sourceSha256===null&&x.state==="source_unavailable"));
 assert.equal(b.humanReleaseApproved,false);
 assert.equal(b.independentlyApproved,false);
 assert.equal(b.financialExecutionEnabled,false);
 assert.equal(b.mainnetEnabled,false);
 assert.equal(b.publicBetaEnabled,false);
 assert.match(hashFinalBundle(b),/^[a-f0-9]{64}$/);
 assert.equal(hashFinalBundle(b),hashFinalBundle(b));
 assert.throws(()=>hashFinalBundle({...b,decision:"GO" as "NO_GO"}),/automatically approved/);
 assert.throws(()=>hashFinalBundle({...b,humanReleaseApproved:true as false}),/automatically approved/);
 assert.throws(()=>makeFinalNoGoBundle({operatorWallet:wallet,
  predecessorCommit:"f".repeat(40)}),/exact M11/);
 assert.throws(()=>assertGateFindings(defaultNoGoFindings().slice(1)),/incomplete/);
 assert.throws(()=>assertGateFindings(defaultNoGoFindings().map(x=>({
  ...x,gate:"blockscout" as typeof x.gate
 }))),/incomplete/);
});
test("M12 security and operator require genuinely distinct human wallet, issuer and key",()=>{
 assert.doesNotThrow(()=>assertIndependentReviewers(security,release));
 assert.throws(()=>assertIndependentReviewers(security,{...release,reviewerWallet:wallet}),/separate identities/);
 assert.throws(()=>assertIndependentReviewers(security,{...release,issuer:security.issuer}),/separate identities/);
 assert.throws(()=>assertIndependentReviewers(security,{...release,keyId:security.keyId}),/separate identities/);
});
test("M12 real EdDSA validation: bound exact 18881, human signer role, review ID, digest, no financial authorisation",async()=>{
 const sha="c".repeat(64);
 const token=await sign(security,sha);
 const result=await verifyHumanReviewAssertion(token,security);
 assert.equal(result.role,"security_reviewer");
 assert.equal(result.wallet,wallet);
 assert.equal(result.bundleSha256,sha);
 assert.equal(result.claimedDecision,"NO_GO");
 assert.match(result.assertionSha256,/^[a-f0-9]{64}$/);
 await assert.rejects(verifyHumanReviewAssertion(token+"-tamper",security),/signature/);
 await assert.rejects(verifyHumanReviewAssertion(token,release),/signature/);
 await assert.rejects(verifyHumanReviewAssertion(await sign(security,sha,{
  chainId:19991}),security),/reviewer|chain/);
 await assert.rejects(verifyHumanReviewAssertion(await sign(security,sha,{
  financialExecutionAuthorised:true}),security),/reviewer|chain/);
 await assert.rejects(verifyHumanReviewAssertion(await sign(security,sha,{
  reviewId:"bad-id"}),security),/reviewer|chain/);
 await assert.rejects(verifyHumanReviewAssertion(await sign(security,sha,{
  bundleSha256:"not-a-sha256"}),security),/reviewer|chain/);
 await assert.rejects(verifyHumanReviewAssertion(await sign(security,sha,{
  role:"release_operator"}),security),/reviewer|chain/);
 await assert.rejects(verifyHumanReviewAssertion(await sign(security,sha,{},now-600),security),/signature/);
 const unverifiedGo=await verifyHumanReviewAssertion(await sign(security,sha,{
  decision:"GO_PROPOSAL_UNVERIFIED"}),security);
 assert.equal(unverifiedGo.claimedDecision,"GO_PROPOSAL_UNVERIFIED");
});
function witness(args:{hash?:Hex;parent?:Hex;chain?:number;head?:bigint;code?:Hex;url:string})
 :ReadonlyWitnessProvider{
 return {url:args.url,chainId:async()=>args.chain??18881,
  head:async()=>args.head??120n,
  block:async n=>({number:n,hash:args.hash||digest,parentHash:args.parent||parent}),
  code:async()=>args.code||runtime};
}
const p=()=>witness({url:"https://primary.ultra.example"});
const s=()=>witness({url:"https://unrelated.independent.example"});
test("M12 Testnet only: 12-confirmation two RPC canonical + Blockscout block witness; never NFT/sale approval",async()=>{
 const w=await corroborateBlock(p(),s(),async(_n,h)=>h===digest,12);
 assert.equal(w.number,"108");
 assert.equal(w.independentlyCorroboratedAtBlock,true);
 assert.equal(w.operatorIndependenceReviewed,false);
 assert.equal(w.nftOwnershipVerified,false);
 assert.equal(w.releaseApproved,false);
 const code=await verifyReadOnlyContractCode(p(),s(),w,wallet,keccak256(runtime));
 assert.equal(code.codeHash,keccak256(runtime));
 assert.equal(code.securityAuditVerified,false);
 await assert.rejects(corroborateBlock(p(),s(),async()=>false),/Blockscout/);
 await assert.rejects(corroborateBlock(p(),witness({url:"https://unrelated.independent.example",chain:19991}),async()=>true),/mainnet/);
 await assert.rejects(corroborateBlock(p(),witness({url:"https://unrelated.independent.example",hash:parent}),async()=>true),/canonical/);
 await assert.rejects(corroborateBlock(p(),witness({url:"https://unrelated.independent.example",parent:digest}),async()=>true),/canonical/);
 await assert.rejects(corroborateBlock(p(),s(),async()=>true,1),/12 verified/);
 await assert.rejects(verifyReadOnlyContractCode(p(),s(),w,wallet,digest),/runtime bytecode/);
 await assert.rejects(verifyReadOnlyContractCode(p(),s(),w,"0xnotanaddress",keccak256(runtime)),/operator-approved/);
});
test("M12 malicious, loopback, same-host and credential-bearing RPC endpoints fail closed",()=>{
 assert.throws(()=>publicRpcURL("http://localhost:8545"),/HTTPS/);
 assert.throws(()=>publicRpcURL("https://127.0.0.1/"),/HTTPS/);
 assert.throws(()=>publicRpcURL("https://api.example/?secret=a"),/HTTPS/);
 assert.throws(()=>publicRpcURL("https://user:secret@api.example/"),/HTTPS/);
 assert.throws(()=>distinctRPCs("https://one.provider.example","https://one.provider.example"),/different/);
 assert.doesNotThrow(()=>distinctRPCs("https://one.provider.example","https://two.provider.example"));
});
test("M12 all previous financial and source acceptance controls are OFF by default",async()=>{
 const env=await readFile(new URL("../.env.example",import.meta.url),"utf8");
 for(const flag of ["M12_OPERATOR_RECORD_NO_GO","M12_SIGNED_HUMAN_CANDIDATES_ENABLED",
  "M12_SOURCE_CHECK_ENABLED","M12_FINAL_PUBLIC_BETA_ENABLED",
  "M12_FINAL_MAINNET_ENABLED","M12_FINAL_FINANCIAL_EXECUTION_ENABLED",
  "M10_SOCIAL_SYNC_ENABLED","M11_REVOCATION_SYNC_ENABLED",
  "NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT","NEXT_PUBLIC_M5_ENABLE_MINTING",
  "NEXT_PUBLIC_M7_ENABLE_SETTLEMENT","NEXT_PUBLIC_M8_ENABLE_FUNDING"]){
   assert.match(env,new RegExp("^"+flag+"=false$","m"));
 }
});
