"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Collection = {
  address: string; standard: string; deploymentBlock: string; observedTokenCount: string;
  observedTransferItems: string; sourceVerified: boolean; lastObservedBlock: string | null;
};
type Coverage = { active: boolean; startBlock: string | null; lastBlock: string | null; blockHash: string | null };
type Response = { chainId: number; collections: Collection[]; coverage: Coverage; error?: string };

export default function ExplorePage() {
  const [data, setData] = useState<Response | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/nfts/collections?q=" + encodeURIComponent(query), { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const json = await res.json() as Response;
        if (!res.ok) throw new Error(json.error || "Indexer service unavailable");
        return json;
      })
      .then((json) => { if (!controller.signal.aborted) setData(json); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Failed to read index"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);

  return (
    <section className="interior">
      <p className="eyebrow">MARKETPLACE / ULTRA EVM TESTNET</p>
      <h1>Discover on-chain collections.</h1>
      <p className="interior-copy">Only operator-registered contracts that pass Testnet bytecode and ERC-165 checks appear here. Listing does not imply a source-code audit or endorsement.</p>
      <label className="collection-search-label" htmlFor="collection-search">Search by contract address</label>
      <input id="collection-search" className="collection-search" placeholder="0x…"
        maxLength={42} value={query} onChange={(e) => setQuery(e.target.value)} />
      {loading ? <p role="status">Reading canonical index…</p> : error ?
        <div role="alert" className="index-warning">Indexer unavailable: {error}. No invented collections are displayed.</div> :
        <>
          <div className="index-warning" role="status">
            {data?.coverage.active
              ? "Indexed through Ultra EVM Testnet block " + data.coverage.lastBlock + ". Results are limited to the approved registry and configured historical start block."
              : "No verified indexing coverage yet. The absence of listings does not prove there are no Ultra EVM NFTs."}
          </div>
          {data?.collections.length ? (
            <div className="collection-grid">
              {data.collections.map((item) => (
                <article className="collection-card" key={item.address}>
                  <span className="collection-standard">{item.standard.toUpperCase()} · Testnet</span>
                  <h2>{item.address.slice(0, 10)}…{item.address.slice(-8)}</h2>
                  <p>Contract bytecode and interface checked. {item.sourceVerified ? "Source marked verified by operator." : "Source verification not evidenced."}</p>
                  <dl>
                    <div><dt>Observed tokens</dt><dd>{item.observedTokenCount}</dd></div>
                    <div><dt>Transfer items</dt><dd>{item.observedTransferItems}</dd></div>
                    <div><dt>First indexed from</dt><dd>Block {item.deploymentBlock}</dd></div>
                  </dl>
                  <div className="collection-links">
                    <Link href={"/collection/" + item.address}>View tokens</Link>
                    <a href={"https://evmexplorer.testnet.ultra.io/address/" + item.address}
                      rel="noopener noreferrer" target="_blank">Explorer ↗</a>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-state interior-empty">
            <div className="empty-icon">◇</div>
            <h2>No registered, indexed collections to show.</h2>
            <p>Collection registration and Testnet event indexing require real operator-selected contracts. No sample token inventory, floor prices or synthetic volume is inserted.</p>
          </div>}
        </>}
    </section>
  );
}
