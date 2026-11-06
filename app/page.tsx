import Link from "next/link";

export default function HomePage() {
  return (
    <section className="looke-landing" aria-labelledby="looke-landing-title">
      <div className="looke-landing-center">
        <div className="looke-hero-mark" aria-label="LookeNFT emblem">
          <span className="looke-logo-l">L</span><span className="looke-logo-spark">✦</span>
        </div>
        <p className="looke-kicker">AN NFT MARKETPLACE FOR ULTRA EVM</p>
        <h1 id="looke-landing-title">A new home for <span>NFT culture.</span></h1>
        <p className="looke-landing-copy">Discover collections, create NFTs, and connect with creators. The LookeNFT marketplace is taking shape on Ultra EVM.</p>
        <p className="looke-landing-features">Discover collections <span>·</span> Creator studio <span>·</span> Listings &amp; offers <span>·</span> Wallet-owned NFTs</p>
        <div className="looke-landing-actions">
          <Link href="/explore" className="looke-landing-primary">Explore NFTs <span aria-hidden="true">↗</span></Link>
          <Link href="/create" className="looke-landing-secondary">Creator studio <span aria-hidden="true">↗</span></Link>
        </div>
        <p className="looke-landing-notice">Testnet preview · Marketplace settlement and public trading are not live · Release NO-GO</p>
      </div>
      <div className="looke-landing-bottom">
        <span>Built for creators and collectors on Ultra EVM.</span>
        <div className="looke-landing-bottom-links">
          <Link href="/market">Marketplace</Link>
          <Link href="/portfolio">My NFTs</Link>
          <Link href="/final-acceptance">Release status</Link>
        </div>
      </div>
    </section>
  );
}
