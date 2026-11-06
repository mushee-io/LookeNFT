"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import {formatEther,isAddress} from "viem";
import {useWalletSession} from "@/components/WalletSessionProvider";
import {ULTRA_TESTNET} from "@/lib/network";

type Coverage={active:boolean;stale:boolean;lastBlock:string|null;lastHash:string|null;updatedAt:string|null};
type Overview={chainId:18881;coverage:Coverage;verifiedSales:string|null;
 verifiedVolumeWei:string|null;verifiedFloorWei:string|null;indicativeAskFloorWei:string|null;warning:string};
type Order={hash:string;collection:string;standard:string;actor:string;token_id:string;
 quantity:string;price_wei:string;at_block:string;checked_at:string};
type Book={chainId:18881;coverage:Coverage;asks:Order[];bids:Order[];status:string;warning:string};
type Notice={source_kind:string;event_kind:string;tx_hash:string;log_index:number;
 block_number:string;block_hash:string;created_at:string};
type Notices={chainId:18881;wallet:string;notifications:Notice[];warning:string};
type Quote={priceWei:string;feeWei:string;royaltyWei:string;sellerProceedsWei:string;
 royaltyRecipient:string;gasUnits:string|null;maxObservedGasPriceWei:string|null;
 indicativeGasCostWei:string|null;block:string;warning:string};
type View="overview"|"orderbook"|"notifications";

function uos(value:string|null|undefined):string{
 if(value===null||value===undefined)return "Not independently established";
 try{return formatEther(BigInt(value))+" UOS";}catch{return "Not independently established";}
}
export default function MarketOperations(){
 const wallet=useWalletSession();
 const [view,setView]=useState<View>("overview");
 const [filter,setFilter]=useState("");
 const [search,setSearch]=useState("");
 const [overview,setOverview]=useState<Overview|null>(null);
 const [book,setBook]=useState<Book|null>(null);
 const [notices,setNotices]=useState<Notices|null>(null);
 const [quote,setQuote]=useState<Quote|null>(null);
 const [busyQuote,setBusyQuote]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const authed=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
 useEffect(()=>{
  setOverview(null);setBook(null);setNotices(null);setQuote(null);setError(null);
  if(!authed)return;
  const ac=new AbortController();setLoading(true);
  const query=new URLSearchParams({view});
  if(search&&view!=="notifications")query.set("collection",search);
  fetch("/api/market/operations?"+query,{signal:ac.signal,cache:"no-store"})
   .then(async r=>{const body=await r.json() as {error?:string};
    if(!r.ok)throw Error(body.error||"Source-backed marketplace unavailable");
    return body;})
   .then(body=>{
    if(ac.signal.aborted)return;
    if(view==="overview")setOverview(body as Overview);
    if(view==="orderbook")setBook(body as Book);
    if(view==="notifications")setNotices(body as Notices);
   }).catch(e=>{if(!ac.signal.aborted)
     setError(e instanceof Error?e.message:"Independent data unavailable");})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false);});
  return ()=>ac.abort();
 },[view,search,refresh,authed,wallet.address,wallet.chainId]);
 function applyFilter(){
  if(filter&&!isAddress(filter,{strict:false})){setError("Enter a valid ERC721/1155 collection address");return;}
  setSearch(filter.toLowerCase());setError(null);setQuote(null);
 }
 async function preview(kind:"listing"|"offer",hash:string){
  setBusyQuote(true);setError(null);setQuote(null);
  try{
   const query=new URLSearchParams({kind,hash});
   const response=await fetch("/api/market/quote?"+query,{cache:"no-store"});
   const body=await response.json() as Quote&{error?:string};
   if(!response.ok)throw Error(body.error||"Independent quote not available");
   setQuote(body);
  }catch(e){setError(e instanceof Error?e.message:"No verified read-only quote available");}
  finally{setBusyQuote(false);}
 }
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / MARKET OPERATIONS / ULTRA EVM TESTNET</p>
  <h1>Evidence-first orderbook.</h1>
  <p className="interior-copy">This is a read-only, wallet-scoped trading operations dashboard. All sales, deposits and refunds require independent source evidence. It never simulates volume, NFTs, open bids or prices when real data is unavailable.</p>
  <p role="status" className="index-warning">Trading and offer funding are disabled. Independent Blockscout, genuine NFT deployment and operator audit gates remain open.</p>
  <div className="studio-action-row">
   <button className="secondary-link" disabled={loading} onClick={()=>setView("overview")}>Verified sales</button>
   <button className="secondary-link" disabled={loading} onClick={()=>setView("orderbook")}>Order snapshots</button>
   <button className="secondary-link" disabled={loading} onClick={()=>setView("notifications")}>My notifications</button>
   <button className="secondary-link" disabled={!authed||loading} onClick={()=>setRefresh(n=>n+1)}>Refresh sources</button>
  </div>
  {view!=="notifications"&&<div className="studio-action-row">
   <label>Collection filter (optional)
    <input value={filter} placeholder="0x… approved Testnet NFT contract" onChange={e=>setFilter(e.target.value)}/>
   </label>
   <button className="secondary-link" onClick={applyFilter} disabled={loading}>Apply</button>
  </div>}
  {!authed&&<p className="wallet-note">Authenticate your Ultra EVM Testnet wallet to view operator-protected read-only marketplace data. No wallet transaction is required.</p>}
  {loading&&<p className="wallet-note">Reading source-backed marketplace records…</p>}
  {error&&<p role="alert" className="index-warning">{error}</p>}
  {view==="overview"&&overview&&<section className="creator-preflight">
   <h2>Independently attested marketplace activity</h2>
   <p className="wallet-note">{overview.warning}</p>
   <dl>
    <div><dt>Canonically tracked Testnet block</dt><dd>{overview.coverage.active?
     "#"+overview.coverage.lastBlock+(overview.coverage.stale?" (stale)":""):
     "No independently confirmed market coverage"}</dd></div>
    <div><dt>Independently witnessed sales in tracked markets</dt><dd>{overview.verifiedSales??"No independently confirmed market coverage"}</dd></div>
    <div><dt>Verified tracked UOS trading volume</dt><dd>{uos(overview.verifiedVolumeWei)}</dd></div>
    <div><dt>Independently verified collection floor</dt><dd>{uos(overview.verifiedFloorWei)}</dd></div>
    <div><dt>Indicative seller ask (historical snapshot only)</dt><dd>{uos(overview.indicativeAskFloorWei)}</dd></div>
   </dl>
   <p className="wallet-note">A token transfer is not a sale. A signed listing is not a completed sale. Only attested M7/M8 settlements matching canonical M9 blocks count toward volume.</p>
  </section>}
  {view==="orderbook"&&book&&<section className="creator-preflight">
   <h2>Real observed orders — NOT executable trade offers</h2>
   <p className="wallet-note">{book.warning}</p>
   <p className="wallet-note">Coverage: {book.coverage.active?"#"+book.coverage.lastBlock:"inactive"} · {book.status}</p>
   {(["asks","bids"] as const).map(side=><div key={side}>
    <h2>{side==="asks"?"Seller listing snapshots":"Fully funded buyer offer snapshots"}</h2>
    {book[side].length?<div className="studio-assets">{book[side].map(order=>
     <article className="studio-asset" key={order.hash}>
      <strong>{order.standard.toUpperCase()} · #{order.token_id} · {uos(order.price_wei)}</strong>
      <p>{order.collection}</p>
      <p>Qty {order.quantity} · {side==="asks"?"Seller":"Buyer"} {order.actor}</p>
      <p>Observed block {order.at_block} · {new Date(order.checked_at).toLocaleString()}</p>
      <button className="secondary-link" disabled={busyQuote} onClick={()=>void preview(side==="asks"?"listing":"offer",order.hash)}>Preview verified on-chain UOS, royalty and estimated gas (read-only)</button>
     </article>)}</div>:<p className="wallet-note">No independently checked {side} are available. No placeholder orders or invented NFT volumes.</p>}
   </div>)}
  </section>}
  {quote&&<section className="creator-preflight">
    <h2>Read-only two-RPC quote</h2>
    <dl>
     <div><dt>Quoted UOS total</dt><dd>{uos(quote.priceWei)}</dd></div>
     <div><dt>Marketplace fee</dt><dd>{uos(quote.feeWei)}</dd></div>
     <div><dt>ERC2981 royalty</dt><dd>{uos(quote.royaltyWei)} · {quote.royaltyRecipient}</dd></div>
     <div><dt>Seller proceeds</dt><dd>{uos(quote.sellerProceedsWei)}</dd></div>
     <div><dt>Gas units (simulation)</dt><dd>{quote.gasUnits??"Unavailable"}</dd></div>
     <div><dt>Indicative gas cost</dt><dd>{uos(quote.indicativeGasCostWei)}</dd></div>
     <div><dt>Snapshot block</dt><dd>#{quote.block}</dd></div>
    </dl>
    <p className="wallet-note">{quote.warning}</p>
  </section>}
  {view==="notifications"&&notices&&<section className="creator-preflight">
   <h2>My verified chain events</h2>
   <p className="wallet-note">{notices.warning}</p>
   {notices.notifications.length?<div className="studio-assets">
    {notices.notifications.map(n=><article className="studio-asset" key={n.tx_hash+n.log_index+n.event_kind}>
     <strong>{n.event_kind.replaceAll("_"," ")} · block #{n.block_number}</strong>
     <p>{n.source_kind} · source-verified canonical event only</p>
     <p><a href={ULTRA_TESTNET.explorerUrl+"/tx/"+n.tx_hash}
       target="_blank" rel="noopener noreferrer">Inspect real Testnet hash {n.tx_hash.slice(0,12)}…</a></p>
    </article>)}
   </div>:<p className="wallet-note">No independently verified marketplace notifications for this wallet.</p>}
  </section>}
  <p className="wallet-note"><Link href="/market">Fixed-price listing groundwork</Link> · <Link href="/offers">Funded offer groundwork</Link> · <Link href="/activity">Verified NFT transfer activity</Link></p>
 </section>;
}
