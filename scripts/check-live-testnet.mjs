// Read-only network health sample. Never asserts NFTs or wallet ownership.
import { mkdir, writeFile } from "node:fs/promises";
const outcome = {
  network: "Ultra EVM Testnet", chainIdExpected: 18881, status: "blocked",
  rpc: "https://evm.test.ultra.eosusa.io",
  explorer: "https://evmexplorer.testnet.ultra.io",
  checkedAt: new Date().toISOString()
};
try {
  const rpc = async (method, params = []) => {
    const response = await fetch(outcome.rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("RPC status " + response.status);
    const json = await response.json();
    if (json.error || !json.result) throw new Error("RPC returned error or no result: " + method);
    return json.result;
  };
  const chainId = Number.parseInt(await rpc("eth_chainId"), 16);
  if (chainId !== 18881) throw new Error("Wrong chain ID: " + chainId);
  const height = Number.parseInt(await rpc("eth_blockNumber"), 16);
  if (!Number.isSafeInteger(height) || height < 1) throw new Error("Invalid Testnet height");
  const comparedHeight = Math.max(1, height - 12);
  const block = await rpc("eth_getBlockByNumber", ["0x" + comparedHeight.toString(16), false]);
  if (typeof block?.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(block.hash))
    throw new Error("RPC block hash missing");
  Object.assign(outcome, { chainId, headBlock: height, comparedHeight, primaryBlockHash: block.hash });
  const gasPriceHex = await rpc("eth_gasPrice");
  const gasPriceWei = BigInt(gasPriceHex);
  const baseFeeWei = block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null;
  Object.assign(outcome, {
    gasPriceWei:gasPriceWei.toString(),
    gasPriceUosPerGas:(Number(gasPriceWei) / 1e18).toString(),
    baseFeeWei:baseFeeWei?.toString() ?? null,
    notes:"Read-only RPC network gas quote. No transaction or simulation was broadcast."
  });
  // One-time read-only investigation of a user-submitted Testnet deployment.
  // This is public blockchain data; it does not sign, send, or retry anything.
  const submittedHash = "0x320af6b0bc91d3ed56fae11f6129265e038adf77019e7f056c643f07f3d56c67";
  const receiptResult = await rpc("eth_getTransactionReceipt", [submittedHash]).catch(e=>null);
  const txResult = await rpc("eth_getTransactionByHash", [submittedHash]).catch(e=>null);
  outcome.penguinDeploymentDiagnostic = {
    hash:submittedHash,
    found:Boolean(receiptResult),
    receiptStatus:receiptResult?.status ?? null,
    receiptTo:receiptResult?.to ?? null,
    contractAddress:receiptResult?.contractAddress ?? null,
    receiptGasUsed:receiptResult?.gasUsed ?? null,
    transactionGas:txResult?.gas ?? null,
    txTo:txResult?.to ?? null,
    transactionBlockNumber:txResult?.blockNumber ?? null,
    transactionInputBytes:typeof txResult?.input==="string"?(txResult.input.length-2)/2:null,
    note:"Read-only Ultra Testnet public transaction diagnostic. Not an approval or new transaction."
  };
  console.log("PENGUIN_DEPLOYMENT_DIAGNOSTIC "+JSON.stringify(outcome.penguinDeploymentDiagnostic));
  const response = await fetch(outcome.explorer + "/api/v2/blocks/" + comparedHeight, {
    redirect: "error", signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Blockscout status " + response.status);
  const explorer = await response.json();
  if (typeof explorer.hash !== "string" || explorer.hash.toLowerCase() !== block.hash.toLowerCase())
    throw new Error("Blockscout and primary RPC block hashes differ");
  Object.assign(outcome, {
    status: "block-hash-matched", explorerBlockHash: explorer.hash,
    comment: "Block-only source health sample; not NFT, identity or independent RPC ownership proof"
  });
} catch (error) {
  Object.assign(outcome, {
    status: "blocked", reason: error instanceof Error ? error.message : String(error),
    noNftProof: true
  });
}
await mkdir(".artifacts", { recursive: true });
await writeFile(".artifacts/m3-network-check.json", JSON.stringify(outcome, null, 2) + "\n");
console.log(JSON.stringify(outcome));
if (outcome.status === "blocked") process.exitCode = 1;
