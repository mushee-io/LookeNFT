import {createHash} from "node:crypto";
import {importSPKI,jwtVerify} from "jose";
import {getAddress,isAddress} from "viem";
import type {Pool} from "pg";
import {inTransaction} from "../server/db";
import {ApiError} from "../server/http";
import type {SocialTrust} from "../m10/claims";

const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const sha40=/^[a-f0-9]{40}$/;
const validWallet=(v:unknown):string=>{
 if(typeof v!=="string"||!isAddress(v,{strict:false})||/^0x0{40}$/i.test(v))
  throw new ApiError(403,"Signed source wallet missing or invalid");
 return getAddress(v).toLowerCase();
};
export type Revocation={
 wallet:string;issuer:string;jti:string;reason:"account_suspended"|"account_deleted"|"consent_withdrawn"|"security_hold";
 issuedAt:Date;expiresAt:Date;assertionSha256:string;
};
export type VisibilityDecision={
 viewer:string;subject:string;issuer:string;jti:string;
 policy:"allowed"|"blocked_by_viewer"|"blocked_by_subject"|"muted_by_viewer"|"hidden";
 issuedAt:Date;expiresAt:Date;assertionSha256:string;allowed:boolean;
};
export function m11SourceGate(action:"revocation"|"visibility"):void{
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
    process.env[action==="revocation"?"M11_REVOCATION_SYNC_ENABLED":"M11_VISIBILITY_CHECK_ENABLED"]!=="true")
  throw new ApiError(503,"M11 source signal "+action+" is disabled until the real Looke issuer and operator review exist");
}
async function signedClaims(raw:unknown,trust:SocialTrust,audience:string,clock:Date){
 if(typeof raw!=="string"||raw.length<70||raw.length>12000||
    !trust.issuer.startsWith("https://")||!sha40.test(trust.expectedSourceCommit))
  throw new ApiError(503,"Pinned signed Looke Social source required");
 try{
  const key=await importSPKI(trust.publicKeyPem,"EdDSA");
  const result=await jwtVerify(raw,key,{
   issuer:trust.issuer,audience,algorithms:["EdDSA"],
   maxTokenAge:"60s",currentDate:clock,clockTolerance:"5s"
  });
  const c=result.payload;
  if(c.chainId!==18881||c.source!=="looke-social-postgres"||
     c.sourceCommit!==trust.expectedSourceCommit||c.version!==1||
     typeof c.iat!=="number"||typeof c.exp!=="number"||
     !Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||
     c.exp-c.iat>60||c.exp<=c.iat||
     c.iat>Math.floor(clock.getTime()/1000)+5||
     typeof c.jti!=="string"||c.jti.length<8||c.jti.length>256)
   throw new ApiError(403,"Signed source chain, version or time invalid");
  return {claims:c,digest:digest(raw),issuedAt:new Date(c.iat*1000),
   expiresAt:new Date(c.exp*1000)};
 }catch(e){
  if(e instanceof ApiError&&e.status===503)throw e;
  throw new ApiError(403,"Untrusted, expired, replayable or wrongly scoped Looke Social assertion");
 }
}
export async function verifyRevocation(
 raw:unknown,trust:SocialTrust,clock=new Date()
):Promise<Revocation>{
 const signed=await signedClaims(raw,trust,"lookenft-revocation",clock);
 const c=signed.claims;
 if(c.action!=="revoke"||!["account_suspended","account_deleted","consent_withdrawn","security_hold"].includes(String(c.reason)))
  throw new ApiError(403,"Unrecognised signed source revocation action");
 const wallet=validWallet(c.wallet);
 if(c.sub!==wallet)throw new ApiError(403,"Revocation subject and wallet mismatch");
 return {wallet,issuer:trust.issuer,jti:c.jti as string,
  reason:c.reason as Revocation["reason"],issuedAt:signed.issuedAt,
  expiresAt:signed.expiresAt,assertionSha256:signed.digest};
}
export async function persistRevocation(proof:Revocation){
 return inTransaction(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[proof.wallet]);
  const exists=await db.query(
   `INSERT INTO nft_m11_social_revocations(
     wallet_address,source_issuer,source_jti,assertion_sha256,reason,source_issued_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING wallet_address`,
   [proof.wallet,proof.issuer,proof.jti,proof.assertionSha256,proof.reason,proof.issuedAt]);
  if(exists.rowCount!==1)throw new ApiError(409,"Source revocation already recorded: no replay or automatic unsuspend");
  // Cascade invalidates M2 profile linking, M10 snapshot, posts, avatar,
  // and local collection share. Wallet auth is a separate user login.
  await db.query("UPDATE nft_wallet_sessions SET revoked_at=now() WHERE wallet_address=$1 AND revoked_at IS NULL",
   [proof.wallet]);
  await db.query("DELETE FROM nft_auth_challenges WHERE wallet_address=$1",[proof.wallet]);
  await db.query("DELETE FROM nft_profile_links WHERE wallet_address=$1",[proof.wallet]);
  return {status:"revoked",wallet:proof.wallet,accountLinkInvalidated:true,
   financialTransactions:false,liveSourceEvidenceAvailable:false};
 });
}
export async function verifyVisibility(
 raw:unknown,trust:SocialTrust,clock=new Date()
):Promise<VisibilityDecision>{
 const signed=await signedClaims(raw,trust,"lookenft-visibility",clock);
 const c=signed.claims;
 const viewer=validWallet(c.viewer),subject=validWallet(c.subjectWallet);
 if(c.sub!==viewer||c.action!=="view_profile"||viewer===subject||
    !["allowed","blocked_by_viewer","blocked_by_subject","muted_by_viewer","hidden"].includes(String(c.policy))||
    typeof c.policyCheckedAt!=="number"||
    !Number.isSafeInteger(c.policyCheckedAt)||
    c.policyCheckedAt<c.iat!||c.policyCheckedAt>c.iat!+10||
    Math.floor(clock.getTime()/1000)-c.policyCheckedAt>60)
  throw new ApiError(403,"Looke Social viewer/subject block and mute policy is not fresh or bound");
 return {viewer,subject,issuer:trust.issuer,jti:c.jti as string,
  policy:c.policy as VisibilityDecision["policy"],
  issuedAt:signed.issuedAt,expiresAt:signed.expiresAt,
  assertionSha256:signed.digest,allowed:c.policy==="allowed"};
}
export async function consumeVisibilityDecision(
 proof:VisibilityDecision,authenticatedViewer:string,pool:Pool
):Promise<{allowed:boolean;subject:string;policy:string}>{
 if(proof.viewer!==authenticatedViewer.toLowerCase())
  throw new ApiError(403,"Viewer-scoped Social policy cannot be reused by another wallet");
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[proof.viewer]);
  const prior=await db.query(
   "SELECT 1 FROM nft_m11_social_revocations WHERE wallet_address IN($1,$2)",
   [proof.viewer,proof.subject]);
  if(prior.rowCount)throw new ApiError(403,"Social source account was revoked");
  const insert=await db.query(
   `INSERT INTO nft_m11_visibility_consumed(
    source_issuer,jti,viewer_wallet,subject_wallet,policy_digest,source_issued_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING jti`,
   [proof.issuer,proof.jti,proof.viewer,proof.subject,proof.assertionSha256,proof.issuedAt]);
  if(insert.rowCount!==1)throw new ApiError(409,"Looke visibility proof already consumed");
  await db.query("COMMIT");
  return {allowed:proof.allowed,subject:proof.subject,policy:proof.policy};
 }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
