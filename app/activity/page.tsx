"use client";
import { useEffect, useState } from "react";

type Event = { collection: string; standard: string; tokenId: string; amount: string; from: string; to: string; txHash: string; block: string };
type ActivityResponse = { events?: Event[]; coverage?: { active: boolean; lastBlock: string }; error?: string };
export default function ActivityPage() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/nfts/activity", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const body = await r.json() as ActivityResponse;
        if (!r.ok) throw new Error(body.error || "Indexer unavailable");
        return body;
      }).then((body) => { if (!controller.signal.aborted) setData(body); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Indexer unavailable"); });
    return () => controller.abort();
  }, []);
  return <section className="interior">
    <p className="eyebrow">ON-CHAIN ACTIVITY / TESTNET</p>
    <h1>Only confirmed transfer events.</h1>
    <p className="interior-copy">Real, indexed ERC-721 and ERC-1155 token transfers only. Transfers do not prove NFT sales, trading volume, prices or royalties.</p>
    {error ? <p role="alert" className="index-warning">{error}</p> : !data ? <p>Loading read-only index…</p> :
      <><p className="index-warning">{data.coverage?.active ? "Indexed through block " + data.coverage.lastBlock : "Indexer not started; there is no coverage yet."}</p>
        {data.events?.length ? <div className="event-list">{data.events.map((event, index) =>
          <div className="event-entry" key={event.txHash + event.tokenId + index}>
            <div><strong>#{event.tokenId}</strong> · {event.standard.toUpperCase()} · {event.amount} item(s)
              <p>From {event.from.slice(0, 10)}… to {event.to.slice(0, 10)}… · Block {event.block}</p></div>
            <a href={"https://evmexplorer.testnet.ultra.io/tx/" + event.txHash}
              target="_blank" rel="noopener noreferrer">View transaction ↗</a>
          </div>)}</div> :
          <div className="empty-state interior-empty"><div className="empty-icon">◇</div>
            <h2>No indexed token transfers.</h2><p>No fabricated transfers or sales appear here.</p></div>}</>}
  </section>;
}
