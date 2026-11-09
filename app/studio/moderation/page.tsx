"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import { useWalletSession } from "@/components/WalletSessionProvider";

type QueueItem={
 id:string;owner_wallet:string;media_kind:string;mime_type:string;
 byte_length:number;sha256:string;state:string;scan_engine:string;
 scan_checked_at:string;scan_evidence_sha256:string;
 provider_asset_id:string;provider_public_id:string;created_at:string;
};
export default function ModerationPage(){
 const wallet=useWalletSession();
 const [queue,setQueue]=useState<QueueItem[]>([]);
 const [reason,setReason]=useState<Record<string,string>>({});
 const [error,setError]=useState<string|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const signedIn=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
 async function refresh(){
  if(!signedIn){setQueue([]);return;}
  try{
   const r=await fetch("/api/media/moderation",{cache:"no-store"});
   const data=await r.json() as {queue?:QueueItem[];error?:string};
   if(!r.ok)throw new Error(data.error||"Moderator authorisation unavailable");
   setQueue(data.queue||[]);setError(null);
  }catch(e){setQueue([]);setError(e instanceof Error?e.message:"Moderator service unavailable");}
 }
 useEffect(()=>{void refresh();},[signedIn,wallet.address,wallet.chainId]);
 async function decide(id:string,decision:"approved"|"rejected"){
  setBusy(true);setError(null);setMessage("");
  try {
   const r=await fetch("/api/media/moderation",{
    method:"POST",headers:{"Content-Type":"application/json"},
    credentials:"same-origin",body:JSON.stringify({assetId:id,decision,reason:reason[id]||""})
   });
   const response=await r.json() as {error?:string};
   if(!r.ok)throw new Error(response.error||"Moderation decision failed");
   setMessage("Recorded authenticated moderator decision for "+id+". No media was automatically published.");
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Decision unavailable");}
  finally{setBusy(false);}
 }
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / TRUST & SAFETY / ULTRA EVM TESTNET</p>
  <h1>Private media review.</h1>
  <p className="interior-copy">
   Moderator access requires an authenticated wallet explicitly approved by an operator.
   Inspect the original authenticated asset in the private Cloudinary console and document
   actual human safety evidence. Scanner results do not replace human content moderation.
  </p>
  <div className="index-warning">No public previews or hosted media links are exposed from the moderation queue. Approval records the moderator wallet and evidence; it does not independently prove a security audit.</div>
  {error&&<p role="alert" className="index-warning">{error}</p>}
  {message&&<p role="status" className="index-warning">{message}</p>}
  <button className="secondary-link" disabled={!signedIn||busy} onClick={()=>void refresh()}>Refresh private queue</button>
  {queue.length?<div className="studio-assets">{queue.map(asset=><article className="creator-preflight" key={asset.id}>
   <h2>{asset.media_kind.toUpperCase()} · Pending review</h2>
   <dl>
    <div><dt>Asset UUID</dt><dd>{asset.id}</dd></div>
    <div><dt>Creator wallet</dt><dd>{asset.owner_wallet}</dd></div>
    <div><dt>Mime / bytes</dt><dd>{asset.mime_type} · {asset.byte_length}</dd></div>
    <div><dt>SHA-256</dt><dd>{asset.sha256}</dd></div>
    <div><dt>Scanner</dt><dd>{asset.scan_engine} · {asset.scan_checked_at}</dd></div>
    <div><dt>Cloudinary asset ID (private)</dt><dd>{asset.provider_asset_id}</dd></div>
    <div><dt>Cloudinary public ID (not a public delivery URL)</dt><dd>{asset.provider_public_id}</dd></div>
   </dl>
   <label>Human reviewer evidence and reasons
    <textarea rows={3} value={reason[asset.id]||""}
      onChange={e=>setReason(prev=>({...prev,[asset.id]:e.target.value}))}
      placeholder="Reference the actual private asset review and the safety decision"/>
   </label>
   <div className="studio-action-row">
    <button className="secondary-link" disabled={busy||(reason[asset.id]||"").trim().length<15}
      onClick={()=>void decide(asset.id,"rejected")}>Reject asset</button>
    <button className="primary-link" disabled={busy||(reason[asset.id]||"").trim().length<15}
      onClick={()=>void decide(asset.id,"approved")}>Record approval</button>
   </div>
  </article>)}</div>:
  <p className="wallet-note">No reviewer-visible pending assets, or this wallet has no access. No synthetic queue items are created.</p>}
  <p><Link href="/studio">Back to creator studio</Link></p>
 </section>;
}
