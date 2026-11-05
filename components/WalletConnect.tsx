"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ACTIVE_NETWORK } from "@/lib/network";
import { useWalletSession } from "@/components/WalletSessionProvider";

export default function WalletConnect() {
  const wallet = useWalletSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrongNetwork = wallet.address !== null && wallet.chainId !== ACTIVE_NETWORK.chainId;

  return (
    <div className="wallet-container">
      <div className="wallet-actions">
        <span className="network-tag">{ACTIVE_NETWORK.name}</span>
        {wallet.address ? (
          <>
            <a className="wallet-button wallet-connected"
              href={ACTIVE_NETWORK.explorerUrl + "/address/" + wallet.address} target="_blank"
              rel="noopener noreferrer" aria-label="View connected wallet on explorer">
              {wallet.address.slice(0, 6) + "…" + wallet.address.slice(-4)}
            </a>
            {wrongNetwork ? (
              <button className="wallet-button" onClick={() => void wallet.switchNetwork()} disabled={wallet.pending}>Switch to Testnet</button>
            ) : !wallet.authenticated ? (
              <button className="wallet-button" onClick={() => void wallet.signIn()} disabled={wallet.pending}>
                {wallet.pending ? "Working…" : "Sign in"}
              </button>
            ) : <span className="wallet-authenticated">Signed in</span>}
            <button className="wallet-button wallet-disconnect" onClick={() => void wallet.disconnect()}
              disabled={wallet.pending} aria-label="Disconnect Looke NFT session">Disconnect</button>
          </>
        ) : (
          <button className="wallet-button" type="button" disabled={wallet.pending}
            onClick={() => setPickerOpen((old) => !old)}>
            {wallet.pending ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>

      {pickerOpen && !wallet.address && (
        <div className="wallet-picker" role="group" aria-label="Choose your wallet">
          <strong>Choose wallet</strong>
          {wallet.options.filter((p) => p.kind === "injected").map((p) => (
            <button key={p.id} className="wallet-choice" disabled={wallet.pending}
              onClick={() => { setPickerOpen(false); void wallet.connect(p.id); }}>{p.name}</button>
          ))}
          {wallet.options.filter((p) => p.kind === "injected").length === 0 &&
            <p>No browser wallet detected. Use a mobile wallet or install an EVM-compatible extension.</p>}
          <button className="wallet-choice" disabled={wallet.pending}
            onClick={() => { setPickerOpen(false); void wallet.connectWalletConnect(); }}>
            WalletConnect (QR / mobile)
          </button>
          <p className="wallet-note">WalletConnect requires an operator-configured Reown Project ID. Looke never asks for seed phrases.</p>
        </div>
      )}

      {wallet.pairingUri && (
        <div className="wallet-picker wallet-qr" role="dialog" aria-label="WalletConnect pairing">
          <strong>Scan with your wallet</strong>
          <QRCodeSVG value={wallet.pairingUri} size={186} level="M"/>
          <p className="wallet-note">Scan this QR with a supported mobile wallet. Check the domain before approving.</p>
          <button className="wallet-choice" onClick={wallet.dismissPairing}>Close QR</button>
        </div>
      )}
      {wallet.error && <p className="wallet-message" role="alert">{wallet.error}</p>}
    </div>
  );
}
