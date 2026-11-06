"use client";

import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { useWalletSession } from "@/components/WalletSessionProvider";

type Asset={
 id:string;media_kind:"image"|"video";mime_type:string;byte_length:number;
 state:string;sha256:string;scan_result:string|null;pin_state:string;
 media_ipfs_cid:string|null;ipfs_verified_at:string|null;
 created_at:string;reviewed_at:string|null
};
type Version={
 id:string;collection_address:string;token_standard:string;token_id:string;
 version:number;asset_id:string;metadata:unknown;metadata_sha256:string;
 state:string;ipfs_cid:string|null;chain_uri:string|null;created_at:string
};
type AssetsResponse={assets?:Asset[];uploadsEnabled?:boolean;pinningEnabled?:boolean;error?:string};
type MetadataResponse={records?:Version[];error?:string};

export default function StudioPage(){
 const wallet=useWalletSession();
 const [assets,setAssets]=useState<Asset[]>([]);
 const [versions,setVersions]=useState<Version[]>([]);
 const [uploadEnabled,setUploadEnabled]=useState(false);
 const [pinEnabled,setPinEnabled]=useState(false);
 const [uploadFile,setUploadFile]=useState<File|null>(null);
 const [pinFile,setPinFile]=useState<File|null>(null);
 const [chosenAsset,setChosenAsset]=useState("");
 const [collection,setCollection]=useState("");
 const [tokenId,setTokenId]=useState("1");
 const [title,setTitle]=useState("");
 const [description,setDescription]=useState("");
 const [traits,setTraits]=useState("[]");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const signedIn=Boolean(wallet.address&&wallet.authenticated&&wallet.chainId===18881);
 async function readJson(response:Response):Promise<Record<string,unknown>>{
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof data.error==="string"?data.error:"Service unavailable");
  return data;
 }
 async function refresh(){
  if(!signedIn){setAssets([]);setVersions([]);return;}
  try {
   const [a,m]=await Promise.all([
    fetch("/api/media/assets",{cache:"no-store"}).then(readJson),
    fetch("/api/media/metadata",{cache:"no-store"}).then(readJson)
   ]);
   setAssets((a.assets as Asset[])||[]);
   setVersions((m.records as Version[])||[]);
   setUploadEnabled(Boolean(a.uploadsEnabled));
   setPinEnabled(Boolean(a.pinningEnabled));
   setError(null);
  }catch(e){setError(e instanceof Error?e.message:"Creator service unavailable");}
 }
 useEffect(()=>{void refresh();},[signedIn,wallet.address,wallet.chainId]);
 async function run(work:()=>Promise<string>){
  setBusy(true);setMessage("");setError(null);
  try{setMessage(await work());await refresh();}
  catch(e){setError(e instanceof Error?e.message:"Operation unavailable");}
  finally{setBusy(false);}
 }
 async function sendJson(path:string,body:object){
  return readJson(await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},
   credentials:"same-origin",body:JSON.stringify(body)}));
 }
 function upload(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!uploadFile||!signedIn)return;
  void run(async()=>{
   const form=new FormData();form.append("file",uploadFile);
   const result=await readJson(await fetch("/api/media/assets",{
    method:"POST",body:form,credentials:"same-origin"
   }));
   setUploadFile(null);
   return "Authenticated upload received in private quarantine. Moderator review is still required. Asset: "+(result.asset as Asset)?.id;
  });
 }
 function pin(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!chosenAsset||!pinFile||!signedIn)return;
  void run(async()=>{
   const form=new FormData();form.append("assetId",chosenAsset);form.append("file",pinFile);
   const result=await readJson(await fetch("/api/media/assets/pin",{
    method:"POST",credentials:"same-origin",body:form
   }));
   setPinFile(null);
   return "Approved asset CID independently hash-checked: "+String(result.ipfsUri);
  });
 }
 function makeMetadata(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!signedIn||!chosenAsset)return;
  void run(async()=>{
   let attributes:unknown;
   try{attributes=JSON.parse(traits);}catch{throw new Error("Traits must be a JSON array");}
   const result=await sendJson("/api/media/metadata",{
    assetId:chosenAsset,collection,tokenId,name:title,description,attributes
   });
   return "Immutable metadata draft created; not yet pinned or matched to a real tokenURI. Version "+String((result.record as Version)?.version);
  });
 }
 const available=assets.filter(a=>a.state==="approved"&&a.ipfs_verified_at&&a.media_ipfs_cid);
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / ULTRA EVM TESTNET / CREATOR ASSETS</p>
  <h1>Creator media studio.</h1>
  <p className="interior-copy">
   Wallet-scoped media storage and NFT metadata. Private authenticated uploads require a real malware scanner and Cloudinary credentials, then separate human moderation. NFT sales and live minting remain disabled.
  </p>
  {!signedIn&&<p className="index-warning">Connect and sign in with an Ultra EVM Testnet wallet before using creator storage.</p>}
  {error&&<p role="alert" className="index-warning">{error}</p>}
  {message&&<p role="status" className="index-warning">{message}</p>}
  <div className="studio-grid">
   <form className="creator-form" onSubmit={upload}>
    <h2>1. Secure private upload</h2>
    <p className="wallet-note">PNG, JPEG, WebP up to 5 MiB; MP4/WebM up to 10 MiB. Executables, SVG, PDF and unknown formats are rejected. Images and video stay private pending actual moderator review.</p>
    <label htmlFor="asset-upload">Choose artwork or video</label>
    <input id="asset-upload" type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.webm" disabled={!signedIn||busy}
     onChange={e=>setUploadFile(e.target.files?.[0]||null)}/>
    <button className="primary-link" disabled={!signedIn||busy||!uploadEnabled||!uploadFile}>
     {busy?"Processing…":uploadEnabled?"Upload privately":"Upload gated by operator"}
    </button>
   </form>
   <form className="creator-form" onSubmit={pin}>
    <h2>2. Pin approved media</h2>
    <p className="wallet-note">After human approval, reselect the exact original file. The server verifies its checksum, scans again and independently checks pinned IPFS bytes.</p>
    <label htmlFor="approved-media">Approved media</label>
    <select id="approved-media" value={chosenAsset} onChange={e=>setChosenAsset(e.target.value)} disabled={!signedIn||busy}>
     <option value="">Choose your approved asset</option>
     {assets.filter(a=>a.state==="approved").map(a=><option value={a.id} key={a.id}>{a.id.slice(0,8)} · {a.media_kind} · {a.pin_state||"pending"}</option>)}
    </select>
    <label htmlFor="asset-repin">Reselect the original bytes</label>
    <input id="asset-repin" type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.webm" disabled={!signedIn||busy}
     onChange={e=>setPinFile(e.target.files?.[0]||null)}/>
    <button className="primary-link" disabled={!signedIn||busy||!pinEnabled||!pinFile||!chosenAsset}>Pin after approval</button>
   </form>
  </div>
  <section className="creator-preflight">
   <div className="studio-header"><h2>My private media</h2><button type="button" className="secondary-link" disabled={busy||!signedIn} onClick={()=>void refresh()}>Refresh</button></div>
   {assets.length? <div className="studio-assets">{assets.map(a=><article className="studio-asset" key={a.id}>
     <span aria-hidden="true" className="studio-media-icon">{a.media_kind==="image"?"◇":"▷"}</span>
     <div><strong>{a.media_kind.toUpperCase()} · {a.state.replaceAll("_"," ")}</strong>
      <p>{a.id} · {(a.byte_length/1024/1024).toFixed(2)} MiB</p>
      <p>Malware: {a.scan_result||"not proven"} · IPFS: {a.ipfs_verified_at?"Gateway hash checked":"not verified"}</p>
      {a.ipfs_verified_at&&a.media_ipfs_cid&&<p>ipfs://{a.media_ipfs_cid}</p>}
     </div>
    </article>)}</div> :
    <p className="wallet-note">No authorised uploaded assets are evidenced for this wallet. Demo artwork is not inserted.</p>}
  </section>
  <section className="creator-preflight">
   <h2>3. Metadata versions for real NFT collections</h2>
   <p className="wallet-note">Only media with a human approval and independently verified IPFS checksum can be referenced. Collection ownership is read from the real Ultra EVM Testnet contract; saving a draft does not mint or update an NFT.</p>
   <form className="creator-form creator-form-inline" onSubmit={makeMetadata}>
     <div className="creator-form-grid">
      <label className="creator-wide">Collection address <input placeholder="0x..." value={collection} onChange={e=>setCollection(e.target.value)}/></label>
      <label>Token ID<input inputMode="numeric" value={tokenId} onChange={e=>setTokenId(e.target.value)}/></label>
      <label>Media
       <select value={chosenAsset} onChange={e=>setChosenAsset(e.target.value)}>
        <option value="">Approved + verified media required</option>
        {available.map(a=><option key={a.id} value={a.id}>{a.id.slice(0,8)} · {a.media_kind}</option>)}
       </select>
      </label>
      <label>Title<input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Description<input maxLength={1200} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label className="creator-wide">Traits JSON array
       <textarea rows={3} value={traits} onChange={e=>setTraits(e.target.value)} placeholder={'[{"trait_type":"Type","value":"Art"}]'}/>
      </label>
     </div>
     <button className="primary-link" disabled={!signedIn||busy||!available.some(a=>a.id===chosenAsset)}>Save versioned metadata draft</button>
   </form>
   <h2>My metadata evidence</h2>
   {versions.length?<div className="studio-assets">{versions.map(v=><article key={v.id} className="studio-asset">
    <div><strong>Token #{v.token_id} · Version {v.version} · {v.state}</strong>
     <p>Collection {v.collection_address}</p>
     <p>SHA-256 {v.metadata_sha256.slice(0,20)}… {v.ipfs_cid?"· ipfs://"+v.ipfs_cid:"· Not pinned"}</p>
     {v.state==="draft"&&<button className="secondary-link" type="button" disabled={!pinEnabled||busy}
       onClick={()=>void run(async()=>{await sendJson("/api/media/metadata/pin",{id:v.id});return "Pinned metadata bytes verified against independent IPFS gateway";})}>Pin metadata</button>}
     {v.state==="pinned"&&<button className="secondary-link" type="button" disabled={busy}
       onClick={()=>void run(async()=>{await sendJson("/api/media/metadata/reconcile",{id:v.id});return "Primary RPC tokenURI matched. Independent on-chain evidence remains outstanding.";})}>Check on-chain tokenURI (read-only)</button>}
    </div>
   </article>)}</div>:<p className="wallet-note">No persisted metadata versions. No fabricated NFTs or on-chain metadata appear.</p>}
  </section>
  <p className="wallet-note"><Link href="/studio/moderation">Authorised moderation workspace</Link> · <Link href="/create">Collection creator</Link> · <Link href="/explore">Read-only Testnet collection index</Link></p>
 </section>;
}
