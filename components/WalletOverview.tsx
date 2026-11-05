"use client";

import { useWalletSession } from "@/components/WalletSessionProvider";
import { ACTIVE_NETWORK } from "@/lib/network";

export default function WalletOverview() {
  const wallet = useWalletSession();
  return (
    <div className="wallet-overview">
      <div className="wallet-overview-row">
        <span>Wallet address</span>
        <strong>{wallet.address ?? "Not connected"}</strong>
      </div>
      <div className="wallet-overview-row">
        <span>Wallet network</span>
        <strong>{wallet.chainId === ACTIVE_NETWORK.chainId ? ACTIVE_NETWORK.name : "Not verified"}</strong>
      </div>
      <div className="wallet-overview-row">
        <span>Account session</span>
        <strong>{wallet.authenticated ? "Signed in securely" : "Not authenticated"}</strong>
      </div>
      <div className="wallet-overview-row">
        <span>Looke Social profile</span>
        <strong>{wallet.profileId ? wallet.profileId : "Not verified / not linked"}</strong>
      </div>
      {wallet.authenticated && wallet.profileId &&
        <button type="button" className="secondary-link" disabled={wallet.pending}
          onClick={() => void wallet.unlinkProfile()}>Unlink Looke profile</button>}
      {!wallet.profileId &&
        <p className="wallet-note">Looke Social linking requires a separately verified, signed assertion from Looke Social. The identity issuer is not yet connected; entering a username is not proof of ownership.</p>}
      <p className="wallet-note">NFT balances and collections will appear after M3's independently verified indexer is live. No holdings are simulated.</p>
    </div>
  );
}
