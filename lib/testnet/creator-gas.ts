/**
 * Creator-only Testnet wallet transaction preflight. A normal NFT deployment
 * can consume millions of gas units but must not consume millions of UOS.
 * The app reads gas price directly from the official Ultra EVM Testnet RPC,
 * estimates the exact creation transaction and submits both numbers explicitly.
 * Reject broken wallet/RPC quotes instead of asking users to override fees.
 */
export const MAX_CREATOR_GAS_PRICE_WEI = 10_000_000_000_000n; // 0.00001 UOS/gas
export const MAX_CREATOR_GAS_LIMIT = 12_000_000n;
export const MAX_CREATOR_FEE_WEI = 50n * 10n ** 18n; // 50 Testnet UOS

export function safeCreatorDeploymentGas(estimate: bigint, gasPriceWei: bigint) {
 if (estimate < 21_000n || estimate > MAX_CREATOR_GAS_LIMIT)
  throw new Error("Ultra Testnet returned an invalid or excessively large deployment gas estimate. No wallet transaction was requested.");
 if (gasPriceWei <= 0n || gasPriceWei > MAX_CREATOR_GAS_PRICE_WEI)
  throw new Error("Ultra Testnet RPC returned an abnormally high gas price. Cancel any pending MetaMask request; do not override gas manually.");
 const gasLimit=(estimate*120n+99n)/100n;
 if (gasLimit > MAX_CREATOR_GAS_LIMIT || gasLimit*gasPriceWei > MAX_CREATOR_FEE_WEI)
  throw new Error("The estimated Ultra Testnet deployment fee exceeds the 50 UOS safety limit. No wallet transaction was requested.");
 return {gasLimit,gasPriceWei,maxFeeWei:gasLimit*gasPriceWei};
}

/** An owner-initiated free reserve mint must also avoid broken wallet gas quotes. */
export function safeCreatorMintGas(estimate: bigint, gasPriceWei: bigint) {
 if(estimate < 21_000n || estimate > 2_000_000n)
  throw new Error("Ultra Testnet returned an invalid NFT mint gas estimate.");
 if(gasPriceWei <= 0n || gasPriceWei > MAX_CREATOR_GAS_PRICE_WEI)
  throw new Error("Ultra Testnet RPC returned an unsafe NFT mint gas price.");
 const gasLimit=(estimate*120n+99n)/100n;
 if(gasLimit>2_000_000n || gasLimit*gasPriceWei>5n*10n**18n)
  throw new Error("Estimated NFT mint gas fee exceeds the 5 UOS safety limit.");
 return {gasLimit,gasPriceWei,maxFeeWei:gasLimit*gasPriceWei};
}
