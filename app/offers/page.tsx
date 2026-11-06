"use client";

import {useEffect,useState,type FormEvent} from "react";
import Link from "next/link";
import {createPublicClient,http,formatEther,parseEventLogs,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "@/lib/network";
import {useWalletSession} from "@/components/WalletSessionProvider";
import {M8_VAULT,m8Gate,offerAbi,offerHash,parseOffer,offerFromJSON,type Offer,type OfferDraft} from "@/lib/m8/offers";

type Listing={offer_hash:string;buyer_wallet:string;collection_address:string;token_standard:string;
 token_id:string;quantity:string;total_price_wei:string;nonce:string;expires_at:string;
 state:string;funding_tx_hash:string};
type Detail={offer:Record<string,unknown>;offerHash:string;signature:string|null;
 status:string;currentlyFunded:boolean;independentlyFunded:boolean;
 quote:{feeWei:string;royaltyRecipient:string;royaltyWei:string;sellerProceedsWei:string}|null;
 chainProof:string;warning:string};
const initial:OfferDraft={
 collection:"",tokenId:"1",quantity:"1",totalPriceUOS:"1",
 nonce:"1",deadline:"",allowedSeller:"",minSellerProceedsUOS:"0",
 maxFeeBps:"200",maxRoyaltyBps:"1000",standard:"erc721"
};
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
async function readJson<T>(response:Response):Promise<T>{
 const data=await response.json() as {error?:string};
 if(!response.ok)throw new Error(data.error||"Operator service or source unavailable");
 return data as T;
}
export default function OffersPage(){
 const wallet=useWalletSession();
 const [draft,setDraft]=useState<OfferDraft>(initial);
 const [preview,setPreview]=useState<Offer|null>(null);
 const [orders,setOrders]=useState<Listing[]>([]);
 const [selected,setSelected]=useState<Detail|null>(null);
 const [ack,setAck]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [message,setMessage]=useState("No authentic funded offers, NFT transfers or trade activity have been evidenced.");
 const [hash,setHash]=useState<Hex|null>(null);
 const [scope,setScope]=useState<"verified"|"mine">("verified");
 const authenticated=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
 const fundDisabled=Boolean(m8Gate("fund")||m8Gate("sign"));
 const acceptDisabled=Boolean(m8Gate("accept"));
 const refundDisabled=Boolean(m8Gate("refund"));
 function edit<K extends keyof OfferDraft>(key:K,value:OfferDraft[K]){
  setDraft(p=>({...p,[key]:value}));setPreview(null);setError(null);setAck(false);
 }
 async function refresh(){
  if(!authenticated){setOrders([]);return;}
  try{
   const result=await readJson<{offers:Listing[]}>(await fetch("/api/offers?scope="+scope,{cache:"no-store"}));
   setOrders(result.offers||[]);setError(null);
  }catch(e){setError(e instanceof Error?e.message:"Read-only offer records unavailable");setOrders([]);}
 }
 useEffect(()=>{void refresh();},[authenticated,wallet.address,wallet.chainId,scope]);
 useEffect(()=>{setPreview(null);setSelected(null);setAck(false);},[wallet.address,wallet.chainId,wallet.authenticated]);
 async function run(action:()=>Promise<void>){
  setBusy(true);setError(null);setHash(null);
  try{await action();await refresh();}
  catch(e){setError(e instanceof Error?e.message:"Real Testnet preflight or operator source unavailable");}
  finally{setBusy(false);}
 }
 function review(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!authenticated||!wallet.address){setError("Sign in to a real Ultra Testnet wallet first");return;}
  try{
   setPreview(parseOffer(draft,wallet.address as Address));
   setMessage("Offer draft only: no signature, no UOS escrow deposit, no NFT, no trade.");
   setError(null);
  }catch(e){setError(e instanceof Error?e.message:"Offer details invalid");setPreview(null);}
 }
 function signAndFund(){
  if(!preview||busy||!authenticated||fundDisabled)return;
  void run(async()=>{
   const o=preview;
   const signature=await wallet.signBuyerOffer(o);
   if(o.buyer.toLowerCase()!==wallet.address?.toLowerCase())
    throw Error("Buyer wallet changed after signing");
   const tx=await wallet.fundBuyerOffer(o,signature);
   setHash(tx);
   setMessage("Funding transaction submitted. Submission alone does NOT mean UOS was escrowed.");
   const receipt=await rpc.waitForTransactionReceipt({hash:tx,confirmations:2,timeout:180000});
   if(receipt.status!=="success")throw Error("Offer funding reverted or receipt unavailable");
   const ev=parseEventLogs({abi:offerAbi,logs:receipt.logs,eventName:"OfferFunded"});
   const digest=offerHash(o,M8_VAULT as Address);
   if(ev.filter(e=>e.address.toLowerCase()===M8_VAULT.toLowerCase()&&
     e.args.offerHash.toLowerCase()===digest.toLowerCase()&&
     e.args.totalPriceWei===o.totalPriceWei).length!==1)
    throw Error("No matching real OfferFunded event found; no offer stored");
   const result=await readJson<{state:string}>(await fetch("/api/offers",{
    method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
    body:JSON.stringify({offer:draft,signature,txHash:tx})
   }));
   if(result.state!=="primary_rpc_funded_unverified")
    throw Error("Operator did not return expected unverified funded state");
   setPreview(null);
   setMessage("Primary RPC sees funded bid; independent two-RPC/Blockscout verification is STILL REQUIRED. No marketplace trade has occurred.");
  });
 }
 async function select(entry:Listing){
  await run(async()=>{
   const detail=await readJson<Detail>(await fetch("/api/offers/"+entry.offer_hash,{cache:"no-store"}));
   setSelected(detail);setAck(false);
   setMessage("Read-only Testnet snapshot: wallet acceptance and independent finality are separate.");
  });
 }
 function accept(){
  if(!selected||!ack||busy||acceptDisabled||!authenticated||!selected.independentlyFunded||
     !selected.currentlyFunded)return;
  void run(async()=>{
   const o=offerFromJSON(selected.offer);
   const tx=await wallet.acceptBuyerOffer(o);
   setHash(tx);
   setMessage("Seller wallet submitted NFT acceptance. No verified trade until actual receipt and independent checks.");
   const receipt=await rpc.waitForTransactionReceipt({hash:tx,confirmations:2,timeout:180000});
   if(receipt.status!=="success")throw Error("NFT acceptance reverted");
   const matched=parseEventLogs({abi:offerAbi,logs:receipt.logs,eventName:"OfferAccepted"}).find(e=>
     e.address.toLowerCase()===M8_VAULT.toLowerCase()&&
     e.args.offerHash.toLowerCase()===selected.offerHash.toLowerCase()&&
     e.args.buyer.toLowerCase()===o.buyer.toLowerCase()&&
     e.args.seller.toLowerCase()===wallet.address?.toLowerCase()&&
     e.args.totalPriceWei===o.totalPriceWei&&
     e.args.feeWei+e.args.royaltyWei+e.args.sellerProceedsWei===o.totalPriceWei);
   if(!matched)throw Error("No matching NFT delivery/fee event on primary RPC");
   setMessage("Primary RPC event matched signed offer and UOS accounting. Independent two-RPC/Blockscout verification NOT completed. No validated sale entered.");
  });
 }
 function refund(){
  if(!selected||!authenticated||!selected.currentlyFunded||busy||refundDisabled||
     selected.offer.buyer?.toString().toLowerCase()!==wallet.address?.toLowerCase())return;
  void run(async()=>{
   const o=offerFromJSON(selected.offer);
   const tx=await wallet.refundBuyerOffer(o);
   setHash(tx);setMessage("Buyer refund transaction submitted; waiting for source-backed receipt.");
   const receipt=await rpc.waitForTransactionReceipt({hash:tx,confirmations:2,timeout:180000});
   if(receipt.status!=="success")throw Error("Buyer UOS refund reverted");
   const ev=parseEventLogs({abi:offerAbi,logs:receipt.logs,eventName:"OfferRefunded"});
   if(!ev.some(e=>e.address.toLowerCase()===M8_VAULT.toLowerCase()&&
       e.args.offerHash.toLowerCase()===selected.offerHash.toLowerCase()&&
       e.args.amountWei===o.totalPriceWei))
    throw Error("Real refund event not confirmed on primary RPC");
   setMessage("Refund event matched on primary RPC. Independent confirmation pending.");
  });
 }
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / ULTRA EVM TESTNET / M8</p>
  <h1>Buyer bids & offers.</h1>
  <p className="interior-copy">A buyer signs a specific EIP-712 NFT bid and separately approves the exact UOS escrow deposit in their wallet. The seller must own and separately approve transfer of the NFT before acceptance. All wallet execution is OFF until independent security/operator approval.</p>
  <p className="index-warning" role="status">{m8Gate("sign")||"Testnet buyer signing requires explicit wallet approval"} · {m8Gate("fund")||"Funding requires separate exact-UOS wallet confirmation"} · {m8Gate("accept")||"Seller acceptance requires NFT ownership and wallet approval"}</p>
  {error&&<p role="alert" className="index-warning">{error}</p>}
  <div className="studio-grid">
   <form className="creator-form" onSubmit={review}>
    <h2>1. Create a buyer bid</h2>
    <div className="creator-form-grid">
     <label className="creator-wide">NFT collection<input value={draft.collection} placeholder="0x..." onChange={e=>edit("collection",e.target.value)}/></label>
     <label>Standard<select value={draft.standard} onChange={e=>edit("standard",e.target.value as "erc721"|"erc1155")}><option value="erc721">ERC-721</option><option value="erc1155">ERC-1155</option></select></label>
     <label>Token ID<input value={draft.tokenId} inputMode="numeric" onChange={e=>edit("tokenId",e.target.value)}/></label>
     <label>Quantity<input value={draft.quantity} inputMode="numeric" onChange={e=>edit("quantity",e.target.value)}/></label>
     <label>Exact total offer (UOS)<input value={draft.totalPriceUOS} inputMode="decimal" onChange={e=>edit("totalPriceUOS",e.target.value)}/></label>
     <label>Unique buyer nonce<input value={draft.nonce} inputMode="numeric" onChange={e=>edit("nonce",e.target.value)}/></label>
     <label>Deadline Unix seconds<input value={draft.deadline} inputMode="numeric" placeholder="Within 90 days" onChange={e=>edit("deadline",e.target.value)}/></label>
     <label className="creator-wide">Seller restriction (optional)<input value={draft.allowedSeller} placeholder="0x... or leave empty" onChange={e=>edit("allowedSeller",e.target.value)}/></label>
     <label>Seller minimum proceeds (UOS)<input value={draft.minSellerProceedsUOS} inputMode="decimal" onChange={e=>edit("minSellerProceedsUOS",e.target.value)}/></label>
     <label>Max platform fee (bps)<input value={draft.maxFeeBps} inputMode="numeric" onChange={e=>edit("maxFeeBps",e.target.value)}/></label>
     <label>Max ERC2981 royalty (bps)<input value={draft.maxRoyaltyBps} inputMode="numeric" onChange={e=>edit("maxRoyaltyBps",e.target.value)}/></label>
    </div>
    <p className="wallet-note">Fixed marketplace fee: 200 bps (2%); maximum royalty: 1,000 bps (10%). Entire UOS bid is protected in a dedicated escrow until acceptance/refund. Deposits are not automatically recoverable during outages; verify contract security before ever enabling.</p>
    <button className="primary-link" disabled={busy||!authenticated}>Review unsigned terms</button>
    {preview&&<div className="creator-preflight">
      <h2>Unsigned, unfunded draft</h2>
      <dl>
       <div><dt>Offer</dt><dd>{formatEther(preview.totalPriceWei)} UOS · {preview.quantity.toString()} unit(s)</dd></div>
       <div><dt>Buyer</dt><dd>{preview.buyer}</dd></div>
       <div><dt>Expires</dt><dd>{new Date(Number(preview.deadline)*1000).toLocaleString()}</dd></div>
      </dl>
      <button type="button" className="primary-link" onClick={signAndFund}
        disabled={busy||fundDisabled||!authenticated}>Sign offer, then separately fund exact UOS in wallet</button>
    </div>}
   </form>
   <section className="creator-preflight">
    <h2>2. Real bid evidence</h2>
    <p className="wallet-note">Public offers require independent two-provider/Blockscout verification of actual escrow. Buyers can inspect their own primary-RPC candidates without claiming independent verification.</p>
    <div className="studio-action-row">
     <button className="secondary-link" disabled={busy} onClick={()=>setScope("verified")}>Verified funded</button>
     <button className="secondary-link" disabled={busy} onClick={()=>setScope("mine")}>My UOS bids</button>
     <button className="secondary-link" disabled={busy||!authenticated} onClick={()=>void refresh()}>Refresh</button>
    </div>
    {orders.length?<div className="studio-assets">{orders.map(x=><article key={x.offer_hash} className="studio-asset"><div>
     <strong>{x.token_standard.toUpperCase()} #{x.token_id} · {x.state.replaceAll("_"," ")}</strong>
     <p>{x.collection_address}</p>
     <p>Total: {formatEther(BigInt(x.total_price_wei))} UOS · Qty: {x.quantity} · Buyer: {x.buyer_wallet}</p>
     <p>Expires: {new Date(x.expires_at).toLocaleString()}</p>
     <button type="button" className="secondary-link" disabled={busy} onClick={()=>void select(x)}>Check actual Testnet offer</button>
    </div></article>)}</div>:<p className="wallet-note">No independently verified funded bids for sale. No simulated bidding volume has been inserted.</p>}
   </section>
  </div>
  {selected&&<section className="creator-preflight">
   <h2>3. Current funding & seller review</h2>
   <dl>
    <div><dt>Order</dt><dd>{selected.offerHash}</dd></div>
    <div><dt>Status</dt><dd>{selected.status}</dd></div>
    <div><dt>Live escrow at primary RPC</dt><dd>{selected.currentlyFunded?"Currently funded (snapshot)":"Not fillable / not funded"}</dd></div>
    <div><dt>Independent funding</dt><dd>{selected.independentlyFunded?"Verifier journal agrees":"Unverified — no sale authorisation"}</dd></div>
    <div><dt>Buyer</dt><dd>{String(selected.offer.buyer)}</dd></div>
    <div><dt>Seller proceeds estimate</dt><dd>{selected.quote?formatEther(BigInt(selected.quote.sellerProceedsWei))+" UOS":"Quote unavailable"}</dd></div>
    <div><dt>Market fee</dt><dd>{selected.quote?formatEther(BigInt(selected.quote.feeWei))+" UOS":"Unavailable"}</dd></div>
    <div><dt>Royalty</dt><dd>{selected.quote?formatEther(BigInt(selected.quote.royaltyWei))+" UOS":"Unavailable"}</dd></div>
   </dl>
   <label className="creator-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
     I checked the exact NFT, buyer, on-chain escrow, collection, token, quantity and proposed UOS payout. I understand my wallet must separately approve the NFT transfer and seller acceptance.
   </label>
   <div className="studio-action-row">
     <button className="primary-link" disabled={busy||!ack||!authenticated||
       !selected.independentlyFunded||!selected.currentlyFunded||acceptDisabled||
       selected.offer.buyer?.toString().toLowerCase()===wallet.address?.toLowerCase()}
       onClick={accept}>Seller: accept NFT offer in wallet</button>
     <button className="secondary-link" disabled={busy||!authenticated||refundDisabled||
       !selected.currentlyFunded||selected.offer.buyer?.toString().toLowerCase()!==wallet.address?.toLowerCase()}
       onClick={refund}>Buyer: refund full UOS offer</button>
   </div>
  </section>}
  <p className="wallet-note" role="status">{message}</p>
  {hash&&<p className="index-warning">Wallet-submitted transaction <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+hash} target="_blank" rel="noopener noreferrer">{hash}</a>. A submission is not a verified trade or refund.</p>}
  <p className="wallet-note"><Link href="/market">Fixed-price listings</Link> · <Link href="/explore">Verified collection index</Link></p>
 </section>;
}
