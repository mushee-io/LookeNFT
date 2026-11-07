import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import OperatorCreateNav from "@/components/OperatorCreateNav";
import { WalletSessionProvider } from "@/components/WalletSessionProvider";
import "./globals.css";
export const metadata:Metadata={
 title:"LookeNFT | Official Ultra EVM NFT Drops",
 description:"Create and explore creator-owned Ultra EVM Testnet NFT collections. Free minting is controlled by each contract owner and approved in your wallet.",
};
export default function RootLayout({children}:Readonly<{children:ReactNode}>){
 return <html lang="en"><body><WalletSessionProvider><div className="site-shell">
  <header className="site-header"><Link className="brand" href="/" aria-label="LookeNFT home">
   <span className="brand-symbol">L</span><span>Looke<span className="brand-nft">NFT</span></span>
  </Link><nav className="site-nav" aria-label="Navigation"><Link href="/explore">Collections</Link><OperatorCreateNav /><Link href="/testnet">Testnet</Link></nav><WalletConnect /></header>
  <main id="content">{children}</main>
  <footer className="footer"><span>LookeNFT · Official curated NFT drops on Ultra EVM</span>
  <span>Ultra EVM Testnet · Creator-enabled free minting with wallet approval</span></footer>
 </div></WalletSessionProvider></body></html>;
}
