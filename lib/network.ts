/**
 * Ultra EVM network definitions (not Ultra Native/Uniqs).
 * Official reference: https://developers.ultra.io/tutorials/Ultra-EVM/Resources
 */
export type UltraNetwork = {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  currencySymbol: "UOS";
};

export const ULTRA_TESTNET: UltraNetwork = Object.freeze({
  chainId: 18881,
  name: "Ultra EVM Testnet",
  rpcUrl: "https://evm.test.ultra.eosusa.io",
  explorerUrl: "https://evmexplorer.testnet.ultra.io",
  currencySymbol: "UOS",
});

export const ULTRA_MAINNET: UltraNetwork = Object.freeze({
  chainId: 19991,
  name: "Ultra EVM Mainnet",
  rpcUrl: "https://evm.ultra.eosusa.io",
  explorerUrl: "https://evmexplorer.ultra.io",
  currencySymbol: "UOS",
});

/* Mainnet is opt-in only; M1 never submits on-chain transactions. */
export const ACTIVE_NETWORK =
  process.env.NEXT_PUBLIC_ULTRA_NETWORK === "mainnet"
    ? ULTRA_MAINNET
    : ULTRA_TESTNET;

export function chainIdHex(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid chain ID");
  }
  return "0x" + chainId.toString(16);
}

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}
