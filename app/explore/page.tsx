"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperatorCreateNav from "@/components/OperatorCreateNav";

type Drop={address:string;standard:"erc721"|"erc1155";title:string;description:string;coverUrl:string|null;status:"draft"|"published";mintAvailable:boolean;publishedAt:string|null};
type Result={collections?:Drop[];error?:string;catalogueReady?:boolean};
export default function ExplorePage(){
  const [collections,setCollections]=useState<Drop[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [catalogueReady,setCatalogueReady]=useState(true);
  const [search,setSearch]=useState("");
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
  return <section className="curated-page">
    <div className="curated-hero">
      <p className="curated-chip">NFT MARKETPLACE · ULTRA EVM TESTNET</p>
      <h1>Discover <span>LookeNFT</span> collections.</h1>
      <p>Browse community-created, on-chain-verified Testnet collections. Listings are not endorsements or audits. Minting requires separate on-chain activation.</p>
    </div>
    <div className="curated-heading"><div><p className="curated-overline">TESTNET COLLECTIONS</p><h2>Explore drops</h2></div><div className="curated-heading-actions"><OperatorCreateNav /><span className="curated-count">{loading?"Loading":collections.length+" published"}</span></div></div>
    {collections.length>0&&<label className="curated-search-label">Search collections<input aria-label="Search Testnet NFT collections" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by collection name" /></label>}
    {loading?<div className="curated-empty" role="status">Loading official drops…</div>
      :error?<div className="curated-empty" role="alert">Unable to verify published collections right now. {error}</div>
      :shown.length?<div className="curated-grid">{shown.map(drop=><Link href={"/collection/"+drop.address} className="curated-card" key={drop.address}>
        <div className="curated-cover">{drop.coverUrl?<img src={drop.coverUrl} alt={drop.title+" collection cover"} />:<div className="curated-no-cover" aria-label="Collection cover not provided"><span>◇</span><small>Testnet collection</small></div>}</div>
        <div className="curated-card-body"><div className="curated-card-title"><h3>{drop.title}</h3><span className="curated-verified" aria-label="Verified Testnet deployment">◇</span></div>
        <p>{drop.description||"Creator-owned collection on Ultra EVM Testnet."}</p>
        <div className="curated-card-bottom"><span>{drop.standard.toUpperCase()} · Testnet</span><strong>{drop.mintAvailable?"Mint open":"Preview"}</strong></div></div>
      </Link>)}</div>:
      <div className="curated-empty"><div className="curated-empty-icon">◇</div><h3>{search?"No matching drops":catalogueReady?"No public NFT drops yet":"Official drops are coming"}</h3><p>{search?"Try another collection name.":"Verified creator-owned collections will appear here after Testnet deployment. No placeholder collections are shown."}</p></div>}
  </section>;
}
