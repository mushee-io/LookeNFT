"use client";
import { useParams } from "next/navigation";
import { useEffect,useState } from "react";
import Link from "next/link";
import CollectionManagePanel from "@/components/CollectionManagePanel";
import NFTSaleEntry from "@/components/NFTSaleEntry";
import {useWalletSession} from "@/components/WalletSessionProvider";
type Drop={address:string;standard:"erc721"|"erc1155";title:string;description:string;coverUrl:string|null;avatarUrl:string|null;creatorWallet:string;status:"draft"|"published";archived:boolean;mintEnabled:boolean;phaseId:string;mintAvailable:boolean};
type Result={collections?:Drop[];error?:string};
type Token={tokenId:string;lastObservedBlock:string;name?:string;imageUrl?:string;owner?:string;evidenceSource?:string;hidden?:boolean};
export default function CollectionDetail(){
 const {address}=useParams<{address:string}>();
 const wallet=useWalletSession();
 const [drop,setDrop]=useState<Drop|null>(null);
 const [tokens,setTokens]=useState<Token[]>([]);
 const [tokenSource,setTokenSource]=useState("");
 const [imageFailures,setImageFailures]=useState<Record<string,boolean>>({});
 const [tab,setTab]=useState<"items"|"about">("items");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState<string|null>(null);
 const [tokenBusy,setTokenBusy]=useState<string|null>(null);
 const [tokenError,setTokenError]=useState<string|null>(null);
 const [tokenNotice,setTokenNotice]=useState<string|null>(null);
 useEffect(()=>{
  const ctl=new AbortController();setLoading(true);setError(null);
  fetch("/api/curated?address="+encodeURIComponent(address),{signal:ctl.signal,cache:"no-store"})
   .then(async r=>{const data=await r.json() as Result;if(!r.ok)throw Error(data.error||"Unpublished collection");return data;})
   .then(async data=>{
      if(ctl.signal.aborted)return;
      const chosen=data.collections?.[0];if(!chosen)throw Error("Collection not found");
      setDrop(chosen);
      const r=await fetch("/api/nfts/tokens?collection="+encodeURIComponent(chosen.address),{signal:ctl.signal,cache:"no-store"});
      if(r.ok){const result=await r.json() as {tokens?:Token[];source?:string};if(!ctl.signal.aborted){setTokens(result.tokens||[]);setTokenSource(result.source||"");}}
   })
   .catch(e=>{if(!ctl.signal.aborted)setError(e instanceof Error?e.message:"Unable to load collection");})
   .finally(()=>{if(!ctl.signal.aborted)setLoading(false);});
  return()=>ctl.abort();
 },[address]);
 async function setTokenHidden(tokenId:string,hidden:boolean){
  if(!drop||!wallet.authenticated)return;
  setTokenBusy(tokenId);setTokenError(null);setTokenNotice(null);
  try{
   const response=await fetch("/api/creator/collections/"+drop.address+"/tokens/"+encodeURIComponent(tokenId),{
    method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({hidden})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw Error(data.error||"NFT gallery update failed");
   setTokens(items=>items.map(t=>t.tokenId===tokenId?{...t,hidden}:t));
   setTokenNotice(hidden?"NFT #"+tokenId+" hidden from LookeNFT gallery, not burned on-chain.":"NFT #"+tokenId+" restored to LookeNFT gallery.");
  }catch(e){setTokenError(e instanceof Error?e.message:"Could not update NFT visibility");}
  finally{setTokenBusy(null);}
 }
 if(loading)return <section className="curated-page"><div className="curated-empty" role="status">Loading collection preview…</div></section>;
 if(error||!drop)return <section className="curated-page"><Link className="curated-back" href="/explore">← Back to collections</Link><div className="curated-empty" role="alert">{error||"Collection unavailable"}</div></section>;
 if(drop.archived)return <section className="curated-page curated-detail">
  <Link className="curated-back" href="/explore">← All collections</Link>
  <h1>{drop.title} · Removed from LookeNFT</h1>
  <p>The NFT contract and tokens remain on Ultra EVM Testnet. This collection is no longer shown to other visitors.</p>
  <p className="curated-address">{drop.address}</p>
  <CollectionManagePanel collection={drop} onChanged={patch=>setDrop(previous=>previous?{...previous,...patch}:previous)}/>
 </section>;
 const canManageTokens=wallet.authenticated&&wallet.chainId===18881&&
  wallet.address?.toLowerCase()===drop.creatorWallet.toLowerCase();
 return <section className="curated-page curated-detail">
  <Link className="curated-back" href="/explore">← All collections</Link>
  <div className="curated-banner">{drop.coverUrl&&!imageFailures.banner?<img src={drop.coverUrl} alt={drop.title+" collection cover"} onError={()=>setImageFailures(prev=>({...prev,banner:true}))}/>:<div className="curated-banner-empty">Cover artwork unavailable · The collection owner can change this image</div>}</div>
  <div className="curated-profile"><div className="curated-avatar">{(drop.avatarUrl||drop.coverUrl)&&!imageFailures.avatar?<img src={drop.avatarUrl||drop.coverUrl||""} alt={drop.title+" profile"} onError={()=>setImageFailures(prev=>({...prev,avatar:true}))}/>: "◇"}</div><div className="curated-pill">{drop.standard.toUpperCase()} · ULTRA EVM TESTNET</div></div>
  <div className="curated-detail-header"><div><h1>{drop.title} <span className="curated-verified" title="Deployed Testnet collection; not audited">◇</span></h1><p className="curated-address">{drop.address}</p><p className="curated-description">{drop.description||"A creator-owned Ultra Testnet collection."}</p></div>
    <div style={{display:"grid",gap:8,justifyItems:"end"}}><Link className="curated-mint" href={"/mint?collection="+encodeURIComponent(drop.address)}>Mint NFTs ↗</Link>{!drop.mintAvailable&&<span className="curated-muted-mint" style={{fontSize:12,padding:"8px 12px"}}>Creator can enable free mint below</span>}</div>
  </div>
  <CollectionManagePanel collection={drop} onChanged={patch=>{setDrop(previous=>previous?{...previous,...patch}:previous);setImageFailures({});}}/>
  {tokenError&&<p role="alert" className="operator-error">{tokenError}</p>}
  {tokenNotice&&<p role="status" className="operator-note">{tokenNotice}</p>}
  <div className="curated-tabs"><button className={tab==="items"?"active":""} onClick={()=>setTab("items")}>Items</button><button className={tab==="about"?"active":""} onClick={()=>setTab("about")}>About</button></div>
  {tab==="items"?<><p className="curated-list-caption">{tokenSource==="read-only-on-chain-ownership-snapshot"?"Verified on-chain NFT ownership":"Indexed on-chain token IDs"} · {tokens.length} currently returned</p>{tokens.length?<div className="curated-items">{tokens.map(t=><article className="curated-item" key={t.tokenId}>
   <div className="curated-item-art">{t.imageUrl&&!imageFailures["token"+t.tokenId]?<img src={t.imageUrl} alt={t.name||"NFT #"+t.tokenId} style={{width:"100%",height:"100%",objectFit:"contain"}} onError={()=>setImageFailures(prev=>({...prev,["token"+t.tokenId]:true}))}/>:<span>Artwork unavailable · Token #{t.tokenId}</span>}</div><div className="curated-item-info"><strong>{t.name||"Token #"+t.tokenId}</strong><span>{t.evidenceSource==="verified-on-chain-ownerOf"?"Ownership verified on-chain at block ":"Observed at block "}{t.lastObservedBlock}</span>{t.hidden?<small>Hidden from public LookeNFT gallery · not burned on-chain</small>:
   <NFTSaleEntry collection={drop.address} tokenId={t.tokenId} tokenName={t.name} />}
   {canManageTokens&&drop.standard==="erc721"&&<button type="button" className="creator-secondary"
    disabled={tokenBusy!==null} onClick={()=>void setTokenHidden(t.tokenId,!t.hidden)}>
    {tokenBusy===t.tokenId?"Updating…":t.hidden?"Restore NFT to gallery":"Hide NFT from gallery"}
   </button>}</div></article>)}</div>:
  <div className="curated-empty"><h3>No indexed tokens yet</h3><p>Once real NFT mint events are indexed, their token IDs will appear here. No example inventory is shown.</p></div>}</>:
  <div className="curated-about"><h2>About this collection</h2><p>{drop.description||"Creator-owned Ultra Testnet collection."}</p><p>Contract: {drop.address}</p><p>Minting: {drop.mintAvailable?"Free public mint available (0 UOS + Testnet gas)":"Free public mint is awaiting a creator-wallet phase; open Manage Collection → Enable free mint"}</p></div>}
 </section>;
}
