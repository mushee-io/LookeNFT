"use client";

import { useEffect, useState } from "react";
import { ACTIVE_NETWORK, chainIdHex, isEvmAddress } from "@/lib/network";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function currentWallet(): EthereumProvider | undefined {
  return typeof window === "undefined" ? undefined : window.ethereum;
}

export default function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [wrongChain, setWrongChain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const provider = currentWallet();
    if (!provider) return;

    let mounted = true;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0];
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (mounted) setAddress(isEvmAddress(first) ? first : null);
    };
    const onChain = (...args: unknown[]) => {
      if (mounted) setWrongChain(args[0] !== chainIdHex(ACTIVE_NETWORK.chainId));
    };
    void provider.request({ method: "eth_accounts" }).then((result) => onAccounts(result)).catch(() => {});
    void provider.request({ method: "eth_chainId" }).then((result) => onChain(result)).catch(() => {});
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      mounted = false;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  async function ensureNetwork(provider: EthereumProvider) {
    const expected = chainIdHex(ACTIVE_NETWORK.chainId);
    const actual = await provider.request({ method: "eth_chainId" });
    if (actual !== expected) {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: expected }],
        });
      } catch (error: unknown) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? Number((error as { code: unknown }).code)
          : null;
        if (code !== 4902) throw error;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: expected,
            chainName: ACTIVE_NETWORK.name,
            rpcUrls: [ACTIVE_NETWORK.rpcUrl],
            blockExplorerUrls: [ACTIVE_NETWORK.explorerUrl],
            nativeCurrency: {
              name: "UOS", symbol: ACTIVE_NETWORK.currencySymbol, decimals: 18,
            },
          }],
        });
      }
    }
    const verified = await provider.request({ method: "eth_chainId" });
    setWrongChain(verified !== expected);
    if (verified !== expected) throw new Error("Wallet network does not match Ultra EVM");
  }

  async function connect() {
    const provider = currentWallet();
    if (!provider) {
      setMessage("Install an EVM-compatible browser wallet to connect.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (!isEvmAddress(first)) throw new Error("Wallet did not return a valid EVM address");
      await ensureNetwork(provider);
      setAddress(first);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Wallet connection was cancelled or failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wallet-container">
      <div className="wallet-actions">
        <span className="network-tag">{ACTIVE_NETWORK.name}</span>
        {address ? (
          <a className="wallet-button wallet-connected" href={ACTIVE_NETWORK.explorerUrl + "/address/" + address}
             target="_blank" rel="noopener noreferrer" title="View address in the official explorer">
            {address.slice(0, 6) + "…" + address.slice(-4)}
          </a>
        ) : (
          <button className="wallet-button" type="button" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect wallet"}
          </button>
        )}
        {address && wrongChain && (
          <button className="wallet-button" type="button" disabled={busy} onClick={connect}>Switch network</button>
        )}
      </div>
      {message && <p className="wallet-message" role="status">{message}</p>}
    </div>
  );
}
