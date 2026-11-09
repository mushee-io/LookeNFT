"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useWalletSession} from "@/components/WalletSessionProvider";
type Gate={gate:string;state:"blocked"|"source_unavailable"|"candidate_unverified";
 blocker:string;sourceSha256:string|null};
type Bundle={decision:"NO_GO";predecessorCommit:string;acceptanceGates:Gate[];
 humanReleaseApproved:false;independentlyApproved:false;financialExecutionEnabled:false;
 mainnetEnabled:false;publicBetaEnabled:false;reason:string};
type Review={id:string;created_at:string;evidence_bundle_sha256:string;
 decision:"NO_GO";review_kind:string;reason:string};
type Report={stage:string;bundle:Bundle;sha256:string;releaseDecision:"NO_GO";
 m11UnverifiedCandidates:number;recentNoGoReviews:Review[];warning:string;error?:string};
const labels:Record<string,string>={
 looke_m2_issuer:"Looke Social M2 identity issuer",
 looke_m10_issuer:"Looke Social signed profiles and posts",
 social_revocation:"Signed account suspension and revocation",
 blocked_viewer_policy:"Viewer-specific block/mute visibility",
 reown_mobile:"Reown mobile wallet acceptance",
 reown_desktop:"Reown Windows/desktop wallet acceptance",
 operator_postgres_restore:"Operator PostgreSQL restore",
 protected_rollback:"Protected deployment/database rollback",
 cloudinary_delivery:"Real Cloudinary image and video evidence",
 clamav_scan:"Real ClamAV malicious-file scan",
 pinata_cid:"Pinata IPFS content/CID pin",
 human_moderation:"Human social and NFT media moderation",
 approved_nft_registry:"Approved Ultra Testnet NFT registry",
 independent_rpc:"Two independent Ultra Testnet RPC sources",
 blockscout:"Blockscout canonical block/receipt agreement",
 cancun_mcopy_push0:"Live Testnet Cancun MCOPY/PUSH0 proof",
 contract_security_audit:"Independent security audit and remediation",
 human_operator_review:"Independent signed human release review"
};
export default function FinalAcceptancePage(){
 const wallet=useWalletSession();
 const [report,setReport]=useState<Report|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [reload,setReload]=useState(0);
 const [signed,setSigned]=useState("");
 const [role,setRole]=useState<"security_reviewer"|"release_operator">("security_reviewer");
 const authed=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
 useEffect(()=>{
  setError(null);setReport(null);
  if(!authed)return;
  const ac=new AbortController();
  fetch("/api/final-acceptance",{signal:ac.signal,cache:"no-store"})
  .then(async response=>{
   const data=await response.json() as Report;
   if(!response.ok)throw Error(data.error||"Operator M12 verification unavailable");
   return data;
  }).then(data=>{if(!ac.signal.aborted)setReport(data);})
    .catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:"No source verified");});
  return ()=>ac.abort();
 },[authed,wallet.address,wallet.chainId,reload]);
 async function recordNoGo(){
  if(!authed||busy)return;
  setBusy(true);setError(null);
  try{
   const res=await fetch("/api/final-acceptance",{
    method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
    body:JSON.stringify({decision:"NO_GO"})
   });
   const value=await res.json() as {id?:string;error?:string};
   if(!res.ok)throw Error(value.error||"NO-GO record could not be stored");
   setMessage("Explicit NO_GO review recorded: "+value.id+". No release, external audit or real trading was authorised.");
   setReload(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:"Review unavailable");}
  finally{setBusy(false);}
 }
 async function submitHumanCandidate(){
  if(!authed||!signed||busy)return;
  setBusy(true);setError(null);
  const jwt=signed;setSigned("");
  try{
   const res=await fetch("/api/final-acceptance/human",{
    method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
    body:JSON.stringify({role,assertion:jwt})
   });
   const value=await res.json() as {id?:string;error?:string};
   if(!res.ok)throw Error(value.error||"Human signed candidate rejected");
   setMessage("Separate "+role+" signature saved as SOURCE-UNVERIFIED candidate "+value.id+
    ". Final release remains NO_GO.");
   setReload(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:"Reviewer unavailable");}
  finally{setBusy(false);}
 }
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / M12 FINAL / ULTRA EVM TESTNET 18881</p>
  <h1>Final Testnet acceptance.</h1>
  <p className="interior-copy">Milestone 12 closes the engineering sequence with an evidence-backed NO-GO. Real wallets, Looke Social issuer, media providers, canonical NFT receipts, protected restore and human security reviews must be independently supplied before anyone can consider a separate authorised release.</p>
  <p role="status" className="index-warning"><strong>FINAL DECISION: NO_GO.</strong> M1–M12 work remains in draft; public beta, mainnet, UOS escrow, minting and trading are disabled. Passing CI cannot change this status.</p>
  {!authed&&<p className="wallet-note">Only an explicitly allowed operator wallet authenticated on Ultra Testnet can inspect or record review evidence. No transaction signing is requested.</p>}
  {error&&<p role="alert" className="index-warning">{error}</p>}
  {message&&<p role="status" className="wallet-note">{message}</p>}
  {report&&<section className="creator-preflight">
   <h2>Immutable NO-GO assessment</h2>
   <p>{report.warning}</p>
   <p><strong>{report.bundle.acceptanceGates.length} external gates</strong> · {report.m11UnverifiedCandidates} previously submitted unverified evidence candidates · 0 independent approvals · 0 human release approvals</p>
   <p>Review hash: <code>{report.sha256}</code></p>
   <div className="studio-assets">
    {report.bundle.acceptanceGates.map(g=><article className="studio-asset" key={g.gate}>
     <strong>{labels[g.gate]||g.gate}</strong>
     <p>{g.blocker}</p><p>{g.state==="candidate_unverified"?
      "Submitted evidence exists, still NOT APPROVED":"BLOCKED / NO VERIFIED SOURCE"}</p>
    </article>)}
   </div>
   <div className="studio-action-row">
    <button type="button" className="secondary-link" disabled={!authed||busy} onClick={()=>void recordNoGo()}>Record this exact NO_GO snapshot (operator only)</button>
    <button type="button" className="secondary-link" disabled={!authed||busy} onClick={()=>setReload(n=>n+1)}>Refresh independent evidence inventory</button>
   </div>
   {report.recentNoGoReviews.length>0&&<div>
    <h2>Stored NO-GO operator reviews</h2>
    {report.recentNoGoReviews.map(r=><p key={r.id} className="wallet-note">
     {r.decision} · {new Date(r.created_at).toLocaleString()} · Review {r.id} · {r.review_kind}</p>)}
   </div>}
  </section>}
  <section className="creator-preflight">
   <h2>Separate signed human-review inputs</h2>
   <p className="wallet-note">A real independent security reviewer and an independent release operator must each use a different trusted Ed25519 key, issuer and wallet. A valid signature is still only a candidate, not proof the security review or Testnet launch happened. GO proposals never enable execution.</p>
   <label>Reviewer role
    <select value={role} onChange={e=>setRole(e.target.value as typeof role)}>
     <option value="security_reviewer">Independent security reviewer</option>
     <option value="release_operator">Independent release operator</option>
    </select>
   </label>
   <label>Externally issued, short-lived EdDSA JWT for an existing NO-GO review
    <textarea rows={3} maxLength={12000} value={signed} onChange={e=>setSigned(e.target.value)}
      autoComplete="off" spellCheck={false} placeholder="Signed JWT only; never share private keys or recovery phrases"/>
   </label>
   <button type="button" className="secondary-link" disabled={!authed||busy||!signed}
    onClick={()=>void submitHumanCandidate()}>Record as signature-valid but source-UNVERIFIED</button>
  </section>
  <p className="wallet-note">M12 is the final milestone—not an automatic Testnet or mainnet launch. <Link href="/acceptance">M11 operator evidence</Link> · <Link href="/social-link">Looke Social bridge</Link> · <Link href="/market/operations">Read-only market</Link></p>
 </section>;
}
