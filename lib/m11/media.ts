import {createHash} from "node:crypto";
import type {Pool} from "pg";
import {ApiError} from "../server/http";
import {getDb,inTransaction} from "../server/db";
import {isAddress} from "viem";

/** Candidate checks only. An M6 database row is never an independent Cloudinary,
 * ClamAV, Pinata, moderator or chain witness by itself. */
export type MediaCandidate={assetId:string;ownerWallet:string;cloudinarySha256:string;
 clamavEvidenceSha256:string;pinataCid:string;moderatorEventId:string;
 blockNumber:string|null;status:"candidate_unverified"};
const cidPattern=/^(bafy[a-z2-7]{40,100}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;
const sha=/^[a-f0-9]{64}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function checkInput(asset:string,wallet:string){
 if(!uuid.test(asset)||!isAddress(wallet,{strict:false}))
  throw new ApiError(400,"Real media UUID and owner wallet required");
 return {asset:asset.toLowerCase(),wallet:wallet.toLowerCase()};
}
export async function inspectExistingMediaCandidate(assetId:string,ownerWallet:string,pool:Pool=getDb()){
 const input=checkInput(assetId,ownerWallet);
 const r=await pool.query<{
  id:string;owner_wallet:string;state:string;media_kind:string;sha256:string;
  scan_result:string|null;scan_checked_at:Date|null;scan_evidence_sha256:string|null;
  storage_provider:string;storage_delivery:string;provider_asset_id:string|null;
  pin_state:string;media_ipfs_cid:string|null;ipfs_verified_at:Date|null;
  reviewer_wallet:string|null;reviewed_at:Date|null;
  event_id:string|null;event_decision:string|null;
 }>(`SELECT a.id,a.owner_wallet,a.state,a.media_kind,a.sha256,
   a.scan_result,a.scan_checked_at,a.scan_evidence_sha256,
   a.storage_provider,a.storage_delivery,a.provider_asset_id,
   a.pin_state,a.media_ipfs_cid,a.ipfs_verified_at,
   a.reviewer_wallet,a.reviewed_at,
   (SELECT e.id::text FROM nft_media_review_events e
    WHERE e.media_id=a.id AND e.decision='approved'
     AND e.reviewer_wallet=a.reviewer_wallet
    ORDER BY e.decided_at DESC,e.id DESC LIMIT 1) AS event_id,
   (SELECT e.decision FROM nft_media_review_events e
    WHERE e.media_id=a.id ORDER BY e.decided_at DESC,e.id DESC LIMIT 1) AS event_decision
  FROM nft_media_assets a WHERE a.id=$1 AND a.owner_wallet=$2 AND a.chain_id=18881`,
  [input.asset,input.wallet]);
 if(r.rowCount!==1)throw new ApiError(404,"No user-owned, real M6 media inventory");
 const m=r.rows[0];
 if(m.state!=="approved"||m.scan_result!=="clean"||!m.scan_checked_at||
  !m.scan_evidence_sha256||!sha.test(m.scan_evidence_sha256)||
  m.storage_provider!=="cloudinary"||m.storage_delivery!=="authenticated"||
  !m.provider_asset_id||m.pin_state!=="verified"||
  !m.media_ipfs_cid||!cidPattern.test(m.media_ipfs_cid)||
  !m.ipfs_verified_at||!m.reviewer_wallet||!m.reviewed_at||
  !m.event_id||m.event_decision!=="approved")
  throw new ApiError(409,"M6 Cloudinary, ClamAV, Pinata and human moderation evidence incomplete");
 return {assetId:input.asset,ownerWallet:input.wallet,kind:m.media_kind,
  sha256:m.sha256,cloudinaryProviderId:m.provider_asset_id,
  cloudinaryDelivery:m.storage_delivery,clamavEvidenceSha256:m.scan_evidence_sha256,
  pinataCid:m.media_ipfs_cid,moderatorEventId:m.event_id,
  status:"candidate_unverified" as const,
  warning:"Internal M6 evidence only; independent authenticated Cloudinary/ClamAV/Pinata sources and human review NOT confirmed"};
}
export async function recordMediaCandidate(input:{
 assetId:string;ownerWallet:string;cloudinarySha256:string;
 clamavEvidenceSha256:string;pinataCid:string;moderatorEventId:string
}):Promise<MediaCandidate>{
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
   process.env.M11_MEDIA_RECONCILE_ENABLED!=="true")
  throw new ApiError(503,"M11 media witness storage disabled until operator source credentials approved");
 const candidate=await inspectExistingMediaCandidate(input.assetId,input.ownerWallet);
 if(!sha.test(input.cloudinarySha256)||!sha.test(input.clamavEvidenceSha256)||
  !cidPattern.test(input.pinataCid)||!uuid.test(input.moderatorEventId)||
  input.clamavEvidenceSha256!==candidate.clamavEvidenceSha256||
  input.pinataCid!==candidate.pinataCid||
  input.moderatorEventId!==candidate.moderatorEventId)
  throw new ApiError(409,"Media witness input does not match genuine user-owned M6 ledger records");
 const data=await inTransaction(async db=>{
  const locked=await db.query("SELECT id FROM nft_media_assets WHERE id=$1 AND owner_wallet=$2 AND state='approved' FOR UPDATE",
   [candidate.assetId,candidate.ownerWallet]);
  if(locked.rowCount!==1)throw new ApiError(409,"Media changed during read-only evidence check");
  const row=await db.query(`INSERT INTO nft_m11_media_witness_checks(
   asset_id,owner_wallet,cloudinary_sha256,clamav_evidence_sha256,pinata_cid,moderator_event_id)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING asset_id`,
   [candidate.assetId,candidate.ownerWallet,input.cloudinarySha256,
    input.clamavEvidenceSha256,input.pinataCid,input.moderatorEventId]);
  if(row.rowCount!==1)throw new ApiError(409,"Media witness candidate already recorded, no replay");
  return {assetId:candidate.assetId,ownerWallet:candidate.ownerWallet,
   cloudinarySha256:input.cloudinarySha256,clamavEvidenceSha256:input.clamavEvidenceSha256,
   pinataCid:input.pinataCid,moderatorEventId:input.moderatorEventId,
   blockNumber:null,status:"candidate_unverified" as const};
 });
 return data;
}
/** Confirm the operator provided read-only source stubs are configured, but
 * never claim mere existence of credentials is an independent audit. */
export function mediaAcceptanceDependencies(){
 const configured={
  cloudinary:Boolean(process.env.M6_CLOUDINARY_CLOUD_NAME&&process.env.M6_CLOUDINARY_API_KEY&&process.env.M6_CLOUDINARY_API_SECRET),
  clamav:Boolean(process.env.M6_CLAMAV_HOST&&process.env.M6_CLAMAV_PORT),
  pinata:Boolean(process.env.M6_PINATA_JWT),
  humanModerator:Boolean(process.env.M6_MODERATOR_WALLETS)
 };
 return {configured,independentEvidenceVerified:false,releaseApproved:false,
  warning:"Cloudinary signed API delivery, independent ClamAV scan source logs, Pinata CID gateway content and signed human moderation have not been independently checked."};
}
