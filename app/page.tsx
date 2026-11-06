import Link from "next/link";
export default function HomePage(){
  return <section className="looke-landing" aria-labelledby="looke-landing-title">
    <div className="looke-landing-center">
      <div className="looke-hero-mark" aria-label="LookeNFT emblem"><span className="looke-logo-l">L</span><span className="looke-logo-spark">✦</span></div>
      <p className="looke-kicker">OFFICIAL NFT DROPS · ULTRA EVM</p>
      <h1 id="looke-landing-title">Collect what <span>comes next.</span></h1>
      <p className="looke-landing-copy">LookeNFT is the home for official collections. Browse curated drops, preview the artwork, and mint directly when a collection opens.</p>
      <p className="looke-landing-features">Official collections <span>·</span> Collection previews <span>·</span> Wallet-approved minting</p>
      <div className="looke-landing-actions">
        <Link href="/explore" className="looke-landing-primary">Enter NFT Market <span aria-hidden="true">↗</span></Link>
      </div>
      <p className="looke-landing-notice">Ultra EVM Testnet preview · Only the LookeNFT operator publishes drops · Minting remains gated</p>
    </div>
    <div className="looke-landing-bottom">
      <span>Curated by LookeNFT. Mint only when a drop is officially opened.</span>
      <div className="looke-landing-bottom-links"><Link href="/explore">Browse collections</Link><Link href="/final-acceptance">Release status</Link></div>
    </div>
  </section>;
}
