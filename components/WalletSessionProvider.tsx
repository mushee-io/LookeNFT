"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ACTIVE_NETWORK } from "@/lib/network";
import { describeWalletError, ensureChain, hexChain, validAccounts, type Eip1193Provider, type WalletOption } from "@/lib/wallet-provider";

type Session = { authenticated: boolean; wallet: string; chainId: number; expiresAt: string; profileId: string | null };
type WalletContextValue = {
  options: WalletOption[];
  address: string | null;
  chainId: number | null;
  authenticated: boolean;
  profileId: string | null;
  activeWallet: string | null;
  pending: boolean;
  error: string | null;
  pairingUri: string | null;
  connect: (optionId: string) => Promise<void>;
  connectWalletConnect: () => Promise<void>;
  signIn: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: () => Promise<void>;
  unlinkProfile: () => Promise<void>;
  dismissPairing: () => void;
};
const WalletContext = createContext<WalletContextValue | null>(null);

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "";

async function apiPost<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Request failed");
  return result as T;
}
async function apiSession(): Promise<Session | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return null;
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("authenticated" in result) || result.authenticated !== true) return null;
  return result as Session;
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const providerRef = useRef<Eip1193Provider | null>(null);
  const providerListeners = useRef<(() => void) | null>(null);
  const optionsRef = useRef<WalletOption[]>([]);
  const sequence = useRef(0);

  const addOption = useCallback((item: WalletOption) => {
    const next = [...optionsRef.current.filter((p) => p.id !== item.id), item];
    optionsRef.current = next;
    setOptions(next);
  }, []);

  const clearSession = useCallback(async () => {
    setSession(null);
    try { await apiPost("/api/auth/logout"); } catch { /* cookie may already be expired */ }
  }, []);

  const attachProvider = useCallback((provider: Eip1193Provider) => {
    providerListeners.current?.();
    providerRef.current = provider;
    const onAccounts = (...args: unknown[]) => {
      sequence.current += 1;
      setAddress(validAccounts(args[0])[0] ?? null);
      setSession(null);
      void apiPost("/api/auth/logout").catch(() => {});
    };
    const onChain = (...args: unknown[]) => {
      sequence.current += 1;
      setChainId(hexChain(args[0]));
      setSession(null);
      void apiPost("/api/auth/logout").catch(() => {});
    };
    const onDisconnect = () => {
      sequence.current += 1;
      setAddress(null);
      setChainId(null);
      setSession(null);
      void apiPost("/api/auth/logout").catch(() => {});
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    provider.on?.("disconnect", onDisconnect);
    providerListeners.current = () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, []);

  const restore = useCallback(async (option: WalletOption) => {
    if (!option.provider) return;
    const revision = ++sequence.current;
    attachProvider(option.provider);
    setActiveWallet(option.name);
    try {
      // eth_accounts is silent and returns only accounts previously authorised.
      const [accounts, activeChain, server] = await Promise.all([
        option.provider.request({ method: "eth_accounts" }),
        option.provider.request({ method: "eth_chainId" }),
        apiSession(),
      ]);
      if (revision !== sequence.current) return;
      const wallet = validAccounts(accounts)[0] ?? null;
      const chain = hexChain(activeChain);
      setAddress(wallet);
      setChainId(chain);
      if (wallet && chain === ACTIVE_NETWORK.chainId &&
          server?.wallet.toLowerCase() === wallet.toLowerCase() && server.chainId === chain) {
        setSession(server);
      } else if (server) {
        await clearSession();
      }
    } catch { /* Never silently prompt for wallet approval or sign a challenge. */ }
  }, [attachProvider, clearSession]);

  useEffect(() => {
    const announced = (event: Event) => {
      const detail = (event as CustomEvent<{
        info?: { uuid?: string; name?: string; rdns?: string };
        provider?: Eip1193Provider;
      }>).detail;
      if (!detail?.provider || typeof detail.info?.uuid !== "string") return;
      addOption({
        id: "6963:" + detail.info.uuid,
        name: detail.info.name?.slice(0, 70) || "Injected wallet",
        kind: "injected",
        provider: detail.provider,
      });
    };
    window.addEventListener("eip6963:announceProvider", announced);
    const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
    if (injected) addOption({ id: "injected:default", name: "Browser wallet", kind: "injected", provider: injected });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => {
      sequence.current += 1;
      window.removeEventListener("eip6963:announceProvider", announced);
      providerListeners.current?.();
    };
  }, [addOption]);

  useEffect(() => {
    // Do not re-request permissions after a reload. Restore a wallet only when
    // it is already present and eth_accounts gives an authorised account.
    const id = window.localStorage.getItem("lookenft:provider");
    if (id && !providerRef.current) {
      const known = options.find((p) => p.id === id);
      if (known) void restore(known);
    }
  }, [options, restore]);

  async function connected(option: WalletOption) {
    if (!option.provider) throw new Error("Wallet provider is not available");
    const revision = ++sequence.current;
    setPending(true);
    setError(null);
    try {
      const accounts = await option.provider.request({ method: "eth_requestAccounts" });
      const wallet = validAccounts(accounts)[0];
      if (!wallet) throw new Error("Wallet returned no valid EVM account");
      // Attach listeners only after a user-approved chain switch: its own
      // chainChanged event must not cancel the in-flight connect operation.
      await ensureChain(option.provider, ACTIVE_NETWORK);
      if (revision !== sequence.current) return;
      attachProvider(option.provider);
      const currentChain = hexChain(await option.provider.request({ method: "eth_chainId" }));
      if (revision !== sequence.current) return;
      setAddress(wallet);
      setChainId(currentChain);
      setActiveWallet(option.name);
      setSession(null);
      window.localStorage.setItem("lookenft:provider", option.id);
      await clearSession();
      setPairingUri(null);
    } catch (e) {
      if (revision === sequence.current) setError(describeWalletError(e));
    } finally {
      if (revision === sequence.current) setPending(false);
    }
  }

  async function connect(optionId: string) {
    const option = optionsRef.current.find((p) => p.id === optionId);
    if (!option) { setError("Wallet provider not found"); return; }
    await connected(option);
  }

  async function connectWalletConnect() {
    if (!walletConnectProjectId) {
      setError("WalletConnect needs a Reown Project ID configured by the operator.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      // Loaded only after a user click. No pairing or private key is created on mount.
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const provider = await EthereumProvider.init({
        projectId: walletConnectProjectId,
        optionalChains: [ACTIVE_NETWORK.chainId],
        showQrModal: false,
        rpcMap: { [ACTIVE_NETWORK.chainId]: ACTIVE_NETWORK.rpcUrl },
        metadata: {
          name: "Looke NFT",
          description: "Ultra EVM NFT marketplace wallet authentication",
          url: window.location.origin,
          icons: [],
        },
      });
      provider.on("display_uri", (uri: string) => setPairingUri(uri));
      await provider.enable();
      const option: WalletOption = { id: "walletconnect", name: "WalletConnect", kind: "walletconnect", provider: provider as Eip1193Provider };
      addOption(option);
      setPending(false);
      await connected(option);
    } catch (e) {
      setError(describeWalletError(e));
      setPending(false);
      setPairingUri(null);
    }
  }

  async function signIn() {
    const provider = providerRef.current;
    if (!provider || !address) { setError("Connect your wallet first"); return; }
    const revision = ++sequence.current;
    setPending(true);
    setError(null);
    try {
      const connectedAccounts = validAccounts(await provider.request({ method: "eth_accounts" }));
      const current = hexChain(await provider.request({ method: "eth_chainId" }));
      if (current !== ACTIVE_NETWORK.chainId || connectedAccounts[0]?.toLowerCase() !== address.toLowerCase())
        throw new Error("Wallet account or network changed. Reconnect before signing in.");
      const challenge = await apiPost<{ nonce: string; message: string; chainId: number }>("/api/auth/challenge", {
        address, chainId: ACTIVE_NETWORK.chainId,
      });
      if (challenge.chainId !== ACTIVE_NETWORK.chainId) throw new Error("Unexpected sign-in network");
      // EIP-191 personal_sign: signs a login message, never a financial transaction.
      const signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] });
      const verified = await apiPost<{ authenticated: boolean; wallet: string }>("/api/auth/verify", {
        address, nonce: challenge.nonce, signature,
      });
      if (!verified.authenticated || verified.wallet.toLowerCase() !== address.toLowerCase())
        throw new Error("Wallet authentication response mismatch");
      const fresh = await apiSession();
      if (revision !== sequence.current ||
          fresh?.wallet.toLowerCase() !== address.toLowerCase() || fresh.chainId !== ACTIVE_NETWORK.chainId) {
        await clearSession();
        return;
      }
      setSession(fresh);
    } catch (e) {
      if (revision === sequence.current) setError(describeWalletError(e));
    } finally {
      if (revision === sequence.current) setPending(false);
    }
  }

  async function switchNetwork() {
    if (!providerRef.current) { setError("Connect a wallet first"); return; }
    setPending(true);
    try {
      await ensureChain(providerRef.current, ACTIVE_NETWORK);
      setChainId(ACTIVE_NETWORK.chainId);
      await clearSession();
    } catch (e) { setError(describeWalletError(e)); }
    finally { setPending(false); }
  }

  async function disconnect() {
    ++sequence.current;
    const provider = providerRef.current;
    providerListeners.current?.();
    providerListeners.current = null;
    providerRef.current = null;
    setAddress(null);
    setChainId(null);
    setSession(null);
    setActiveWallet(null);
    setPairingUri(null);
    setError(null);
    window.localStorage.removeItem("lookenft:provider");
    try { await apiPost("/api/auth/logout"); } catch { /* server cookie expiry remains */ }
    try { await provider?.disconnect?.(); } catch { /* injected wallets may not support app disconnect */ }
  }

  async function unlinkProfile() {
    setPending(true);
    try {
      await apiPost("/api/profile/unlink");
      if (session) setSession({ ...session, profileId: null });
    } catch (e) { setError(describeWalletError(e)); }
    finally { setPending(false); }
  }

  return (
    <WalletContext.Provider value={{
      options, address, chainId, authenticated: Boolean(session), profileId: session?.profileId ?? null,
      activeWallet, pending, error, pairingUri, connect, connectWalletConnect, signIn, switchNetwork,
      disconnect, unlinkProfile, dismissPairing: () => setPairingUri(null),
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletSession(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("WalletSessionProvider missing");
  return context;
}
