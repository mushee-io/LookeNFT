"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useWalletSession} from "@/components/WalletSessionProvider";
type Gate={gate:string;candidates:number;state:string;approved:false};
type Report={chainId:number;releaseDecision:"NO_GO";financialExecutionEnabled:false;
 humanReviewPassed:false;independentSourcePassed:false;m12IsFinalMilestone:true;
 gates:Gate[];localDatabaseObservations:{
 revokedSocialWallets:string;nonExpiredCanonicalAvatarSnapshots:string;
 unverifiedMediaWitnessCandidates:string;nonExpiredLinkedSocialSnapshots:string};
 warning:string};
const labels:Record<string,string>={
 looke_m2_issuer:"Portable M2 wallet identity issuer",
 looke_m10_issuer:"Signed moderated Looke Social issuer",
 social_revocation:"Cross-product account suspension / revocation",
 blocked_viewer_policy:"Signed viewer-specific block/mute policy",
 reown_mobile:"Mobile Reown / real wallet acceptance",
 reown_desktop:"Windows/desktop Reown acceptance",
 operator_postgres_restore:"Operator PostgreSQL full restore evidence",
 protected_rollback:"Production rollback and recovery rehearsal",
 cloudinary_delivery:"Authenticated Cloudinary hosted asset source",
 clamav_scan:"Independent ClamAV malware scan logs",
 pinata_cid:"Pinata IPFS CID and content integrity",
 human_moderation:"Human moderator approval and suspension",
 approved_nft_registry:"Genuine approved Ultra Testnet NFT registry",
 independent_rpc:"Second independent RPC and canonical receipts",
 blockscout:"Official Blockscout independent 404 resolution",
 cancun_mcopy_push0:"Real Ultra EVM Cancun opcode acceptance",
 contract_security_audit:"Independent contract security review",
 human_operator_review:"Signed human operator release decision"
};
export default function AcceptancePage(){
 const wallet=useWalletSession();
 const [report,setReport]=useState<Report|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [assertion,setAssertion]=useState("");
 const [message,setMessage]=useState("");
 const [count,setCount]=useState(0);
 const authenticated=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
 useEffect(()=>{
  setReport(null);setError(null);
  if(!authenticated)return;
  const ac=new AbortController();setLoading(true);
  fetch("/api/acceptance",{cache:"no-store",signal:ac.signal})
   .then(async r=>{const body=await r.json();
    if(!r.ok)throw Error(body.error||"Operator acceptance not configured");
    return body as Report;})
   .then(data=>{if(!ac.signal.aborted)setReport(data);})
   .catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:"Unavailable");})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false);});
  return ()=>ac.abort();
 },[authenticated,wallet.address,wallet.chainId,count]);
 async function submitCandidate(){
  if(!authenticated||!assertion)return;
  setLoading(true);setError(null);setMessage("");
  try{
   const token=assertion;setAssertion("");
   const r=await fetch("/api/acceptance",{
    method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({assertion:token})
   });
   const body=await r.json() as {status?:string;gate?:string;error?:string};
   if(!r.ok)throw Error(body.error||"Reviewer assertion rejected");
   if(body.status!=="submitted_unverified")throw Error("Unexpected evidence status");
   setMessage("Evidence candidate submitted as UNVERIFIED for "+body.gate+
    ". Human review, source integrity and real operator sign-off remain required.");
   setCount(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:"Source rejected");}
  finally{setLoading(false);}
 }
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / M11 SECURITY ACCEPTANCE / ULTRA EVM TESTNET</p>
  <h1>Release evidence, not approvals.</h1>
  <p className="interior-copy">A fail-closed operator-only checklist for real Social identity, wallet acceptance, hosted NFT media, independent Testnet witnesses and protected database rollback. M12 is the final milestone; M11 cannot approve deployment or trading.</p>
  <p role="status" className="index-warning">NO-GO: all previous drafts remain unmerged. M11 evidence records are always unverified. Testnet public beta, UOS escrow, trading, mainnet and token actions remain OFF.</p>
  {!authenticated&&<p className="wallet-note">Sign in on chain 18881; access is restricted to approved operator wallets. No wallet transaction required.</p>}
  {loading&&<p>Reading operator source checklist…</p>}
  {error&&<p role="alert" className="index-warning">{error}</p>}
  {report&&<section className="creator-preflight">
   <h2>Operator source evidence inventory</h2>
   <p>{report.warning}</p>
   <p><strong>Release: {report.releaseDecision}</strong> · Signed human approval: {report.humanReviewPassed?"Present":"Absent"} · Independent source: {report.independentSourcePassed?"Verified":"Unverified"}</p>
   <div className="studio-assets">{report.gates.map(item=><article className="studio-asset" key={item.gate}>
    <strong>{labels[item.gate]||item.gate}</strong>
    <p>{item.state==="submitted_unverified"?
     item.candidates+" submitted candidate(s), zero approved": "No source-backed evidence supplied"}</p>
    <p>Gate status: BLOCKED</p>
   </article>)}</div>
   <h2>Database-only observations (not acceptance proof)</h2>
   <p>Revoked social links: {report.localDatabaseObservations.revokedSocialWallets} · Current avatar checkpoints: {report.localDatabaseObservations.nonExpiredCanonicalAvatarSnapshots} · Unverified media candidates: {report.localDatabaseObservations.unverifiedMediaWitnessCandidates}</p>
  </section>}
  <section className="creator-preflight">
   <h2>Submit an independently signed candidate</h2>
   <p className="wallet-note">A separate approved reviewer must create a short-lived EdDSA JWT bound to this exact operator wallet, chain 18881, evidence gate, source SHA256 and HTTPS source. This interface does not generate signatures, access keys or approve the evidence.</p>
   <label>One-use reviewer assertion
    <textarea rows={3} value={assertion} onChange={e=>setAssertion(e.target.value)} autoComplete="off" spellCheck={false} placeholder="No issuer, audit or approval is assumed; never enter seed phrases or private keys"/>
   </label>
   <button className="secondary-link" type="button" disabled={!authenticated||!assertion||loading}
    onClick={()=>void submitCandidate()}>Record as UNVERIFIED evidence candidate</button>
   {message&&<p role="status" className="wallet-note">{message}</p>}
  </section>
  <p className="wallet-note"><Link href="/social-link">Trusted Social NFT groundwork</Link> · <Link href="/market/operations">Read-only orderbook</Link> · <Link href="/explore">Approved NFT registry</Link></p>
 </section>;
}
