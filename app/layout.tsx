import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import "./globals.css";

export const metadata: Metadata = {
  title: "Looke NFT | Ultra EVM Marketplace",
  description: "A social-first Ultra EVM NFT marketplace. Testnet-first foundation; no live trading yet.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <Link className="brand" href="/" aria-label="Looke NFT homepage">
              <span className="brand-symbol">L</span><span>Looke<span className="brand-nft">NFT</span></span>
            </Link>
            <nav className="site-nav" aria-label="Main navigation">
              <Link href="/">Home</Link>
              <Link href="/explore">Explore</Link>
              <Link href="/create">Create</Link>
              <Link href="/portfolio">My NFTs</Link>
              <Link href="/activity">Activity</Link>
            </nav>
            <WalletConnect />
          </header>
          <main id="content">{children}</main>
          <footer className="footer">
            <span>Looke NFT · Ultra EVM only</span>
            <span>M1 foundation · No on-chain marketplace actions enabled</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
