"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperatorCreateNav from "@/components/OperatorCreateNav";
import { useWalletSession } from "@/components/WalletSessionProvider";

type Drop={
 address:string;standard:"erc721"|"erc1155";title:string;description:string;
 coverUrl:string|null;creatorWallet:string;status:"draft"|"published";
 mintAvailable:boolean;publishedAt:string|null
};
type Result={collections?:Drop[];error?:string;catalogueReady?:boolean};

export default function ExplorePage(){
  const wallet=useWalletSession();
  const [collections,setCollections]=useState<Drop[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [catalogueReady,setCatalogueReady]=useState(true);
  const [search,setSearch]=useState("");
  const [deleteTarget,setDeleteTarget]=useState<Drop|null>(null);
  const [deleteConfirmation,setDeleteConfirmation]=useState("");
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState<string|null>(null);
  const [deleteSuccess,setDeleteSuccess]=useState<string|null>(null);
  useEffect(()=>{
    const ctl=new AbortController();
    fetch("/api/curated",{signal:ctl.signal,cache:"no-store"})
      .then(async r=>{const data=await r.json() as Result;if(!r.ok)throw new Error(data.error||"Curated catalogue unavailable");return data;})
      .then(data=>{if(!ctl.signal.aborted)setCollections(data.collections||[]);setCatalogueReady(data.catalogueReady!==false);})
      .catch(e=>{if(!ctl.signal.aborted)setError(e instanceof Error?e.message:"Unable to load collections");})
      .finally(()=>{if(!ctl.signal.aborted)setLoading(false);});
    return ()=>ctl.abort();
  },[]);
  const shown=useMemo(()=>collections.filter(x=>x.title.toLowerCase().includes(search.toLowerCase())),[collections,search]);
  function openDelete(drop:Drop){
    setDeleteTarget(drop);setDeleteConfirmation("");setDeleteError(null);setDeleteSuccess(null);
  }
  function closeDelete(){
    if(deleteBusy)return;
    setDeleteTarget(null);setDeleteConfirmation("");setDeleteError(null);
  }
  async function removeCollection(){
    if(!deleteTarget||deleteBusy)return;
    if(wallet.chainId!==18881||!wallet.authenticated||!wallet.address){
      setDeleteError("Connect and sign in with the Ultra EVM Testnet collection-owner wallet first.");
      return;
    }
    if(deleteConfirmation!=="DELETE "+deleteTarget.title){
      setDeleteError("Type DELETE "+deleteTarget.title+" to confirm this action.");
      return;
    }
    setDeleteBusy(true);setDeleteError(null);
    try {
      // The API independently verifies the authenticated wallet against
      // the current on-chain owner. Client-side address checks are not authorization.
      const response=await fetch("/api/creator/collections/"+encodeURIComponent(deleteTarget.address),{
        method:"DELETE",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({confirm:deleteTarget.address.toLowerCase()})
      });
      const result=await response.json() as {error?:string;removedFromLookeNFT?:boolean};
      if(!response.ok||result.removedFromLookeNFT!==true)
        throw new Error(result.error||"Collection could not be removed.");
      setCollections(old=>old.filter(item=>item.address.toLowerCase()!==deleteTarget.address.toLowerCase()));
      setDeleteSuccess(deleteTarget.title+" removed from LookeNFT Explore. Its NFT contract and tokens still exist on Ultra EVM Testnet.");
      setDeleteTarget(null);setDeleteConfirmation("");
    }catch(e){
      setDeleteError(e instanceof Error?e.message:"Unable to remove the collection.");
    }finally{setDeleteBusy(false);}
  }
  return <section className="curated-page">
    <div className="curated-hero">
      <p className="curated-chip">NFT MARKETPLACE · ULTRA EVM TESTNET</p>
      <h1>Discover <span>LookeNFT</span> collections.</h1>
      <p>Browse community-created, on-chain-verified Testnet collections. Listings are not endorsements or audits. Minting requires separate on-chain activation.</p>
    </div>
    <div className="curated-heading"><div><p className="curated-overline">TESTNET COLLECTIONS</p><h2>Explore drops</h2></div><div className="curated-heading-actions"><OperatorCreateNav /><span className="curated-count">{loading?"Loading":collections.length+" published"}</span></div></div>
    {deleteSuccess&&<p role="status" className="operator-note">{deleteSuccess}</p>}
    {collections.length>0&&<label className="curated-search-label">Search collections<input aria-label="Search Testnet NFT collections" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by collection name" /></label>}
    {loading?<div className="curated-empty" role="status">Loading official drops…</div>
      :error?<div className="curated-empty" role="alert">Unable to verify published collections right now. {error}</div>
      :shown.length?<div className="curated-grid">{shown.map(drop=><div className="curated-card-shell" key={drop.address}>
        <Link href={"/collection/"+drop.address} className="curated-card">
          <div className="curated-cover">{drop.coverUrl?<img src={drop.coverUrl} alt={drop.title+" collection cover"} />:<div className="curated-no-cover" aria-label="Collection cover not provided"><span>◇</span><small>Testnet collection</small></div>}</div>
          <div className="curated-card-body"><div className="curated-card-title"><h3>{drop.title}</h3><span className="curated-verified" aria-label="Verified Testnet deployment">◇</span></div>
          <p>{drop.description||"Creator-owned collection on Ultra EVM Testnet."}</p>
          <div className="curated-card-bottom"><span>{drop.standard.toUpperCase()} · Testnet</span><strong>{drop.mintAvailable?"Mint open":"Preview"}</strong></div></div>
        </Link>
        <div className="curated-card-controls">
          <span>Testnet · owner only</span>
          <button type="button" className="curated-card-delete" aria-label={"Delete "+drop.title+" collection from LookeNFT"} onClick={()=>openDelete(drop)}>Delete collection</button>
        </div>
      </div>)}</div>:
      <div className="curated-empty"><div className="curated-empty-icon">◇</div><h3>{search?"No matching drops":catalogueReady?"No public NFT drops yet":"Official drops are coming"}</h3><p>{search?"Try another collection name.":"Verified creator-owned collections will appear here after Testnet deployment. No placeholder collections are shown."}</p></div>}
    {deleteTarget&&<div className="curated-delete-overlay" role="presentation">
      <div className="curated-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="testnet-delete-title" aria-describedby="testnet-delete-description">
        <h2 id="testnet-delete-title">Delete {deleteTarget.title} from LookeNFT?</h2>
        <p id="testnet-delete-description">This Testnet-only action removes the collection from public Explore and its gallery. It does <strong>not</strong> burn NFTs, destroy the on-chain contract, revoke anyone's ownership, or stop an existing mint phase. You can restore the collection later from its direct URL.</p>
        <p className="curated-delete-address">Contract: {deleteTarget.address}</p>
        {!wallet.address||wallet.chainId!==18881?
          <p className="operator-note">Connect the collection owner's Ultra EVM Testnet wallet using the site header to proceed.</p>:
          !wallet.authenticated?<div className="curated-delete-signin"><p>Sign in with the collection-owner wallet to unlock deletion.</p>
            <button type="button" disabled={wallet.pending||deleteBusy} onClick={()=>void wallet.signIn()}>{wallet.pending?"Waiting for wallet…":"Sign in with owner wallet"}</button>
          </div>:<p className="operator-note">Signed in: {wallet.address}. LookeNFT will verify this is the current on-chain collection owner.</p>}
        <label>Type <strong>DELETE {deleteTarget.title}</strong> to confirm
          <input autoFocus autoComplete="off" value={deleteConfirmation} onChange={e=>setDeleteConfirmation(e.target.value)} disabled={deleteBusy} aria-label="Confirm Testnet collection deletion" />
        </label>
        {deleteError&&<p role="alert" className="operator-error">{deleteError}</p>}
        <div className="curated-delete-actions">
          <button type="button" className="creator-secondary" disabled={deleteBusy} onClick={closeDelete}>Cancel</button>
          <button type="button" className="creator-delete-button" disabled={deleteBusy||!wallet.authenticated||wallet.chainId!==18881||deleteConfirmation!=="DELETE "+deleteTarget.title} onClick={()=>void removeCollection()}>
            {deleteBusy?"Removing…":"Delete from LookeNFT"}
          </button>
        </div>
      </div>
    </div>}
  </section>;
}
