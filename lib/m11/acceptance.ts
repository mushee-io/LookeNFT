import {randomUUID} from "node:crypto";
import {importSPKI,jwtVerify} from "jose";
import {getAddress,isAddress} from "viem";
import {getDb,inTransaction} from "../server/db";
import {ApiError} from "../server/http";

export const M11_GATES=[
 "looke_m2_issuer","looke_m10_issuer","social_revocation",
 "blocked_viewer_policy","reown_mobile","reown_desktop",
 "operator_postgres_restore","protected_rollback",
 "cloudinary_delivery","clamav_scan","pinata_cid","human_moderation",
 "approved_nft_registry","independent_rpc","blockscout",
 "cancun_mcopy_push0","contract_security_audit","human_operator_review"
] as const;
export type M11Gate=(typeof M11_GATES)[number];
export type CandidateEvidence={
 gate:M11Gate;sha256:string;sourceUri:string;format:
 "source_log"|"signed_report"|"rpc_receipt"|"review_document";
 reviewerWallet:string;issuer:string;jti:string;
 assertionSha256:string;observedAt:Date;issuedAt:Date;
};
/** Human signing is submission provenance ONLY; no code may auto-approve an audit. */
export function operatorWallets():string[]{
 return (process.env.M11_OPERATOR_WALLETS||"").split(",")
  .map(s=>s.trim().toLowerCase()).filter(s=>isAddress(s,{strict:false}));
}
export function requireAcceptanceOperator(wallet:string,write=false):void{
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
  process.env.M11_ACCEPTANCE_READ_ENABLED!=="true"||
  (write&&process.env.M11_EVIDENCE_SUBMISSIONS_ENABLED!=="true")||
  !operatorWallets().includes(wallet.toLowerCase()))
  throw new ApiError(403,"Only an explicitly authorised Testnet M11 acceptance reviewer may inspect evidence");
}
const regexSha=/^[a-f0-9]{64}$/;
function safeEvidenceURL(raw:unknown):string{
 if(typeof raw!=="string"||raw.length>1024)throw new ApiError(403,"HTTPS evidence link required");
 let uri:URL;
 try{uri=new URL(raw);}catch{throw new ApiError(403,"Invalid evidence link");}
 if(uri.protocol!=="https:"||uri.username||uri.password||uri.port||
  uri.hash||!uri.hostname.includes(".")||
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|.*\.local$)/i.test(uri.hostname))
  throw new ApiError(403,"Evidence link must be an externally reviewed HTTPS resource");
 return uri.toString();
}
export async function verifyEvidenceSubmission(
 raw:unknown,options:{issuer:string;publicKeyPem:string;operatorWallet:string},
 clock=new Date()
):Promise<CandidateEvidence>{
 if(typeof raw!=="string"||raw.length<70||raw.length>12_000||
  !options.issuer.startsWith("https://")||!isAddress(options.operatorWallet,{strict:false}))
  throw new ApiError(503,"An authorised evidence reviewer and signed submission are required");
 let claim:Record<string,unknown>;
 try{
  const key=await importSPKI(options.publicKeyPem,"EdDSA");
  claim=(await jwtVerify(raw,key,{
   algorithms:["EdDSA"],audience:"lookenft-m11-evidence",
   issuer:options.issuer,clockTolerance:"5s",
   currentDate:clock,maxTokenAge:"5m"
  })).payload as Record<string,unknown>;
 }catch{throw new ApiError(403,"Invalid or expired independent human-reviewed evidence JWT");}
 const reviewer=claim.sub;
 if(typeof reviewer!=="string"||!isAddress(reviewer,{strict:false})||
  getAddress(reviewer).toLowerCase()!==options.operatorWallet.toLowerCase())
  throw new ApiError(403,"Evidence reviewer signature not bound to configured operator");
 if(claim.chainId!==18881||claim.version!==1||
  typeof claim.jti!=="string"||claim.jti.length<8||claim.jti.length>256||
  typeof claim.iat!=="number"||typeof claim.exp!=="number"||
  claim.exp-claim.iat>300||claim.exp<=claim.iat)
  throw new ApiError(403,"Evidence JWT chain, nonce or validity invalid");
 if(!M11_GATES.includes(claim.gate as M11Gate)||typeof claim.sha256!=="string"||
  !regexSha.test(claim.sha256)||!["source_log","signed_report","rpc_receipt","review_document"].includes(String(claim.format))||
  typeof claim.observedAt!=="number"||!Number.isSafeInteger(claim.observedAt)||
  claim.observedAt>Math.floor(clock.getTime()/1000)+5||
  claim.observedAt<Math.floor(clock.getTime()/1000)-7*86400)
  throw new ApiError(403,"Evidence gate, source digest or observation window untrusted");
 return {
  gate:claim.gate as M11Gate,sha256:claim.sha256,sourceUri:safeEvidenceURL(claim.sourceUri),
  format:claim.format as CandidateEvidence["format"],reviewerWallet:options.operatorWallet.toLowerCase(),
  issuer:options.issuer,jti:claim.jti,assertionSha256:(await import("node:crypto")).createHash("sha256").update(raw).digest("hex"),
  observedAt:new Date(claim.observedAt*1000),issuedAt:new Date(claim.iat*1000)
 };
}
export async function storeEvidenceCandidate(data:CandidateEvidence){
 return inTransaction(async client=>{
  const row=await client.query(
   `INSERT INTO nft_m11_evidence_candidates(
     id,gate,source_uri,source_sha256,evidence_format,submitted_by_wallet,
     reviewer_assertion_sha256,reviewer_jti,observed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT DO NOTHING RETURNING id`,
   [randomUUID(),data.gate,data.sourceUri,data.sha256,data.format,data.reviewerWallet,
    data.assertionSha256,data.jti,data.observedAt]);
  if(row.rowCount!==1)throw new ApiError(409,"Evidence candidate or signed reviewer nonce already consumed");
  return {id:row.rows[0].id,gate:data.gate,status:"submitted_unverified" as const,
   acceptedAsReleaseProof:false,financialExecution:false};
 });
}
export async function acceptanceReport(){
 const db=getDb();
 const [rows,revocations,avatars,media,links]=await Promise.all([
  db.query<{gate:M11Gate;count:string}>(
   "SELECT gate,count(*)::text AS count FROM nft_m11_evidence_candidates GROUP BY gate"),
  db.query<{count:string}>("SELECT count(*)::text AS count FROM nft_m11_social_revocations"),
  db.query<{count:string}>(`SELECT count(*)::text AS count FROM nft_m10_verified_nft_avatars a
    JOIN nft_indexer_blocks b ON b.chain_id=a.chain_id AND b.block_number=a.block_number
     AND b.block_hash=a.block_hash
    WHERE a.expires_at>now()`),
  db.query<{count:string}>("SELECT count(*)::text AS count FROM nft_m11_media_witness_checks"),
  db.query<{count:string}>(`SELECT count(*)::text AS count FROM nft_m10_social_profiles s
    JOIN nft_profile_links p ON p.wallet_address=s.wallet_address AND p.profile_id=s.profile_id
    WHERE s.expires_at>now() AND s.public_approved=true AND s.suspended=false
     AND NOT EXISTS(SELECT 1 FROM nft_m11_social_revocations r WHERE r.wallet_address=s.wallet_address)`),
 ]);
 const map=new Map(rows.rows.map(r=>[r.gate,Number(r.count)]));
 return {
  chainId:18881,releaseDecision:"NO_GO" as const,
  financialExecutionEnabled:false,mainnetEnabled:false,
  humanReviewPassed:false,independentSourcePassed:false,
  m12IsFinalMilestone:true,
  gates:M11_GATES.map(gate=>({gate,candidates:map.get(gate)||0,
   state:map.has(gate)?"submitted_unverified":"blocked_no_evidence",
   approved:false})),
  localDatabaseObservations:{
   revokedSocialWallets:revocations.rows[0].count,
   nonExpiredCanonicalAvatarSnapshots:avatars.rows[0].count,
   unverifiedMediaWitnessCandidates:media.rows[0].count,
   nonExpiredLinkedSocialSnapshots:links.rows[0].count
  },
  warning:"Database records and signed reviewer candidate submissions do not prove a human audit, real wallet walkthrough, provider ownership or independent Blockscout chain evidence."
 };
}
