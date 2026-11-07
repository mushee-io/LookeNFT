"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ACTIVE_NETWORK } from "@/lib/network";
import { makeCancunProbeCreationCode } from "@/lib/testnet/probe";
import { safeCreatorDeploymentGas } from "@/lib/testnet/creator-gas";
import { createPublicClient, decodeFunctionData, encodeFunctionData, http, isAddress, toFunctionSelector, toHex, verifyTypedData, type Address, type Hex } from "viem";
import { mintAbi, mintCallAbi, requiredPayment } from "@/lib/m5/mint";
import { M7_MARKET_ADDRESS,marketAbi,marketTypes,listingDomain,hashListing,m7Gate,type Listing } from "@/lib/m7/market";
import {M8_VAULT,offerAbi,offerHash,offerTypes,offerDomain,m8Gate,verifyOfferEOA,type Offer} from "@/lib/m8/offers";
import {erc721Abi,erc1155Abi} from "@/lib/m7/market";
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
  submitTestnetProbe: () => Promise<Hex>;
  submitDirectNFTDeployment: (creationData: Hex) => Promise<Hex>;
  submitCreatorReserveMint: (collection: string, calldata: Hex) => Promise<Hex>;
  submitFactoryDeployment: (factoryAddress: string, calldata: Hex) => Promise<Hex>;
  submitMint: (collection: string, calldata: Hex, valueWei: bigint) => Promise<Hex>;
  signMarketListing: (listing: Listing) => Promise<Hex>;
  submitMarketBuy: (listing: Listing, signature: Hex) => Promise<Hex>;
  cancelMarketNonce: (nonce: bigint) => Promise<Hex>;
  signBuyerOffer: (offer: Offer) => Promise<Hex>;
  fundBuyerOffer: (offer: Offer, signature: Hex) => Promise<Hex>;
  acceptBuyerOffer: (offer: Offer) => Promise<Hex>;
  refundBuyerOffer: (offer: Offer) => Promise<Hex>;
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


  /** M4: the *only* wallet transaction surface. Disabled until operator release.
   * Wallet prompts the user to confirm each call; no auto-broadcast or keys.
   * A factory deployment itself remains a separate human-authorised operation.
   */
  /**
   * A tiny user-approved TESTNET ONLY Cancun probe. A real on-chain receipt is
   * checked separately; this function never claims a successful deployment.
   * No private keys, no arbitrary calldata or arbitrary recipient address.
   */
  async function submitTestnetProbe(): Promise<Hex> {
    if(ACTIVE_NETWORK.chainId!==18881)throw Error("Probe locked to Ultra EVM Testnet chain 18881");
    const provider=providerRef.current,wallet=address,rev=sequence.current;
    if(!provider||!wallet||!session||pending)throw Error("Connect and sign into Ultra EVM Testnet first");
    const [wallets,remoteChain,fresh]=await Promise.all([
      provider.request({method:"eth_accounts"}),
      provider.request({method:"eth_chainId"}),
      apiSession()
    ]);
    if(validAccounts(wallets)[0]?.toLowerCase()!==wallet.toLowerCase()||
       hexChain(remoteChain)!==18881||sequence.current!==rev||
       fresh?.wallet.toLowerCase()!==wallet.toLowerCase()||
       fresh?.chainId!==18881||session.wallet.toLowerCase()!==wallet.toLowerCase())
      throw Error("Wallet or authenticated Testnet session changed; aborting");
    setPending(true);
    try {
      const hash=await provider.request({
        method:"eth_sendTransaction",
        params:[{from:wallet,data:makeCancunProbeCreationCode(),value:"0x0"}]
      });
      if(typeof hash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw Error("Wallet did not return a canonical Testnet transaction hash");
      return hash as Hex;
    }finally{setPending(false);}
  }

  /**
   * Public creator actions: deployment and free creator-reserve mint only.
   * No platform operator key, no backend private key, no UOS payment.
   * The wallet must explicitly approve each Testnet transaction.
   */
  async function submitDirectNFTDeployment(creationData: Hex): Promise<Hex> {
    if (ACTIVE_NETWORK.chainId !== 18881)
      throw Error("NFT creation is restricted to Ultra EVM Testnet");
    if (!/^0x[0-9a-fA-F]{200,500000}$/.test(creationData))
      throw Error("Invalid NFT creation bytecode");
    const provider=providerRef.current,wallet=address,revision=sequence.current;
    if(!provider||!wallet||pending)throw Error("Connect your Testnet wallet to create an NFT");
    const [accounts,chain]=await Promise.all([
      provider.request({method:"eth_accounts"}),provider.request({method:"eth_chainId"})
    ]);
    if(validAccounts(accounts)[0]?.toLowerCase()!==wallet.toLowerCase() ||
       hexChain(chain)!==18881 || sequence.current!==revision)
      throw Error("Wallet or Ultra Testnet network changed; reconnect and retry");
    // Preflight against Ultra's canonical RPC instead of blindly accepting
    // MetaMask's suggested gas price (which has shown million-UOS quotes).
    // Wallet never opens for a failed simulation or an unsafe total gas fee.
    const rpc=createPublicClient({
      transport:http(ACTIVE_NETWORK.rpcUrl,{timeout:12000,retryCount:1})
    });
    const [rpcChain,estimatedGas,networkGasPrice]=await Promise.all([
      rpc.getChainId(),
      rpc.estimateGas({account:wallet as Address,data:creationData,value:0n}),
      rpc.getGasPrice()
    ]).catch((cause)=>{
      throw new Error("Ultra Testnet cannot safely estimate this NFT deployment. Do not bypass the fee warning: "+
        (cause instanceof Error?cause.message:String(cause)));
    });
    if(rpcChain!==18881||revision!==sequence.current)
      throw new Error("Ultra Testnet RPC or connected wallet changed during gas validation.");
    const safe=safeCreatorDeploymentGas(estimatedGas,networkGasPrice);
    setPending(true);
    try {
      const hash=await provider.request({
        method:"eth_sendTransaction",
        params:[{from:wallet,data:creationData,value:"0x0",
          gas:toHex(safe.gasLimit),gasPrice:toHex(safe.gasPriceWei)}]
      });
      if(typeof hash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw Error("Wallet returned an invalid NFT deployment transaction");
      return hash as Hex;
    }finally{setPending(false);}
  }

  async function submitCreatorReserveMint(collection: string, calldata: Hex): Promise<Hex> {
    if (ACTIVE_NETWORK.chainId !== 18881 || !isAddress(collection,{strict:false}))
      throw Error("Creator reserve mint is Ultra EVM Testnet-only");
    const allowedAbi=[
      {type:"function",name:"mintReserved",stateMutability:"nonpayable",
       inputs:[{name:"recipient",type:"address"}],outputs:[{name:"tokenId",type:"uint256"}]},
      {type:"function",name:"mintReserved",stateMutability:"nonpayable",
       inputs:[{name:"recipient",type:"address"},{name:"tokenId",type:"uint256"},{name:"quantity",type:"uint256"}],outputs:[]}
    ] as const;
    const decoded=decodeFunctionData({abi:allowedAbi,data:calldata});
    const provider=providerRef.current,wallet=address,revision=sequence.current;
    if(!provider||!wallet||pending)throw Error("Connect your Testnet wallet to mint");
    if(decoded.functionName!=="mintReserved" ||
       decoded.args[0]?.toLowerCase()!==wallet.toLowerCase() ||
       (decoded.args.length===3 && (decoded.args[1]!==1n||decoded.args[2]!==1n)))
      throw Error("Only a free self-mint to your own wallet is supported");
    const [accounts,chain]=await Promise.all([
      provider.request({method:"eth_accounts"}),provider.request({method:"eth_chainId"})
    ]);
    if(validAccounts(accounts)[0]?.toLowerCase()!==wallet.toLowerCase() ||
       hexChain(chain)!==18881 || sequence.current!==revision)
      throw Error("Wallet or Testnet network changed before mint");
    setPending(true);
    try{
      const hash=await provider.request({method:"eth_sendTransaction",
        params:[{from:wallet,to:collection,data:calldata,value:"0x0"}]});
      if(typeof hash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw Error("Wallet returned invalid free mint transaction");
      return hash as Hex;
    }finally{setPending(false);}
  }

  async function submitFactoryDeployment(factoryAddress: string, calldata: Hex): Promise<Hex> {
    if (process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED !== "true")
      throw new Error("Ultra EVM Testnet Cancun opcode compatibility is not operator-verified");
    if (process.env.NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT !== "true")
      throw new Error("M4 Testnet deployment gate is closed");
    if (ACTIVE_NETWORK.chainId !== 18881)
      throw new Error("M4 deployment is restricted to Ultra EVM Testnet");
    const approvedFactory = process.env.NEXT_PUBLIC_M4_FACTORY_ADDRESS || "";
    if (!isAddress(approvedFactory) ||
        factoryAddress.toLowerCase() !== approvedFactory.toLowerCase())
      throw new Error("Factory address is not operator-approved");
    const permitted = [
      toFunctionSelector("createERC721(string,string,string,uint256,address,uint96,bytes32)"),
      toFunctionSelector("createERC1155(string,uint256,uint256,address,uint96,bytes32)"),
    ];
    if (!/^0x[\da-fA-F]+$/.test(calldata) || !permitted.some(s => calldata.startsWith(s)))
      throw new Error("Unrecognised M4 factory method");
    const provider = providerRef.current;
    if (!provider || !address || !session || pending)
      throw new Error("Connect and sign in with the Testnet wallet first");
    const [wallets, connectedChain, fresh] = await Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
      apiSession(),
    ]);
    const matchingAccount = validAccounts(wallets)[0]?.toLowerCase() === address.toLowerCase();
    if (!matchingAccount || hexChain(connectedChain) !== 18881 ||
        fresh?.wallet.toLowerCase() !== address.toLowerCase() ||
        fresh.chainId !== 18881 || session.wallet.toLowerCase() !== address.toLowerCase()) {
      throw new Error("Connected wallet, network or server session changed");
    }
    setPending(true);
    try {
      // Explicit approval in wallet; the app never signs with a private key.
      const result = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: approvedFactory, data: calldata, value: "0x0" }],
      });
      if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result))
        throw new Error("Wallet returned no canonical transaction hash");
      return result as Hex;
    } finally {
      setPending(false);
    }
  }


  /** M5: every native-UOS payment requires a fresh explicit wallet approval.
   * Revalidate factory, collection, phase price, nonce and identity after review.
   */
  async function submitMint(collection: string, calldata: Hex, valueWei: bigint): Promise<Hex> {
    if (process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED !== "true" ||
        process.env.NEXT_PUBLIC_M5_ENABLE_MINTING !== "true")
      throw new Error("Real Testnet minting is disabled pending operator evidence");
    const factory = process.env.NEXT_PUBLIC_M4_FACTORY_ADDRESS || "";
    if (!isAddress(factory) || !isAddress(collection) || ACTIVE_NETWORK.chainId !== 18881)
      throw new Error("Mint factory, collection or Ultra Testnet configuration is invalid");
    if (valueWei < 0n || valueWei > 1000n * 10n ** 18n)
      throw new Error("Wallet payment exceeds M5 Testnet transaction safety limit (1000 UOS)");
    const decoded = decodeFunctionData({ abi: mintCallAbi, data: calldata });
    if (decoded.functionName !== "mintFromPhase" || !decoded.args)
      throw new Error("Only the reviewed mintFromPhase call is allowed");
    const [phaseId, , quantity, , , nonce] = decoded.args;
    const provider = providerRef.current;
    const expectedWallet = address;
    const rev = sequence.current;
    if (!provider || !expectedWallet || !session || pending)
      throw new Error("Explicitly connect and authenticate a Testnet wallet");
    const rpc = createPublicClient({
      transport: http(ACTIVE_NETWORK.rpcUrl, { timeout: 12_000, retryCount: 1 }),
    });
    const [rpcChain, version, registered, code, phase, chainNonce, wallets, walletChain, fresh] =
      await Promise.all([
        rpc.getChainId(),
        rpc.readContract({ address: factory, abi: [
          { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
        ] as const, functionName: "VERSION" }),
        rpc.readContract({ address: factory, abi: [
          { type: "function", name: "isCollection", stateMutability: "view", inputs: [{ name: "collection", type: "address" }], outputs: [{ type: "bool" }] },
        ] as const, functionName: "isCollection", args: [collection] }),
        rpc.getCode({ address: collection }),
        rpc.readContract({ address: collection, abi: mintAbi, functionName: "mintPhases", args: [phaseId] }),
        rpc.readContract({ address: collection, abi: mintAbi, functionName: "mintNonces", args: [phaseId, expectedWallet as Address] }),
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
        apiSession(),
      ]);
    if (rpcChain !== 18881 || (version !== 2n && version !== 3n) || !registered || !code || code === "0x")
      throw new Error("Collection is not deployed by the reviewed M5 factory on Ultra Testnet");
    const [,end,unitPrice,,,,,cancelled] = phase;
    if (cancelled || phaseId === 0n || nonce !== chainNonce || valueWei !== requiredPayment(unitPrice, quantity))
      throw new Error("Mint phase, account nonce or quoted UOS payment has changed");
    if (validAccounts(wallets)[0]?.toLowerCase() !== expectedWallet.toLowerCase() ||
        hexChain(walletChain) !== 18881 || sequence.current !== rev ||
        fresh?.wallet.toLowerCase() !== expectedWallet.toLowerCase() || fresh.chainId !== 18881 ||
        session.wallet.toLowerCase() !== expectedWallet.toLowerCase())
      throw new Error("Wallet, authenticated session or Testnet chain has changed");
    setPending(true);
    try {
      const tx = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: expectedWallet, to: collection, data: calldata, value: toHex(valueWei) }],
      });
      if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx))
        throw new Error("Wallet did not return a valid transaction hash");
      return tx as Hex;
    } finally {
      setPending(false);
    }
  }


  /** M7 source-verified, single-wallet EIP712 signing, OFF by default. */
  async function signMarketListing(listing: Listing): Promise<Hex> {
    const gate = m7Gate("list");
    if (gate || process.env.NEXT_PUBLIC_M7_ENABLE_LISTINGS!=="true")
      throw new Error(gate || "M7 listing signature creation disabled");
    const provider=providerRef.current, wallet=address, revision=sequence.current;
    if (!provider||!wallet||!session||pending||listing.seller.toLowerCase()!==wallet.toLowerCase())
      throw new Error("Explicitly connect and authenticate the listing seller");
    const market=M7_MARKET_ADDRESS as Address;
    const rpc=createPublicClient({transport:http(ACTIVE_NETWORK.rpcUrl,{timeout:12000,retryCount:1})});
    const [rpcChain,marketCode,marketVersion,walletAccounts,walletChain,fresh]=await Promise.all([
      rpc.getChainId(),rpc.getCode({address:market}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"VERSION"}),
      provider.request({method:"eth_accounts"}),provider.request({method:"eth_chainId"}),apiSession()
    ]);
    if (rpcChain!==18881||!marketCode||marketCode==="0x"||marketVersion!==1n||
      validAccounts(walletAccounts)[0]?.toLowerCase()!==wallet.toLowerCase()||
      hexChain(walletChain)!==18881||revision!==sequence.current||
      fresh?.wallet.toLowerCase()!==wallet.toLowerCase()||fresh?.chainId!==18881)
      throw new Error("Seller wallet, deployed market, authenticated session or chain changed");
    const domain=listingDomain(market);
    const typed={
      types:{
        EIP712Domain:[
          {name:"name",type:"string"},{name:"version",type:"string"},
          {name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}
        ],
        Listing:marketTypes.Listing
      },
      domain,primaryType:"Listing",message:listing
    };
    setPending(true);
    try{
      const signed=await provider.request({
        method:"eth_signTypedData_v4",
        params:[wallet,JSON.stringify(typed,(_k,value)=>typeof value==="bigint"?value.toString():value)]
      });
      if(typeof signed!=="string"||!/^0x[0-9a-fA-F]{130}$/.test(signed))
        throw new Error("Wallet did not return an EOA typed-data signature");
      const valid=await verifyTypedData({
        address:wallet as Address,domain,types:marketTypes,primaryType:"Listing",
        message:listing,signature:signed as Hex
      });
      if(!valid||sequence.current!==revision)throw new Error("Wallet signature or session changed during review");
      return signed as Hex;
    }finally{setPending(false);}
  }

  /** M7: separate user-approved purchase. No unattended native UOS settlement. */
  async function submitMarketBuy(listing:Listing,signature:Hex):Promise<Hex>{
    const gate=m7Gate("buy");
    if(gate||process.env.NEXT_PUBLIC_M7_ENABLE_SETTLEMENT!=="true")
      throw new Error(gate||"M7 financial execution disabled");
    const market=M7_MARKET_ADDRESS as Address;
    const provider=providerRef.current,wallet=address,revision=sequence.current;
    if(!provider||!wallet||!session||pending||ACTIVE_NETWORK.chainId!==18881||
      wallet.toLowerCase()===listing.seller.toLowerCase())
      throw new Error("Connect a different authenticated Testnet buyer wallet");
    if(!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new Error("Genuine seller signature required");
    const rpc=createPublicClient({transport:http(ACTIVE_NETWORK.rpcUrl,{timeout:12000,retryCount:1})});
    const [chain,code,version,onchainHash,fillable,quote,accounts,walletChain,fresh]=await Promise.all([
      rpc.getChainId(),rpc.getCode({address:market}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"VERSION"}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"hashListing",args:[listing]}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"isFillable",args:[listing,signature]}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"quote",args:[listing]}),
      provider.request({method:"eth_accounts"}),provider.request({method:"eth_chainId"}),apiSession()
    ]);
    if(chain!==18881||!code||code==="0x"||version!==1n||
      hashListing(listing,market).toLowerCase()!==onchainHash.toLowerCase()||!fillable)
      throw new Error("Market or signed NFT offer cannot be verified on real Testnet");
    const payment=listing.unitPriceWei*listing.quantity;
    if(payment!==quote[0]||payment===0n||payment>1000n*10n**18n||
      quote[1]+quote[3]+quote[4]!==payment||
      (listing.reservedBuyer!=="0x0000000000000000000000000000000000000000"&&
      listing.reservedBuyer.toLowerCase()!==wallet.toLowerCase()))
      throw new Error("NFT UOS pricing, fees, royalties or reserved buyer mismatch");
    if(validAccounts(accounts)[0]?.toLowerCase()!==wallet.toLowerCase()||
      hexChain(walletChain)!==18881||revision!==sequence.current||
      fresh?.wallet.toLowerCase()!==wallet.toLowerCase()||fresh?.chainId!==18881)
      throw new Error("Buyer wallet, chain or server session changed");
    const call=encodeFunctionData({abi:marketAbi,functionName:"buy",args:[listing,signature]});
    await rpc.simulateContract({
      address:market,abi:marketAbi,functionName:"buy",
      args:[listing,signature],account:wallet as Address,value:payment
    });
    if(sequence.current!==revision)throw new Error("Wallet changed before explicit purchase");
    setPending(true);
    try {
      const tx=await provider.request({
        method:"eth_sendTransaction",
        params:[{from:wallet,to:market,data:call,value:toHex(payment)}]
      });
      if(typeof tx!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(tx))
        throw new Error("Wallet returned no signed transaction hash");
      return tx as Hex;
    }finally{setPending(false);}
  }

  /** Explicit seller cancellation; separate operator-approved protective action. */
  async function cancelMarketNonce(nonce:bigint):Promise<Hex>{
    if(process.env.NEXT_PUBLIC_M7_ENABLE_CANCELLATION!=="true"||
      process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED!=="true"||
      ACTIVE_NETWORK.chainId!==18881||!isAddress(M7_MARKET_ADDRESS))
      throw new Error("M7 on-chain cancellation is disabled until verified Testnet operator approval");
    const provider=providerRef.current,wallet=address,revision=sequence.current;
    if(!provider||!wallet||!session||pending)throw new Error("Seller sign-in required");
    const market=M7_MARKET_ADDRESS as Address;
    const rpc=createPublicClient({transport:http(ACTIVE_NETWORK.rpcUrl,{timeout:12000,retryCount:1})});
    const [version,used,floor,accounts,walletChain,fresh]=await Promise.all([
      rpc.readContract({address:market,abi:marketAbi,functionName:"VERSION"}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"invalidNonces",args:[wallet as Address,nonce]}),
      rpc.readContract({address:market,abi:marketAbi,functionName:"minimumNonce",args:[wallet as Address]}),
      provider.request({method:"eth_accounts"}),provider.request({method:"eth_chainId"}),apiSession()
    ]);
    if(version!==1n||used||nonce<floor||
      validAccounts(accounts)[0]?.toLowerCase()!==wallet.toLowerCase()||
      hexChain(walletChain)!==18881||revision!==sequence.current||
      fresh?.wallet.toLowerCase()!==wallet.toLowerCase()||fresh?.chainId!==18881)
      throw new Error("Seller nonce, market or wallet/session preflight failed");
    setPending(true);
    try{
      const tx=await provider.request({
        method:"eth_sendTransaction",
        params:[{from:wallet,to:market,data:encodeFunctionData({
          abi:marketAbi,functionName:"cancelNonce",args:[nonce]
        }),value:"0x0"}]
      });
      if(typeof tx!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(tx))
        throw new Error("Cancellation wallet returned no transaction hash");
      return tx as Hex;
    }finally{setPending(false);}
  }


  async function checkM8Wallet(expected:string) {
    const provider=providerRef.current, wallet=address, rev=sequence.current;
    if(!provider||!wallet||!session||pending||wallet.toLowerCase()!==expected.toLowerCase()||
       ACTIVE_NETWORK.chainId!==18881||chainId!==18881)
      throw new Error("Explicit authenticated wallet and Ultra Testnet 18881 required");
    const rpc=createPublicClient({transport:http(ACTIVE_NETWORK.rpcUrl,{timeout:12000,retryCount:1})});
    const [network,version,code,accounts,providerChain,fresh]=await Promise.all([
      rpc.getChainId(),rpc.readContract({address:M8_VAULT as Address,abi:offerAbi,functionName:"VERSION"}),
      rpc.getCode({address:M8_VAULT as Address}),
      provider.request({method:"eth_accounts"}),provider.request({method:"eth_chainId"}),apiSession()
    ]);
    if(network!==18881||version!==1n||!code||code==="0x"||
       validAccounts(accounts)[0]?.toLowerCase()!==wallet.toLowerCase()||
       hexChain(providerChain)!==18881||sequence.current!==rev||
       fresh?.wallet.toLowerCase()!==wallet.toLowerCase()||fresh?.chainId!==18881||
       session.wallet.toLowerCase()!==wallet.toLowerCase())
      throw new Error("M8 vault, wallet, network or authenticated session failed preflight");
    return {provider,rpc,wallet:wallet as Address,rev};
  }
  async function signBuyerOffer(o:Offer):Promise<Hex>{
    const reason=m8Gate("sign");if(reason)throw new Error(reason);
    const {provider,wallet,rev}=await checkM8Wallet(o.buyer);
    const digest=offerHash(o,M8_VAULT as Address);
    setPending(true);
    try{
      const typed={domain:offerDomain(M8_VAULT as Address),primaryType:"Offer",
        types:{EIP712Domain:[
          {name:"name",type:"string"},{name:"version",type:"string"},
          {name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}
        ],Offer:offerTypes.Offer},message:o};
      const response=await provider.request({
        method:"eth_signTypedData_v4",
        params:[wallet,JSON.stringify(typed,(_k,v)=>typeof v==="bigint"?v.toString():v)]
      });
      if(typeof response!=="string"||!/^0x[0-9a-fA-F]{130}$/.test(response)||
         sequence.current!==rev||!await verifyOfferEOA(o,M8_VAULT as Address,response as Hex))
        throw new Error("Buyer EIP-712 signature or wallet session is invalid");
      if(!digest)throw new Error("Buyer order hash unavailable");
      return response as Hex;
    }finally{setPending(false);}
  }
  async function fundBuyerOffer(o:Offer,signature:Hex):Promise<Hex>{
    const reason=m8Gate("fund");if(reason)throw new Error(reason);
    if(!/^0x[0-9a-fA-F]{130}$/.test(signature)||
       !await verifyOfferEOA(o,M8_VAULT as Address,signature))
      throw new Error("Signed buyer consent required before exact UOS escrow funding");
    const {provider,rpc,wallet,rev}=await checkM8Wallet(o.buyer);
    const hash=offerHash(o,M8_VAULT as Address);
    const [onchain,used,nonce,floor]=await Promise.all([
      rpc.readContract({address:M8_VAULT as Address,abi:offerAbi,functionName:"offerHash",args:[o]}),
      rpc.readContract({address:M8_VAULT as Address,abi:offerAbi,functionName:"offerState",args:[hash]}),
      rpc.readContract({address:M8_VAULT as Address,abi:offerAbi,functionName:"fundedNonceHash",args:[wallet,o.nonce]}),
      rpc.readContract({address:M8_VAULT as Address,abi:offerAbi,functionName:"minimumNonce",args:[wallet]})
    ]);
    if(onchain.toLowerCase()!==hash.toLowerCase()||used!==0||nonce!=="0x"+"0".repeat(64)||
       floor>o.nonce||o.totalPriceWei<=0n||o.totalPriceWei>1000n*10n**18n)
      throw new Error("UOS bid already funded, nonce reused, or payment not within limit");
    await rpc.simulateContract({address:M8_VAULT as Address,abi:offerAbi,functionName:"fund",
      args:[o,signature],account:wallet,value:o.totalPriceWei});
    if(sequence.current!==rev)throw new Error("Buyer wallet changed before escrow deposit");
    setPending(true);
    try{
      const tx=await provider.request({method:"eth_sendTransaction",params:[{
        from:wallet,to:M8_VAULT,data:encodeFunctionData({abi:offerAbi,functionName:"fund",
          args:[o,signature]}),value:toHex(o.totalPriceWei)
      }]});
      if(typeof tx!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(tx))throw new Error("Wallet returned no deposit transaction hash");
      return tx as Hex;
    }finally{setPending(false);}
  }
  async function acceptBuyerOffer(o:Offer):Promise<Hex>{
    const reason=m8Gate("accept");if(reason)throw new Error(reason);
    const wallet=address;if(!wallet||wallet.toLowerCase()===o.buyer.toLowerCase()||
       (o.allowedSeller.toLowerCase()!=="0x"+"0".repeat(40)&&
        wallet.toLowerCase()!==o.allowedSeller.toLowerCase()))
      throw new Error("A genuine authorised NFT seller wallet must accept the buyer offer");
    const {provider,rpc,rev}=await checkM8Wallet(wallet);
    const vault=M8_VAULT as Address,hash=offerHash(o,vault);
    const [state,hashChain,quote,invalid,floor]=await Promise.all([
      rpc.readContract({address:vault,abi:offerAbi,functionName:"offerState",args:[hash]}),
      rpc.readContract({address:vault,abi:offerAbi,functionName:"offerHash",args:[o]}),
      rpc.readContract({address:vault,abi:offerAbi,functionName:"quote",args:[o]}),
      rpc.readContract({address:vault,abi:offerAbi,functionName:"invalidNonces",args:[o.buyer,o.nonce]}),
      rpc.readContract({address:vault,abi:offerAbi,functionName:"minimumNonce",args:[o.buyer]})
    ]);
    if(state!==1||hashChain.toLowerCase()!==hash.toLowerCase()||invalid||floor>o.nonce||
       quote[0]+quote[2]+quote[3]!==o.totalPriceWei)
      throw new Error("Funded buyer intent, nonce, royalty or exact UOS accounting changed");
    if(o.standard===1){
      const [owner,approved,operator]=await Promise.all([
        rpc.readContract({address:o.collection,abi:erc721Abi,functionName:"ownerOf",args:[o.tokenId]}),
        rpc.readContract({address:o.collection,abi:erc721Abi,functionName:"getApproved",args:[o.tokenId]}),
        rpc.readContract({address:o.collection,abi:erc721Abi,functionName:"isApprovedForAll",args:[wallet as Address,vault]})
      ]);
      if(owner.toLowerCase()!==wallet.toLowerCase()&&
         approved.toLowerCase()===vault.toLowerCase())throw new Error("NFT ownership changed");
      if(owner.toLowerCase()!==wallet.toLowerCase()||
        (!operator&&approved.toLowerCase()!==vault.toLowerCase()))
        throw new Error("Seller ownership or explicitly granted NFT transfer approval missing");
    }else if(o.standard===2){
      const [balance,operator]=await Promise.all([
        rpc.readContract({address:o.collection,abi:erc1155Abi,functionName:"balanceOf",args:[wallet as Address,o.tokenId]}),
        rpc.readContract({address:o.collection,abi:erc1155Abi,functionName:"isApprovedForAll",args:[wallet as Address,vault]})
      ]);
      if(balance<o.quantity||!operator)throw new Error("Seller ERC1155 balance or NFT operator approval missing");
    }else throw new Error("Unknown NFT standard");
    await rpc.simulateContract({address:vault,abi:offerAbi,functionName:"accept",args:[o],account:wallet as Address});
    if(sequence.current!==rev)throw new Error("Seller wallet changed before offer acceptance");
    setPending(true);
    try{
      const tx=await provider.request({method:"eth_sendTransaction",params:[{
        from:wallet,to:vault,
        data:encodeFunctionData({abi:offerAbi,functionName:"accept",args:[o]}),value:"0x0"
      }]});
      if(typeof tx!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(tx))
        throw new Error("Wallet did not approve NFT settlement");
      return tx as Hex;
    }finally{setPending(false);}
  }
  async function refundBuyerOffer(o:Offer):Promise<Hex>{
    const reason=m8Gate("refund");if(reason)throw new Error(reason);
    const {provider,rpc,wallet,rev}=await checkM8Wallet(o.buyer);
    const vault=M8_VAULT as Address;
    if(await rpc.readContract({address:vault,abi:offerAbi,functionName:"offerState",
      args:[offerHash(o,vault)]})!==1)throw new Error("No live escrowed buyer UOS to refund");
    await rpc.simulateContract({address:vault,abi:offerAbi,functionName:"refundTo",
      args:[o,wallet],account:wallet});
    if(sequence.current!==rev)throw new Error("Buyer changed before refund");
    setPending(true);
    try{
      const tx=await provider.request({method:"eth_sendTransaction",params:[{
        from:wallet,to:vault,data:encodeFunctionData({abi:offerAbi,functionName:"refundTo",
          args:[o,wallet]}),value:"0x0"
      }]});
      if(typeof tx!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(tx))throw new Error("Wallet did not approve refund");
      return tx as Hex;
    }finally{setPending(false);}
  }

  return (
    <WalletContext.Provider value={{
      options, address, chainId, authenticated: Boolean(session), profileId: session?.profileId ?? null,
      activeWallet, pending, error, pairingUri, connect, connectWalletConnect, signIn, switchNetwork,
      disconnect, unlinkProfile, submitTestnetProbe, submitDirectNFTDeployment, submitCreatorReserveMint, submitFactoryDeployment, submitMint, signMarketListing, submitMarketBuy, cancelMarketNonce, signBuyerOffer, fundBuyerOffer, acceptBuyerOffer, refundBuyerOffer, dismissPairing: () => setPairingUri(null),
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
