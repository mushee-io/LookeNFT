"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { m7Gate } from "@/lib/m7/market";
import { useWalletSession } from "@/components/WalletSessionProvider";

export default function NFTSaleEntry({
  collection, tokenId, tokenName
}: { collection: string; tokenId: string; tokenName?: string }) {
  const dialogId = useId();
  const wallet = useWalletSession();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("1");
  const reason = m7Gate("list");
  const validPrice = /^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,18})?$/.test(price)
    && Number(price) > 0 && Number(price) <= 1000;
  const target = "/market?" + new URLSearchParams({ collection, tokenId, price }).toString() + "#seller-listing";

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const modal = open && typeof document !== "undefined" && createPortal(
    <>
      <div onClick={() => setOpen(false)} aria-hidden="true"
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",zIndex:9998}} />
      <div role="dialog" aria-modal="true" aria-label={"Sell NFT #" + tokenId}
        id={dialogId}
        style={{position:"fixed",left:"50%",top:"50%",transform:"translate(-50%,-50%)",
          width:"min(500px,calc(100vw - 28px))",maxHeight:"calc(100vh - 40px)",
          overflowY:"auto",padding:22,zIndex:9999,color:"#f5edf5",
          background:"#1d1523",border:"1px solid #6a425f",
          borderRadius:18,boxShadow:"0 25px 90px rgba(0,0,0,.65)",
          display:"grid",gap:13}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <h2 style={{fontSize:22,margin:0}}>List {tokenName || "NFT #" + tokenId}</h2>
          <button type="button" aria-label="Close NFT sale form"
            onClick={() => setOpen(false)}
            style={{border:0,borderRadius:8,background:"#332337",color:"#fff",padding:"8px 12px",cursor:"pointer"}}>
            Close ×
          </button>
        </div>
        <p style={{margin:0,fontSize:13}}>Token #{tokenId} · ERC-721 · Quantity 1</p>
        <p style={{margin:0,fontSize:12,overflowWrap:"anywhere"}}>Collection: {collection}</p>
        <label style={{display:"grid",gap:6,fontSize:14,fontWeight:600}}>
          Asking price (UOS)
          <input autoFocus inputMode="decimal" type="text" value={price}
            onChange={e => setPrice(e.target.value)}
            style={{width:"100%",padding:"12px",color:"#fff",background:"#120e17",
              border:"1px solid #70415f",borderRadius:8,fontSize:15}} />
        </label>
        {!validPrice && <p role="alert" style={{margin:0,color:"#ffb7cf",fontSize:13}}>
          Enter a price greater than 0 and no more than 1,000 UOS.
        </p>}
        {!wallet.address && <p style={{margin:0,fontSize:13}}>
          Connect the wallet holding this NFT before submitting a sale.
        </p>}
        {reason && <div role="status" style={{background:"#35212f",padding:12,
          border:"1px solid #70415f",borderRadius:9,fontSize:13,lineHeight:1.55}}>
          <strong>Live listings are not available yet.</strong> {reason}.
          You can prepare and review a sale, but signing or publishing an actual listing
          is disabled until the Testnet marketplace is independently verified.
        </div>}
        <p style={{margin:0,fontSize:12,color:"#bdb0c0"}}>
          Opening this form never transfers your NFT, charges gas or creates a listing.
        </p>
        {validPrice && <a href={target}
          style={{display:"block",background:"#f8549a",color:"#1c0a17",padding:"12px",
            fontWeight:750,textAlign:"center",borderRadius:10,textDecoration:"none"}}>
          {reason ? "Review sale terms (preview only) →" : "Continue to wallet-verified sale →"}
        </a>}
      </div>
    </>,
    document.body
  );

  return <>
    <button type="button" className="curated-sale-action" aria-expanded={open}
      aria-controls={dialogId} onClick={() => setOpen(true)}
      style={{border:0,background:"#f8549a",color:"#1b0a15",
        padding:"9px 10px",borderRadius:8,cursor:"pointer",
        fontWeight:700,textAlign:"left"}}>
      List NFT for sale ↗
    </button>
    {modal}
  </>;
}
