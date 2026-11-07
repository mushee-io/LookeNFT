"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { m7Gate } from "@/lib/m7/market";
import { useWalletSession } from "@/components/WalletSessionProvider";

export default function NFTSaleEntry({
  collection, tokenId, tokenName
}: { collection: string; tokenId: string; tokenName?: string }) {
  const id = useId();
  const wallet = useWalletSession();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("1");
  const reason = m7Gate("list");
  const validPrice = /^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,18})?$/.test(price) &&
    Number(price) > 0 && Number(price) <= 1000;
  const target = "/market?" + new URLSearchParams({
    collection, tokenId, price
  }).toString() + "#seller-listing";
  return <div className="nft-sale-entry">
    <button type="button" className="curated-sale-action" aria-expanded={open}
      aria-controls={id} onClick={() => setOpen(v => !v)}>
      {open ? "Close sale form −" : "List NFT for sale ↗"}
    </button>
    {open && <div id={id} className="creator-preflight" role="region"
      aria-label={"Sale options for token " + tokenId}
      style={{marginTop:12,padding:14,display:"grid",gap:10}}>
      <h3 style={{margin:0}}>Sell {tokenName || "NFT #" + tokenId}</h3>
      <p style={{margin:0,fontSize:13}}>Collection: <code style={{overflowWrap:"anywhere"}}>{collection}</code></p>
      <p style={{margin:0,fontSize:13}}>Token #{tokenId} · ERC-721 · Quantity 1</p>
      <label style={{display:"grid",gap:5,fontSize:13}}>
        Asking price (UOS)
        <input aria-label={"Asking price in UOS for token " + tokenId}
          inputMode="decimal" value={price}
          onChange={e => setPrice(e.target.value)}
          style={{width:"100%",padding:"9px 12px",color:"inherit",background:"#1d1822",border:"1px solid #6d526b",borderRadius:6}} />
      </label>
      {!validPrice && <p role="alert" style={{margin:0,fontSize:12}}>Enter a price above 0 and at most 1,000 UOS.</p>}
      {!wallet.address && <p style={{margin:0,fontSize:12}}>Connect the wallet holding this NFT before submitting a sale.</p>}
      {reason && <p role="status" style={{margin:0,fontSize:13}}>
        <strong>Live listing unavailable:</strong> {reason}. You can review sale terms, but signing and publishing an actual sell order are disabled until the Testnet marketplace is verified.
      </p>}
      <p style={{margin:0,fontSize:12}}>No NFT is transferred or listed simply by opening this form.</p>
      {validPrice && <Link className="secondary-link" href={target} prefetch={false}>
        {reason ? "Review sale terms (preview only) →" : "Continue to wallet-verified seller form →"}
      </Link>}
    </div>}
  </div>;
}
