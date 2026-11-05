"use client";

import { useEffect, useState } from "react";
import { useWalletSession } from "@/components/WalletSessionProvider";
import { ACTIVE_NETWORK } from "@/lib/network";
type Holding = { collection: string; standard: string; tokenId: string; balance: string; lastBlock: string; lastTxHash: string | null };
type Result = { coverage?: { active: boolean; startBlock: string; lastBlock: string }; holdings?: Holding[]; error?: string };

export default function IndexedHoldings() {
  const wallet = useWalletSession();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = wallet.address && wallet.chainId === ACTIVE_NETWORK.chainId;
  useEffect(() => {
    if (!available) return;
    const abort = new AbortController();
    setBusy(true); setError(null); setResult(null);
    fetch("/api/nfts/ownership?address=" + encodeURIComponent(wallet.address!), { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        const json = await r.json() as Result;
        if (!r.ok) throw new Error(json.error || "Ownership index unavailable");
        return json;
      }).then((r) => { if (!abort.signal.aborted) setResult(r); })
      .catch((e: unknown) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Ownership unavailable"); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [available, wallet.address]);

  if (!available) return <p className="index-warning">Connect an Ultra EVM Testnet account to see its indexed NFT ownership.</p>;
  if (busy) return <p role="status">Reading indexed Testnet holdings…</p>;
  if (error) return <p role="alert" className="index-warning">{error}. No zero balance is inferred.</p>;
  if (!result?.coverage?.active) return <p className="index-warning">NFT ownership coverage is not established. Wallet holdings are unknown.</p>;
  if (!result.holdings?.length) return <p className="index-warning">No holdings observed within the indexed contracts and block window. This is not a full-wallet NFT balance.</p>;
  return <div className="collection-grid">
    {result.holdings.map((h) => <article key={h.collection + "/" + h.tokenId} className="collection-card">
      <span className="collection-standard">{h.standard.toUpperCase()} · Read-only</span>
      <h2>Token #{h.tokenId}</h2>
      <p>Collection: {h.collection}</p>
      <dl><div><dt>Indexed balance</dt><dd>{h.balance}</dd></div><div><dt>Last observed block</dt><dd>{h.lastBlock}</dd></div></dl>
      <a href={"https://evmexplorer.testnet.ultra.io/address/" + h.collection}
        target="_blank" rel="noopener noreferrer">Contract explorer ↗</a>
    </article>)}
  </div>;
}
