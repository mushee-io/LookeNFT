import {createHash,randomUUID} from "node:crypto";
import {M11_GATES,type M11Gate,requireAcceptanceOperator} from "../m11/acceptance";
import {getDb,inTransaction} from "../server/db";
import {ApiError} from "../server/http";

export const M12_PREDECESSOR_COMMIT="5972f3b1f999de1b9e762af8524869e90228d643";
export const M12_FINAL_MILESTONE=12 as const;
export const M12_DECISION="NO_GO" as const;
export type GateStatus="blocked"|"candidate_unverified"|"source_unavailable";
export type GateFinding={gate:M11Gate;state:GateStatus;blocker:string;sourceSha256:string|null};
export type FinalNoGoBundle={milestone:12;chainId:18881;decision:"NO_GO";
  predecessorCommit:string;operatorWallet:string;allEarlierPRsRemainDraft:true;
  acceptanceGates:GateFinding[];humanReleaseApproved:false;
  independentlyApproved:false;financialExecutionEnabled:false;
  mainnetEnabled:false;publicBetaEnabled:false;reason:string};
const sha40=/^[0-9a-f]{40}$/;
const sha64=/^[0-9a-f]{64}$/;
const blockers:Record<M11Gate,string>={
 looke_m2_issuer:"No independently reviewed, deployed, wallet-bound portable M2 EdDSA issuer in Looke Social.",
 looke_m10_issuer:"No genuine signed and currently moderated Looke Social profile/post issuer.",
 social_revocation:"No live signed revocation issuer, key rotation and human recovery acceptance.",
 blocked_viewer_policy:"No live viewer-specific signed Looke block, mute and moderation policy.",
 reown_mobile:"No operator-confirmed Android/iOS real-wallet pairing, login, logout or receipt evidence.",
 reown_desktop:"No operator-confirmed Windows Reown pairing, wallet session and device review.",
 operator_postgres_restore:"Only an ephemeral localhost 33-table/350-constraint restore was verified; operator PostgreSQL not approved.",
 protected_rollback:"No independently signed protected production backup, alias and rollback rehearsal.",
 cloudinary_delivery:"No authenticated Cloudinary real asset hash, provider delivery and account proof.",
 clamav_scan:"No independent live ClamAV malware engine log, clean scan and operator witness.",
 pinata_cid:"No independently resolved signed Pinata pin/CID and byte-exact IPFS content proof.",
 human_moderation:"No genuinely authorised human media review and suspension/appeal audit file.",
 approved_nft_registry:"No real source-approved Ultra Testnet NFT factory/collection on-chain witness.",
 independent_rpc:"No independently controlled second Ultra EVM Testnet RPC and source agreement proof.",
 blockscout:"Official Blockscout check reported HTTP 404; NFT receipt/block independently unverified.",
 cancun_mcopy_push0:"No actual Testnet Cancun MCOPY/PUSH0 opcode transaction and source-backed evidence.",
 contract_security_audit:"No independent signed Solidity/custody/security audit with closed findings.",
 human_operator_review:"No two-person independent operator and security reviewer sign-off on real evidence."
};
export function sha256(value:string):string{
 return createHash("sha256").update(value).digest("hex");
}
export function defaultNoGoFindings():GateFinding[]{
 return M11_GATES.map(gate=>({gate,state:"source_unavailable" as const,
  blocker:blockers[gate],sourceSha256:null}));
}
export function assertGateFindings(input:readonly GateFinding[]):void{
 if(input.length!==M11_GATES.length||new Set(input.map(x=>x.gate)).size!==M11_GATES.length||
  input.some(x=>!M11_GATES.includes(x.gate)||
   !["blocked","candidate_unverified","source_unavailable"].includes(x.state)||
   typeof x.blocker!=="string"||x.blocker.length<12||x.blocker.length>500||
   (x.sourceSha256!==null&&!sha64.test(x.sourceSha256))))
  throw new ApiError(409,"M12 final gate matrix incomplete or claims unauthorised release");
}
export function makeFinalNoGoBundle(input:{
 operatorWallet:string;findings?:readonly GateFinding[];
 reason?:string;predecessorCommit?:string
}):FinalNoGoBundle{
 const findings=input.findings??defaultNoGoFindings();
 assertGateFindings(findings);
 const commit=input.predecessorCommit??M12_PREDECESSOR_COMMIT;
 if(!sha40.test(commit)||commit!==M12_PREDECESSOR_COMMIT||
  !/^0x[0-9a-f]{40}$/.test(input.operatorWallet))
  throw new ApiError(409,"Final release assessment must be bound to exact M11 Testnet draft and wallet");
 const reason=input.reason||"External sources, human security approvals and Testnet wallet acceptance remain unverified.";
 if(reason.length<12||reason.length>600)throw new ApiError(400,"Explicit NO-GO reason required");
 const index=new Map(findings.map(item=>[item.gate,item]));
 return {milestone:12,chainId:18881,decision:"NO_GO",predecessorCommit:commit,
  operatorWallet:input.operatorWallet,allEarlierPRsRemainDraft:true,
  acceptanceGates:M11_GATES.map(gate=>index.get(gate)!),
  humanReleaseApproved:false,independentlyApproved:false,
  financialExecutionEnabled:false,mainnetEnabled:false,
  publicBetaEnabled:false,reason};
}
export function hashFinalBundle(bundle:FinalNoGoBundle):string{
 if(bundle.decision!=="NO_GO"||bundle.financialExecutionEnabled||
  bundle.humanReleaseApproved||bundle.independentlyApproved||
  bundle.mainnetEnabled||bundle.publicBetaEnabled||
  bundle.milestone!==12||bundle.chainId!==18881)
  throw new ApiError(409,"Cannot attest an automatically approved M12 release");
 assertGateFindings(bundle.acceptanceGates);
 return sha256(JSON.stringify(bundle));
}
export async function currentNoGoAssessment(wallet:string):Promise<{
 bundle:FinalNoGoBundle;sha256:string;m11UnverifiedCandidates:number
}>{
 requireAcceptanceOperator(wallet);
 const count=await getDb().query<{count:string}>(
  "SELECT count(*)::text AS count FROM nft_m11_evidence_candidates");
 const findings=defaultNoGoFindings();
 const candidates=await getDb().query<{gate:M11Gate;count:string}>(
  "SELECT gate,count(*)::text AS count FROM nft_m11_evidence_candidates GROUP BY gate");
 for(const row of candidates.rows){
  const gate=findings.find(g=>g.gate===row.gate);
  if(gate){gate.state="candidate_unverified";gate.blocker=
   "Received "+row.count+" signed evidence candidate(s), but independent sources, human findings and release verification remain incomplete. " + blockers[row.gate];
   if(gate.blocker.length>500)gate.blocker=gate.blocker.slice(0,500);
  }
 }
 const bundle=makeFinalNoGoBundle({operatorWallet:wallet.toLowerCase(),findings});
 return {bundle,sha256:hashFinalBundle(bundle),
  m11UnverifiedCandidates:Number(count.rows[0].count)};
}
export async function persistNoGoAssessment(wallet:string){
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
  process.env.M12_OPERATOR_RECORD_NO_GO!=="true")
  throw new ApiError(503,"M12 final review recording is disabled without operator authorisation");
 requireAcceptanceOperator(wallet,true);
 const snapshot=await currentNoGoAssessment(wallet);
 const result=await inTransaction(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(18881,1200)");
  const id=randomUUID();
  const inserted=await db.query<{id:string}>(`INSERT INTO nft_m12_final_reviews(
   id,source_commit,operator_wallet,evidence_bundle_sha256,decision,
   review_kind,reason) VALUES($1,$2,$3,$4,'NO_GO','operator_unverified',$5)
   ON CONFLICT DO NOTHING RETURNING id`,[
    id,M12_PREDECESSOR_COMMIT,wallet.toLowerCase(),snapshot.sha256,
    snapshot.bundle.reason
   ]);
  if(inserted.rowCount!==1)throw new ApiError(409,"Identical NO-GO review already recorded; do not replay");
  for(const f of snapshot.bundle.acceptanceGates){
   await db.query(`INSERT INTO nft_m12_gate_observations(
    review_id,gate,observed_state,blocker,source_sha256)
    VALUES($1,$2,$3,$4,$5)`,[id,f.gate,f.state,f.blocker,f.sourceSha256]);
  }
  return {id,decision:"NO_GO" as const,sha256:snapshot.sha256,
   status:"operator_unverified",sourceProofsApproved:false,humanApproval:false};
 });
 return result;
}
export async function getRecentNoGoReviews(limit=8){
 if(!Number.isInteger(limit)||limit<1||limit>20)throw new ApiError(400,"Invalid review limit");
 const rows=await getDb().query(
  `SELECT id,source_commit,operator_wallet,evidence_bundle_sha256,
    decision,review_kind,reason,human_release_approved,
    independent_source_approved,execution_authorised,created_at
   FROM nft_m12_final_reviews ORDER BY created_at DESC LIMIT $1`,[limit]);
 return rows.rows;
}
