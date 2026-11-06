import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import OperatorCreateNav from "@/components/OperatorCreateNav";
import { WalletSessionProvider } from "@/components/WalletSessionProvider";
import "./globals.css";
export const metadata:Metadata={
 title:"LookeNFT | Official Ultra EVM NFT Drops",
 description:"Explore operator-curated NFT collections on Ultra EVM. Wallet-confirmed minting opens only for approved drops.",
};
export default function RootLayout({children}:Readonly<{children:ReactNode}>){
 return <html lang="en"><body><WalletSessionProvider><div className="site-shell">
  <header className="site-header"><Link className="brand" href="/" aria-label="LookeNFT home">
   <span className="brand-symbol">L</span><span>Looke<span className="brand-nft">NFT</span></span>
  </Link><nav className="site-nav" aria-label="Navigation"><Link href="/explore">Collections</Link><OperatorCreateNav /></nav><WalletConnect /></header>
  <main id="content">{children}</main>
  <footer className="footer"><span>LookeNFT · Official curated NFT drops on Ultra EVM</span>
  <span>Testnet preview · No public minting without independent release approval</span></footer>
 </div></WalletSessionProvider></body></html>;
}
