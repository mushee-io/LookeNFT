export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => unknown;
  disconnect?: () => Promise<void>;
};

export type WalletOption = {
  id: string;
  name: string;
  kind: "injected" | "walletconnect";
  provider: Eip1193Provider | null;
};

export function validAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a));
}

export function hexChain(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) return null;
  const chainId = Number.parseInt(value, 16);
  return Number.isSafeInteger(chainId) ? chainId : null;
}

export async function ensureChain(
  provider: Eip1193Provider,
  network: { chainId: number; name: string; rpcUrl: string; explorerUrl: string; currencySymbol: string },
): Promise<void> {
  const expected = "0x" + network.chainId.toString(16);
  const existing = await provider.request({ method: "eth_chainId" });
  if (hexChain(existing) === network.chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expected }] });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: expected,
        chainName: network.name,
        nativeCurrency: { name: "UOS", symbol: network.currencySymbol, decimals: 18 },
        rpcUrls: [network.rpcUrl],
        blockExplorerUrls: [network.explorerUrl],
      }],
    });
  }
  if (hexChain(await provider.request({ method: "eth_chainId" })) !== network.chainId)
    throw new Error("Wallet is not connected to the required Ultra EVM network");
}

export function describeWalletError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Wallet request failed";
  const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
  if (code === 4001) return "Request rejected in your wallet. Nothing was signed.";
  if (code === -32002) return "A wallet request is already pending. Open your wallet to review it.";
  return message.slice(0, 240);
}
