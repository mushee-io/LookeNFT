import {createHash,randomUUID} from "node:crypto";
import {importSPKI,jwtVerify} from "jose";
import {getAddress,isAddress} from "viem";
import {getDb,inTransaction} from "../server/db";
import {ApiError} from "../server/http";

export type HumanRole="security_reviewer"|"release_operator";
export type HumanReviewClaim={
 role:HumanRole;wallet:string;issuer:string;kid:string;jti:string;
 reviewId:string;bundleSha256:string;claimedDecision:
 "NO_GO"|"GO_PROPOSAL_UNVERIFIED";assertionSha256:string;observedAt:Date
};
export type ReviewerTrust={role:HumanRole;issuer:string;publicKeyPem:string;
 keyId:string;reviewerWallet:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=/^[a-f0-9]{64}$/;
const wallet=(w:string)=>getAddress(w).toLowerCase();
export function reviewerTrustFromEnvironment(role:HumanRole):ReviewerTrust{
 const prefix=role==="security_reviewer"?"M12_SECURITY_REVIEWER":"M12_RELEASE_OPERATOR";
 const issuer=process.env[prefix+"_ISSUER"]||"";
 const publicKeyPem=(process.env[prefix+"_PUBLIC_KEY_PEM"]||"").replace(/\\n/g,"\n");
 const keyId=process.env[prefix+"_KEY_ID"]||"";
 const reviewerWallet=process.env[prefix+"_WALLET"]||"";
 if(!issuer.startsWith("https://")||!publicKeyPem.includes("BEGIN PUBLIC KEY")||
  keyId.length<8||!isAddress(reviewerWallet,{strict:false}))
  throw new ApiError(503,"Separate genuine independent human security/release reviewer EdDSA issuer required");
 return {role,issuer,publicKeyPem,keyId,reviewerWallet:wallet(reviewerWallet)};
}
export async function verifyHumanReviewAssertion(
 raw:unknown,trust:ReviewerTrust,clock=new Date()
):Promise<HumanReviewClaim>{
 if(typeof raw!=="string"||raw.length<70||raw.length>12_000||
  !trust.issuer.startsWith("https://")||!isAddress(trust.reviewerWallet,{strict:false})||
  trust.keyId.length<8)
  throw new ApiError(403,"Independent signed M12 human review is required");
 let claim:Record<string,unknown>,kid:string|undefined;
 try{
  const publicKey=await importSPKI(trust.publicKeyPem,"EdDSA");
  const checked=await jwtVerify(raw,publicKey,{
   issuer:trust.issuer,audience:"lookenft-m12-final-review",
   algorithms:["EdDSA"],currentDate:clock,
   maxTokenAge:"2m",clockTolerance:"5s"
  });
  claim=checked.payload as Record<string,unknown>;
  kid=checked.protectedHeader.kid;
 }catch{throw new ApiError(403,"Human M12 reviewer signature, issuer or time window invalid");}
 const time=Math.floor(clock.getTime()/1000);
 if(kid!==trust.keyId||claim.chainId!==18881||claim.milestone!==12||
  claim.version!==1||claim.role!==trust.role||
  typeof claim.sub!=="string"||!isAddress(claim.sub,{strict:false})||
  wallet(claim.sub)!==wallet(trust.reviewerWallet)||
  typeof claim.reviewId!=="string"||!uuid.test(claim.reviewId)||
  typeof claim.bundleSha256!=="string"||!sha.test(claim.bundleSha256)||
  typeof claim.jti!=="string"||claim.jti.length<8||claim.jti.length>256||
  typeof claim.iat!=="number"||!Number.isSafeInteger(claim.iat)||
  typeof claim.exp!=="number"||!Number.isSafeInteger(claim.exp)||
  claim.exp-claim.iat>120||claim.exp<=claim.iat||
  claim.iat>time+5||
  !["NO_GO","GO_PROPOSAL_UNVERIFIED"].includes(String(claim.decision))||
  claim.financialExecutionAuthorised!==false||
  claim.mainnetAuthorised!==false)
  throw new ApiError(403,"Human reviewer, exact bundle, chain or explicit NO-execution claim invalid");
 return {role:trust.role,wallet:wallet(claim.sub),issuer:trust.issuer,
  kid:trust.keyId,jti:claim.jti as string,reviewId:claim.reviewId,
  bundleSha256:claim.bundleSha256,
  claimedDecision:claim.decision as HumanReviewClaim["claimedDecision"],
  assertionSha256:createHash("sha256").update(raw).digest("hex"),
  observedAt:new Date(claim.iat*1000)};
}
export function assertIndependentReviewers(security:ReviewerTrust,release:ReviewerTrust):void{
 if(security.role!=="security_reviewer"||release.role!=="release_operator"||
  wallet(security.reviewerWallet)===wallet(release.reviewerWallet)||
  security.issuer===release.issuer||security.keyId===release.keyId)
  throw new ApiError(403,"Security reviewer and release operator must have separate identities and trust issuers");
}
export async function recordSignedHumanCandidate(
 claim:HumanReviewClaim,
 trust?:{security:ReviewerTrust;release:ReviewerTrust}
):Promise<{id:string;decision:"NO_GO";status:"signature_valid_source_unverified"}>{
 if(process.env.M12_SIGNED_HUMAN_CANDIDATES_ENABLED!=="true"||
  process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw new ApiError(503,"Real human-signature candidate ingestion disabled");
 const trusted=trust||{security:reviewerTrustFromEnvironment("security_reviewer"),
  release:reviewerTrustFromEnvironment("release_operator")};
 assertIndependentReviewers(trusted.security,trusted.release);
 const configured=claim.role==="security_reviewer"?trusted.security:trusted.release;
 if(claim.wallet!==wallet(configured.reviewerWallet)||claim.issuer!==configured.issuer||
  claim.kid!==configured.keyId)
  throw new ApiError(403,"Reviewer claim does not match signed human role");
 return inTransaction(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[claim.reviewId]);
  const target=await db.query<{
   evidence_bundle_sha256:string;decision:string;human_release_approved:boolean
  }>(`SELECT evidence_bundle_sha256,decision,human_release_approved
   FROM nft_m12_final_reviews WHERE id=$1 FOR UPDATE`,[claim.reviewId]);
  if(target.rowCount!==1||target.rows[0].evidence_bundle_sha256!==claim.bundleSha256||
    target.rows[0].decision!=="NO_GO"||target.rows[0].human_release_approved)
   throw new ApiError(409,"Signed human review mismatches immutable NO-GO evidence bundle");
  const conflict=await db.query<{reviewer_wallet:string}>(
   "SELECT reviewer_wallet FROM nft_m12_human_attestation_candidates WHERE review_id=$1",
   [claim.reviewId]);
  if(conflict.rows.some(x=>x.reviewer_wallet===claim.wallet))
   throw new ApiError(409,"A reviewer cannot approve the same bundle twice or play both human roles");
  const id=randomUUID();
  const saved=await db.query(`INSERT INTO nft_m12_human_attestation_candidates(
   id,review_id,role,reviewer_wallet,issuer,key_id,jti,
   signature_sha256,attested_bundle_sha256,claimed_decision,observed_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
   ON CONFLICT DO NOTHING RETURNING id`,
   [id,claim.reviewId,claim.role,claim.wallet,claim.issuer,
    claim.kid,claim.jti,claim.assertionSha256,claim.bundleSha256,
    claim.claimedDecision,claim.observedAt]);
  if(saved.rowCount!==1)throw new ApiError(409,"Signed human review duplicate, expired or replayed");
  return {id,decision:"NO_GO" as const,status:"signature_valid_source_unverified" as const};
 });
}
export async function getAttestationCandidates(reviewId:string){
 if(!uuid.test(reviewId))throw new ApiError(400,"Invalid final review ID");
 const r=await getDb().query(`SELECT role,reviewer_wallet,issuer,key_id,
   claimed_decision,verification_status,observed_at
   FROM nft_m12_human_attestation_candidates WHERE review_id=$1
   ORDER BY role,observed_at`,[reviewId]);
 return r.rows;
}
