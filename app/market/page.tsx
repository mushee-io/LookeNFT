"use client";

import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { createPublicClient,http,isAddress,formatEther,parseEventLogs,type Address,type Hex } from "viem";
import { ULTRA_TESTNET } from "@/lib/network";
import { useWalletSession } from "@/components/WalletSessionProvider";
import {
  M7_MARKET_ADDRESS,M7_LISTING_ENABLED,M7_SETTLEMENT_ENABLED,marketAbi,erc721Abi,erc1155Abi,
  hashListing,parseListingDraft,m7Gate,type Listing,type ListingDraft
} from "@/lib/m7/market";

type Candidate={
  order_hash:string;marketplace:string;seller_wallet:string;collection_address:string;
  token_standard:"erc721"|"erc1155";token_id:string;quantity:string;
  unit_price_wei:string;nonce:string;deadline:string;state:string;created_at:string
};
type Quote={
  totalWei:string;feeWei:string;royaltyRecipient:string;royaltyWei:string;sellerProceedsWei:string
};
type Review={listing:Listing;hash:Hex;signature:Hex;quote:Quote};
const initial:ListingDraft={
  collection:"",tokenId:"1",quantity:"1",unitPriceUOS:"1",
  nonce:"1",deadlineSeconds:"",reservedBuyer:"",
  minSellerProceedsUOS:"0",maxFeeBps:"200",maxRoyaltyBps:"1000",standard:"erc721"
};
const rpc=createPublicClient({
  transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})
});
const toListing=(row:Record<string,unknown>):Listing=>({
  seller:String(row.seller) as Address,collection:String(row.collection) as Address,
  tokenId:BigInt(String(row.tokenId)),quantity:BigInt(String(row.quantity)),
  unitPriceWei:BigInt(String(row.unitPriceWei)),nonce:BigInt(String(row.nonce)),
  deadline:BigInt(String(row.deadline)),reservedBuyer:String(row.reservedBuyer) as Address,
  minSellerProceedsWei:BigInt(String(row.minSellerProceedsWei)),
  maxFeeBps:Number(row.maxFeeBps),maxRoyaltyBps:Number(row.maxRoyaltyBps),
  standard:Number(row.standard)
});
async function readJson<T>(resp:Response):Promise<T>{
  const result=await resp.json() as {error?:string};
  if(!resp.ok)throw new Error(result.error||"Market operation is unavailable");
  return result as T;
}

export default function MarketplacePage(){
  const wallet=useWalletSession();
  const [draft,setDraft]=useState<ListingDraft>(initial);
  const [listingTarget,setListingTarget]=useState<{collection:string;tokenId:string|null}|null>(null);
  const [preview,setPreview]=useState<Listing|null>(null);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [selected,setSelected]=useState<Review|null>(null);
  const [ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("No Testnet listings or trades have been verified.");
  const [error,setError]=useState<string|null>(null);
  const [hash,setHash]=useState<Hex|null>(null);
  const [confirmed,setConfirmed]=useState<string|null>(null);
  const [scope,setScope]=useState<"all"|"mine">("all");
  const authed=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
  const gateList=m7Gate("list"),gateBuy=m7Gate("buy");
  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    const collection=query.get("collection")||"";
    const tokenId=query.get("tokenId")||"";
    const price=query.get("price")||"";
    if(isAddress(collection,{strict:false})){
      const validTokenId=/^(0|[1-9][0-9]*)$/.test(tokenId)?tokenId:null;
      const validPrice=/^(?:0|[1-9][0-9]{0,3})(?:\\.[0-9]{1,18})?$/.test(price) && Number(price)>0 && Number(price)<=1000;
      setDraft(current=>({...current,collection,tokenId:validTokenId??current.tokenId,
        unitPriceUOS:validPrice?price:current.unitPriceUOS,
        deadlineSeconds:current.deadlineSeconds||String(Math.floor(Date.now()/1000)+7*86400)}));
      setListingTarget({collection,tokenId:validTokenId});
      // The collection page deep-links directly to the seller form, not the market overview.
      window.requestAnimationFrame(()=>document.getElementById("seller-listing")?.scrollIntoView({block:"start"}));
    }
  },[]);

  function edit<K extends keyof ListingDraft>(key:K,value:ListingDraft[K]){
    setDraft(d=>({...d,[key]:value}));setPreview(null);setError(null);setStatus("Draft changed; on-chain checks must be repeated.");
  }
  async function loadCandidates(){
    if(!authed){setCandidates([]);return;}
    try{
      const response=await fetch("/api/market/listings?scope="+scope,{cache:"no-store"});
      const result=await readJson<{entries:Candidate[]}>(response);
      setCandidates(result.entries||[]);setError(null);
    }catch(e){setError(e instanceof Error?e.message:"Read-only order journal unavailable");setCandidates([]);}
  }
  useEffect(()=>{void loadCandidates();},[authed,wallet.address,wallet.chainId,scope]);
  useEffect(()=>{setPreview(null);setSelected(null);setAck(false);setConfirmed(null);},
    [wallet.address,wallet.chainId,wallet.authenticated]);

  async function run(fn:()=>Promise<void>){
    setBusy(true);setError(null);
    try{await fn();await loadCandidates();}
    catch(e){setError(e instanceof Error?e.message:"Market verification failed");}
    finally{setBusy(false);}
  }

  function reviewSeller(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError(null);setPreview(null);
    if(!wallet.address||wallet.chainId!==18881||!wallet.authenticated){
      setError("Authenticate your Ultra EVM Testnet wallet before reviewing a seller order");return;
    }
    try{
      const next=parseListingDraft(draft,wallet.address as Address);
      setPreview(next);
      setStatus("Local seller terms preview only. No signed listing, token approval, chain evidence or sale has been created.");
    }catch(e){setError(e instanceof Error?e.message:"Invalid seller order");}
  }
  function signAndRegister(){
    if(!preview||!authed||busy||gateList)return;
    void run(async()=>{
      const market=M7_MARKET_ADDRESS as Address;
      if(!isAddress(market)||await rpc.getChainId()!==18881)throw Error("Operator market or chain invalid");
      const [code,version,minimum,used,quote]=await Promise.all([
        rpc.getCode({address:market}),
        rpc.readContract({address:market,abi:marketAbi,functionName:"VERSION"}),
        rpc.readContract({address:market,abi:marketAbi,functionName:"minimumNonce",args:[preview.seller]}),
        rpc.readContract({address:market,abi:marketAbi,functionName:"invalidNonces",args:[preview.seller,preview.nonce]}),
        rpc.readContract({address:market,abi:marketAbi,functionName:"quote",args:[preview]})
      ]);
      if(!code||code==="0x"||version!==1n||used||preview.nonce<minimum)
        throw Error("Marketplace address, nonce, current terms or deployed code not verified");
      if(quote[0]!==preview.unitPriceWei*preview.quantity)
        throw Error("Operator marketplace quote does not equal the reviewed UOS price");
      if(preview.standard===1){
        const [owner,approved,all]=await Promise.all([
          rpc.readContract({address:preview.collection,abi:erc721Abi,functionName:"ownerOf",args:[preview.tokenId]}),
          rpc.readContract({address:preview.collection,abi:erc721Abi,functionName:"getApproved",args:[preview.tokenId]}),
          rpc.readContract({address:preview.collection,abi:erc721Abi,functionName:"isApprovedForAll",args:[preview.seller,market]})
        ]);
        if(owner.toLowerCase()!==preview.seller.toLowerCase()||
           (!all&&approved.toLowerCase()!==market.toLowerCase()))
          throw Error("The seller does not own or approve this NFT for settlement");
      }else{
        const [balance,approved]=await Promise.all([
          rpc.readContract({address:preview.collection,abi:erc1155Abi,functionName:"balanceOf",args:[preview.seller,preview.tokenId]}),
          rpc.readContract({address:preview.collection,abi:erc1155Abi,functionName:"isApprovedForAll",args:[preview.seller,market]})
        ]);
        if(balance<preview.quantity||!approved)
          throw Error("Insufficient ERC1155 balance or wallet-approved operator permission");
      }
      const signed=await wallet.signMarketListing(preview);
      const payload=await readJson<{orderHash:string}>(await fetch("/api/market/listings",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({listing:draft,signature:signed}),credentials:"same-origin"
      }));
      if(payload.orderHash.toLowerCase()!==hashListing(preview,market).toLowerCase())
        throw Error("Server registered a different signed order hash");
      setStatus("Authentic seller signature registered as a candidate. No NFT custody or sale has occurred.");
      setPreview(null);
    });
  }
  async function reviewCandidate(candidate:Candidate){
    await run(async()=>{
      const response=await fetch("/api/market/listings/"+candidate.order_hash,{cache:"no-store"});
      const data=await readJson<{
        order:Record<string,unknown>;hash:Hex;signature:Hex;quote:Quote
      }>(response);
      const listing=toListing(data.order);
      if(hashListing(listing,M7_MARKET_ADDRESS as Address).toLowerCase()!==data.hash.toLowerCase())
        throw Error("Saved candidate differs from primary RPC order hash");
      setSelected({listing,hash:data.hash,signature:data.signature,quote:data.quote});
      setAck(false);setConfirmed(null);
      setStatus("Primary RPC snapshot verified. A new wallet check is required before any UOS transaction.");
    });
  }
  function buy(){
    if(!selected||!ack||!authed||busy||gateBuy)return;
    void run(async()=>{
      const {listing,signature,quote}=selected;
      if(wallet.address?.toLowerCase()===listing.seller.toLowerCase())
        throw Error("Seller cannot purchase their own NFT");
      if(BigInt(quote.totalWei)!==listing.unitPriceWei*listing.quantity)
        throw Error("Order quote was changed");
      setConfirmed(null);
      const txHash=await wallet.submitMarketBuy(listing,signature);
      setHash(txHash);
      setStatus("Wallet submitted signed purchase transaction. Awaiting primary Testnet RPC receipt.");
      const result=await rpc.waitForTransactionReceipt({
        hash:txHash,confirmations:2,timeout:180000
      });
      if(result.status!=="success")throw Error("Purchase reverted; no NFT sale proved");
      const tx=await rpc.getTransaction({hash:txHash});
      if(tx.to?.toLowerCase()!==M7_MARKET_ADDRESS.toLowerCase()||
         tx.from.toLowerCase()!==wallet.address?.toLowerCase()||
         tx.value!==BigInt(quote.totalWei))
        throw Error("Buyer, marketplace or UOS value differs from reviewed order");
      const logs=parseEventLogs({abi:marketAbi,logs:result.logs,eventName:"ListingFilled"});
      const match=logs.find(e=>e.address.toLowerCase()===M7_MARKET_ADDRESS.toLowerCase()&&
        e.args.orderHash.toLowerCase()===selected.hash.toLowerCase()&&
        e.args.buyer.toLowerCase()===tx.from.toLowerCase()&&
        e.args.priceWei===tx.value&&e.args.feeWei===BigInt(quote.feeWei)&&
        e.args.royaltyWei===BigInt(quote.royaltyWei)&&
        e.args.sellerProceedsWei===BigInt(quote.sellerProceedsWei));
      if(!match)throw Error("Exact verified NFT sale event absent from transaction receipt");
      setConfirmed(txHash);
      setStatus("Primary-RPC receipt matched the signed order and exact fee split. Independent explorer and second RPC confirmation still required; not a verified marketplace sale.");
    });
  }
  function cancelMine(entry:Candidate){
    if(!authed||busy||entry.seller_wallet.toLowerCase()!==wallet.address?.toLowerCase()||
       process.env.NEXT_PUBLIC_M7_ENABLE_CANCELLATION!=="true")return;
    void run(async()=>{
      const tx=await wallet.cancelMarketNonce(BigInt(entry.nonce));
      setHash(tx);
      setStatus("Seller wallet submitted cancellation transaction. Awaiting primary Testnet receipt.");
      const receipt=await rpc.waitForTransactionReceipt({hash:tx,confirmations:2,timeout:180000});
      if(receipt.status!=="success")throw Error("Cancellation transaction failed");
      setStatus("Cancellation observed on primary RPC only. Reconcile independent RPC/Blockscout before journalling cancellation as final.");
    });
  }
  return <section className="interior creator-page">
    <p className="eyebrow">LOOKE NFT / ULTRA EVM TESTNET / MARKETPLACE</p>
    <h1>Fixed-price NFT market.</h1>
    {listingTarget&&<div className="creator-preflight" role="status">
      <h2>{listingTarget.tokenId?`List NFT #${listingTarget.tokenId} for sale`:"List a collection NFT for sale"}</h2>
      <p>Selected collection: <code>{listingTarget.collection}</code>{listingTarget.tokenId?` · Token #${listingTarget.tokenId}`:""}. Your selection is filled into the seller form below.</p>
      {gateList?<p><strong>Sales are not yet enabled.</strong> The listing form can preview terms, but cannot publish a live sell order until marketplace verification is complete. {gateList}</p>:<p>Connect the wallet that owns the token, review its price and terms, and complete the required marketplace approval and signing steps.</p>}
    </div>}
    <p className="interior-copy">Preview signed NFT offers, price and royalty terms with a wallet-scoped EIP-712 review. No NFT is escrowed; an unverified order row is not a live listing, trade or confirmation.</p>
    <p className="index-warning" role="status">
      {gateList || "Seller EIP-712 signatures require a separate explicit wallet approval."}
      {" · "}{gateBuy || "Purchasing requires a second explicit UOS transaction confirmation."}
    </p>
    <div className="studio-grid">
      <form id="seller-listing" className="creator-form" onSubmit={reviewSeller}>
        <h2>1. Seller order terms</h2>
        <div className="creator-form-grid">
          <label className="creator-wide">Collection contract<input value={draft.collection} placeholder="0x..." onChange={e=>edit("collection",e.target.value)}/></label>
          <label>Standard<select value={draft.standard} onChange={e=>edit("standard",e.target.value as "erc721"|"erc1155")}>
            <option value="erc721">ERC-721</option><option value="erc1155">ERC-1155</option>
          </select></label>
          <label>Token ID<input value={draft.tokenId} onChange={e=>edit("tokenId",e.target.value)} inputMode="numeric"/></label>
          <label>Quantity<input value={draft.quantity} onChange={e=>edit("quantity",e.target.value)} inputMode="numeric"/></label>
          <label>Price per token (UOS)<input value={draft.unitPriceUOS} onChange={e=>edit("unitPriceUOS",e.target.value)} inputMode="decimal"/></label>
          <label>Unique seller nonce<input value={draft.nonce} onChange={e=>edit("nonce",e.target.value)} inputMode="numeric"/></label>
          <label>Expiration (Unix seconds)<input value={draft.deadlineSeconds} placeholder="Within 90 days" onChange={e=>edit("deadlineSeconds",e.target.value)} inputMode="numeric"/></label>
          <label className="creator-wide">Reserved buyer (optional)<input value={draft.reservedBuyer} placeholder="Empty for public listing" onChange={e=>edit("reservedBuyer",e.target.value)}/></label>
          <label>Minimum proceeds (UOS)<input value={draft.minSellerProceedsUOS} onChange={e=>edit("minSellerProceedsUOS",e.target.value)} inputMode="decimal"/></label>
          <label>Maximum fee (bps)<input value={draft.maxFeeBps} onChange={e=>edit("maxFeeBps",e.target.value)} inputMode="numeric"/></label>
          <label>Maximum royalty (bps)<input value={draft.maxRoyaltyBps} onChange={e=>edit("maxRoyaltyBps",e.target.value)} inputMode="numeric"/></label>
        </div>
        <p className="wallet-note">Marketplace fee is 200 bps (2%). The collection may advertise ERC-2981 royalties (up to the signed maximum of 1,000 bps). Your minimum net proceeds cannot be reduced by the market without invalidating this signed listing.</p>
        <button className="primary-link" disabled={!authed||busy} type="submit">Review seller terms (no wallet action)</button>
        {preview&&<div className="creator-preflight">
          <h2>Draft — not signed</h2>
          <dl>
            <div><dt>Seller</dt><dd>{preview.seller}</dd></div>
            <div><dt>NFT</dt><dd>#{preview.tokenId.toString()} · quantity {preview.quantity.toString()}</dd></div>
            <div><dt>Total exact UOS value</dt><dd>{formatEther(preview.unitPriceWei*preview.quantity)} UOS</dd></div>
            <div><dt>Expiry</dt><dd>{new Date(Number(preview.deadline)*1000).toLocaleString()}</dd></div>
          </dl>
          <button className="primary-link" type="button"
            disabled={Boolean(gateList)||busy||!M7_LISTING_ENABLED}
            onClick={signAndRegister}>Sign exact EIP-712 order in my wallet</button>
        </div>}
      </form>
      <div className="creator-preflight">
        <h2>2. Read-only order candidates</h2>
        <p className="wallet-note">Every candidate must have a genuine seller signature. Ownership, approval, nonce, and UOS value must be checked on-chain again before a wallet purchase.</p>
        <div className="studio-action-row">
          <button className="secondary-link" onClick={()=>setScope("all")} disabled={busy}>Candidates</button>
          <button className="secondary-link" onClick={()=>setScope("mine")} disabled={busy}>My signed orders</button>
          <button className="secondary-link" onClick={()=>void loadCandidates()} disabled={busy||!authed}>Refresh</button>
        </div>
        {candidates.length ? <div className="studio-assets">
          {candidates.map(c=><article className="studio-asset" key={c.order_hash}>
            <div>
              <strong>{c.token_standard.toUpperCase()} · Token #{c.token_id} · {c.state.replaceAll("_"," ")}</strong>
              <p>{c.collection_address}</p>
              <p>Qty {c.quantity} · {formatEther(BigInt(c.unit_price_wei)*BigInt(c.quantity))} UOS · seller {c.seller_wallet}</p>
              <p>Expiry {new Date(c.deadline).toLocaleString()}</p>
              <button className="secondary-link" disabled={busy||!authed}
                onClick={()=>void reviewCandidate(c)}>Verify current signed offer (read-only)</button>
              {c.seller_wallet.toLowerCase()===wallet.address?.toLowerCase()&&
                <button className="secondary-link" disabled={busy||process.env.NEXT_PUBLIC_M7_ENABLE_CANCELLATION!=="true"}
                  onClick={()=>cancelMine(c)}>Cancel nonce in wallet</button>}
            </div>
          </article>)}
        </div> : <p className="wallet-note">No genuine signed listings have been registered. This is not simulated marketplace volume.</p>}
      </div>
    </div>
    {selected&&<section className="creator-preflight">
      <h2>3. Buyer wallet purchase review</h2>
      <p className="wallet-note">Primary Testnet RPC snapshot only; independent RPC, Blockscout finality and security review are still outstanding.</p>
      <dl>
        <div><dt>Order digest</dt><dd>{selected.hash}</dd></div>
        <div><dt>Seller / buyer</dt><dd>{selected.listing.seller} / {wallet.address||"not connected"}</dd></div>
        <div><dt>NFT contract / token</dt><dd>{selected.listing.collection} · #{selected.listing.tokenId.toString()}</dd></div>
        <div><dt>Quantity</dt><dd>{selected.listing.quantity.toString()}</dd></div>
        <div><dt>Total cost</dt><dd>{formatEther(BigInt(selected.quote.totalWei))} UOS (gas additional)</dd></div>
        <div><dt>Fixed marketplace fee</dt><dd>{formatEther(BigInt(selected.quote.feeWei))} UOS</dd></div>
        <div><dt>ERC-2981 royalty</dt><dd>{formatEther(BigInt(selected.quote.royaltyWei))} UOS · {selected.quote.royaltyRecipient}</dd></div>
        <div><dt>Seller proceeds</dt><dd>{formatEther(BigInt(selected.quote.sellerProceedsWei))} UOS</dd></div>
      </dl>
      <label className="creator-ack">
        <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
        I approve exactly this NFT contract, quantity, buyer account, UOS amount, fees, royalties and settlement conditions. A separate wallet signature is required.
      </label>
      <button className="primary-link" disabled={!ack||busy||!authed||Boolean(gateBuy)||!M7_SETTLEMENT_ENABLED}
        onClick={buy}>Confirm exact UOS purchase in wallet</button>
    </section>}
    <p className="wallet-note" role="status">{status}</p>
    {error&&<p className="index-warning" role="alert">{error}</p>}
    {hash&&<p className="index-warning">Submitted wallet transaction only: <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+hash} target="_blank" rel="noopener noreferrer">{hash}</a></p>}
    {confirmed&&<p className="index-warning">Primary RPC confirmation: {confirmed}. NOT independently verified sale evidence.</p>}
    <p className="wallet-note"><Link href="/studio">Creator studio</Link> · <Link href="/explore">Read-only NFT discovery</Link></p>
  </section>;
}
