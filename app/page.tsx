import Link from "next/link";
export default function HomePage(){
  return <section className="looke-landing" aria-labelledby="looke-landing-title">
    <div className="looke-landing-center">
      <div className="looke-hero-mark" aria-label="LookeNFT emblem"><span className="looke-logo-l">L</span><span className="looke-logo-spark">✦</span></div>
      <p className="looke-kicker">OPEN NFT COLLECTIONS · ULTRA EVM TESTNET</p>
      <h1 id="looke-landing-title">Collect what <span>comes next.</span></h1>
      <p className="looke-landing-copy">Create and explore creator-owned collections on Ultra EVM Testnet. Every real deployment requires your own connected wallet and explicit signature.</p>
      <p className="looke-landing-features">Creator collections <span>·</span> Public Testnet creation <span>·</span> Wallet-approved transactions</p>
      <div className="looke-landing-actions">
        <Link href="/explore" className="looke-landing-primary">Enter NFT Market <span aria-hidden="true">↗</span></Link>
        <Link href="/create" className="looke-landing-create">+ Create NFT Collection</Link>
      </div>
      <p className="looke-landing-notice">Ultra EVM Testnet · Public creation requires a verified permissionless factory · Minting remains separately gated</p>
    </div>
    <div className="looke-landing-bottom">
      <span>Community Testnet collections are creator-owned, not endorsed or audited by LookeNFT.</span>
      <div className="looke-landing-bottom-links"><Link href="/explore">Browse collections</Link></div>
    </div>
  </section>;
}
