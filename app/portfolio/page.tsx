import WalletOverview from "@/components/WalletOverview";

export default function PortfolioPage() {
  return (
    <section className="interior">
      <p className="eyebrow">YOUR WALLET / LOOKE NFT</p>
      <h1>One wallet. One verified identity.</h1>
      <p className="interior-copy">Your account session is isolated by wallet and Ultra EVM chain. A wallet connection alone is not an authenticated Looke session.</p>
      <WalletOverview />
    </section>
  );
}
