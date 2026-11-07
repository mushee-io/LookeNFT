import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {MAX_CREATOR_FEE_WEI,safeCreatorDeploymentGas} from "../lib/testnet/creator-gas";

test("Normal Ultra Testnet quote for a large NFT deployment remains below fee limit",()=>{
  const quote=safeCreatorDeploymentGas(4_617_948n,1_500_000_000_000n);
  assert.equal(quote.gasPriceWei,1_500_000_000_000n);
  assert.equal(quote.gasLimit,5_541_538n);
  assert.ok(quote.maxFeeWei>0n);
  assert.ok(quote.maxFeeWei<MAX_CREATOR_FEE_WEI);
});
test("Prevent the MetaMask million-UOS gas quote",()=>{
  assert.throws(()=>safeCreatorDeploymentGas(4_617_948n,10n**18n),/abnormally high gas price/);
  assert.throws(()=>safeCreatorDeploymentGas(4_617_948n,0n),/abnormally high gas price/);
});
test("Refuse excessive cost or suspicious gas estimation even on Testnet",()=>{
  assert.throws(()=>safeCreatorDeploymentGas(5_000_000n,10_000_000_000_000n),/50 UOS safety limit/);
  assert.throws(()=>safeCreatorDeploymentGas(20_999n,1_500_000_000_000n),/invalid or excessively large/);
  assert.throws(()=>safeCreatorDeploymentGas(30_000_000n,1_500_000_000_000n),/invalid or excessively large/);
});
test("Live NFT deployment wallet requests explicit RPC gas and capped estimate",async()=>{
  const source=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
  const method=source.slice(source.indexOf("async function submitDirectNFTDeployment("),
                           source.indexOf("async function submitCreatorReserveMint("));
  assert.match(method,/rpc\.estimateGas/);
  assert.match(method,/rpc\.getGasPrice/);
  assert.match(method,/rpcChain!==18881/);
  assert.match(method,/safeCreatorDeploymentGas\(estimatedGas,networkGasPrice\)/);
  assert.match(method,/gas:toHex\(safe\.gasLimit\),gasPrice:toHex\(safe\.gasPriceWei\)/);
});
