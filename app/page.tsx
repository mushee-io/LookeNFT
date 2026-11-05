import Link from "next/link";

const modules = [
  { title: "Discover", description: "Explore verified NFT collections once on-chain indexing launches in M3." },
  { title: "Mint", description: "Create NFTs after contracts, media handling and wallet approvals are tested." },
  { title: "Trade", description: "Buy, list and make offers with UOS after audited marketplace settlement." },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">ULTRA EVM · TESTNET-FIRST</p>
          <h1>Culture belongs<br />to the creators.</h1>
          <p className="hero-subtitle">A simple NFT marketplace built for the Looke social experience: discover, collect, create and eventually trade in one place.</p>
          <div className="hero-actions">
            <Link className="primary-link" href="/explore">Explore marketplace <span aria-hidden="true">↗</span></Link>
            <Link className="secondary-link" href="/create">Creator studio</Link>
          </div>
        </div>
        <div className="hero-art" aria-label="Abstract decorative Looke artwork">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="hero-center">L<span>✦</span></div>
          <div className="hero-caption">Create · Collect · Connect</div>
        </div>
      </section>

      <section className="status-strip" aria-label="Current platform status">
        <div><strong>Ultra EVM</strong><span>Testnet by default</span></div>
        <div><strong>Wallet-ready</strong><span>Connection only</span></div>
        <div><strong>0</strong><span>Verified collections indexed</span></div>
        <div><strong>Not live</strong><span>Trading and minting</span></div>
      </section>

      <section className="section">
        <div className="section-head">
          <div><p className="eyebrow">THE MARKETPLACE</p><h2>Explore NFTs</h2></div>
          <Link className="inline-link" href="/explore">Open explore ↗</Link>
        </div>
        <div className="empty-state">
          <div className="empty-icon">◇</div>
          <h3>Verified collections will appear here.</h3>
          <p>No NFTs have been indexed yet. Looke will show real Ultra EVM assets only, not sample sales, prices or synthetic volume.</p>
        </div>
      </section>

      <section className="section modules">
        <div className="section-head"><div><p className="eyebrow">ONE SOCIAL EXPERIENCE</p><h2>Made for the Looke community</h2></div></div>
        <div className="module-grid">
          {modules.map((module, index) => (
            <article className="module-card" key={module.title}>
              <span className="module-number">0{index + 1}</span>
              <h3>{module.title}</h3><p>{module.description}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
