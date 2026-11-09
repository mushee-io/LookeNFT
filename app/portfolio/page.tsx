import WalletOverview from "@/components/WalletOverview";
import IndexedHoldings from "@/components/IndexedHoldings";

export default function PortfolioPage() {
  return <section className="interior">
    <p className="eyebrow">YOUR WALLET / ULTRA EVM TESTNET</p>
    <h1>Indexed NFT ownership.</h1>
    <p className="interior-copy">Read-only holdings derived from indexed ERC-721 and ERC-1155 transfers. Coverage is limited to approved Testnet collections and the recorded block window.</p>
    <WalletOverview/>
    <div className="section">
      <h2>Observed holdings</h2>
      <IndexedHoldings/>
    </div>
  </section>;
}
