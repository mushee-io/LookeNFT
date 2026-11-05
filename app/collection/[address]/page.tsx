"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
type Token = { tokenId: string; standard: string; lastObservedBlock: string; lastTxHash: string };
type Result = { tokens?: Token[]; coverage?: { active: boolean; lastBlock: string }; error?: string };
export default function CollectionDetail() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/nfts/tokens?collection=" + encodeURIComponent(address), { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const result = await r.json() as Result; if (!r.ok) throw new Error(result.error || "No indexed collection"); return result; })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Index unavailable"); });
    return () => controller.abort();
  }, [address]);
  return <section className="interior">
    <p className="eyebrow">COLLECTION / VERIFIED EVENT INDEX</p>
    <h1>Collection tokens</h1>
    <p className="interior-copy">{address}</p>
    <p className="index-warning">Read-only Ultra EVM Testnet events. An observed token is not an offered NFT, a verified sale or an audited contract.</p>
    <Link href="/explore" className="inline-link">← Explore collections</Link>
    {error ? <p role="alert">{error}</p> : !data ? <p>Reading on-chain index…</p> :
      data.tokens?.length ? <div className="collection-grid collection-details">
        {data.tokens.map((t) => <article className="collection-card" key={t.tokenId}>
          <span className="collection-standard">{t.standard.toUpperCase()}</span>
          <h2>Token #{t.tokenId}</h2><p>Last observed block {t.lastObservedBlock}</p>
          <a target="_blank" rel="noopener noreferrer" href={"https://evmexplorer.testnet.ultra.io/tx/" + t.lastTxHash}>
            Independent explorer ↗
          </a>
        </article>)}
      </div> : <div className="empty-state interior-empty"><h2>No observed tokens in indexed history.</h2>
        <p>There is no simulated minting, artwork, balance, activity or listing.</p></div>}
  </section>;
}
