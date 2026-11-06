import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { WalletSessionProvider } from "@/components/WalletSessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Looke NFT | Ultra EVM Marketplace",
  description: "A social-first Ultra EVM NFT marketplace. Testnet-first wallet authentication; trading is not live.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletSessionProvider>
          <div className="site-shell">
            <header className="site-header">
              <Link className="brand" href="/" aria-label="Looke NFT homepage">
                <span className="brand-symbol">L</span><span>Looke<span className="brand-nft">NFT</span></span>
              </Link>
              <nav className="site-nav" aria-label="Main navigation">
                <Link href="/">Home</Link><Link href="/explore">Explore</Link>
                <Link href="/create">Create</Link><Link href="/mint">Mint</Link><Link href="/portfolio">My NFTs</Link>
                <Link href="/activity">Activity</Link>
              </nav>
              <WalletConnect />
            </header>
            <main id="content">{children}</main>
            <footer className="footer">
              <span>Looke NFT · Ultra EVM only</span>
              <span>M5 minting groundwork · Payments and public launch disabled by default</span>
            </footer>
          </div>
        </WalletSessionProvider>
      </body>
    </html>
  );
}
