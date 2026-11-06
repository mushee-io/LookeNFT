"use client";
import { useParams } from "next/navigation";
import { useEffect,useState } from "react";
import Link from "next/link";
type Drop={address:string;standard:string;title:string;description:string;coverUrl:string|null;phaseId:string;mintAvailable:boolean};
type Result={collections?:Drop[];error?:string};
type Token={tokenId:string;lastObservedBlock:string};
export default function CollectionDetail(){
 const {address}=useParams<{address:string}>();
 const [drop,setDrop]=useState<Drop|null>(null);
 const [tokens,setTokens]=useState<Token[]>([]);
 const [tab,setTab]=useState<"items"|"about">("items");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{
  const ctl=new AbortController();setLoading(true);setError(null);
  fetch("/api/curated?address="+encodeURIComponent(address),{signal:ctl.signal,cache:"no-store"})
   .then(async r=>{const data=await r.json() as Result;if(!r.ok)throw Error(data.error||"Unpublished collection");return data;})
   .then(async data=>{
      if(ctl.signal.aborted)return;
      const chosen=data.collections?.[0];if(!chosen)throw Error("Collection not found");
      setDrop(chosen);
      const r=await fetch("/api/nfts/tokens?collection="+encodeURIComponent(chosen.address),{signal:ctl.signal,cache:"no-store"});
      if(r.ok){const result=await r.json() as {tokens?:Token[]};if(!ctl.signal.aborted)setTokens(result.tokens||[]);}
   })
   .catch(e=>{if(!ctl.signal.aborted)setError(e instanceof Error?e.message:"Unable to load collection");})
   .finally(()=>{if(!ctl.signal.aborted)setLoading(false);});
  return()=>ctl.abort();
 },[address]);
 if(loading)return <section className="curated-page"><div className="curated-empty" role="status">Loading collection preview…</div></section>;
 if(error||!drop)return <section className="curated-page"><Link className="curated-back" href="/explore">← Back to collections</Link><div className="curated-empty" role="alert">{error||"Collection unavailable"}</div></section>;
 return <section className="curated-page curated-detail">
  <Link className="curated-back" href="/explore">← All collections</Link>
  <div className="curated-banner">{drop.coverUrl?<img src={drop.coverUrl} alt={drop.title+" collection cover"} />:<div className="curated-banner-empty">◇</div>}</div>
  <div className="curated-profile"><div className="curated-avatar">{drop.coverUrl?<img src={drop.coverUrl} alt="" />:"◇"}</div><div className="curated-pill">{drop.standard.toUpperCase()} · ULTRA EVM TESTNET</div></div>
  <div className="curated-detail-header"><div><h1>{drop.title} <span className="curated-verified" title="Published by LookeNFT">✓</span></h1><p className="curated-address">{drop.address}</p><p className="curated-description">{drop.description||"An official LookeNFT collection."}</p></div>
    {drop.mintAvailable?<Link className="curated-mint" href={"/mint?collection="+encodeURIComponent(drop.address)}>Mint NFT ↗</Link>:<span className="curated-muted-mint">Mint not open</span>}
  </div>
  <div className="curated-tabs"><button className={tab==="items"?"active":""} onClick={()=>setTab("items")}>Items</button><button className={tab==="about"?"active":""} onClick={()=>setTab("about")}>About</button></div>
  {tab==="items"?<><p className="curated-list-caption">Indexed on-chain token IDs · {tokens.length} currently returned</p>{tokens.length?<div className="curated-items">{tokens.map(t=><article className="curated-item" key={t.tokenId}>
   <div className="curated-item-art">#{t.tokenId}</div><div className="curated-item-info"><strong>Token #{t.tokenId}</strong><span>Observed at block {t.lastObservedBlock}</span></div></article>)}</div>:
  <div className="curated-empty"><h3>No indexed tokens yet</h3><p>Once real NFT mint events are indexed, their token IDs will appear here. No example inventory is shown.</p></div>}</>:
  <div className="curated-about"><h2>About this collection</h2><p>{drop.description||"Official LookeNFT collection."}</p><p>Contract: {drop.address}</p><p>Minting: {drop.mintAvailable?"Enabled after operator approval":"Not yet open"}</p></div>}
 </section>;
}
