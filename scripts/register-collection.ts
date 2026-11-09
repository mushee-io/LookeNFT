/**
 * Operator-only CLI (never exposed as an unauthenticated HTTP endpoint).
 * Verifies deployed bytecode and ERC-165 interface support on Ultra EVM Testnet.
 * NOT a source-code verification, security audit or mainnet approval.
 */
import { createPublicClient, getAddress, http, isAddress, keccak256, parseAbi, type Address } from "viem";
import { getDb, inTransaction } from "../lib/server/db";

const ERC165_ABI = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const RPC_URL = "https://evm.test.ultra.eosusa.io";

async function main() {
  if (process.env.NEXT_PUBLIC_ULTRA_NETWORK !== "testnet") throw new Error("Only Ultra EVM Testnet registry is supported");
  const input = process.env.NFT_COLLECTION_ADDRESS || "";
  const standard = process.env.NFT_COLLECTION_STANDARD;
  const blockText = process.env.NFT_DEPLOYMENT_BLOCK || "";
  if (!isAddress(input, { strict: false }) || !["erc721", "erc1155"].includes(standard || "") ||
      !/^\d+$/.test(blockText) || BigInt(blockText) < 1n) {
    throw new Error("Provide NFT_COLLECTION_ADDRESS, NFT_COLLECTION_STANDARD (erc721/erc1155), NFT_DEPLOYMENT_BLOCK");
  }
  const address = getAddress(input) as Address;
  const deploymentBlock = BigInt(blockText);
  const client = createPublicClient({ transport: http(RPC_URL, { timeout: 12_000, retryCount: 1 }) });
  if (await client.getChainId() !== 18881) throw new Error("Operator RPC returned wrong network");
  const head = await client.getBlockNumber();
  if (deploymentBlock > head - 12n) throw new Error("Deployment block is not 12 confirmations deep");
  const historicalCode = await client.getCode({ address, blockNumber: deploymentBlock });
  const code = await client.getCode({ address, blockNumber: head - 12n });
  if (!historicalCode || historicalCode === "0x" || !code || code === "0x") throw new Error("Contract bytecode is absent at claimed deployment or confirmed block");
  const interfaceId = standard === "erc721" ? "0x80ac58cd" : "0xd9b67a26";
  const supports = await client.readContract({ address, abi: ERC165_ABI, functionName: "supportsInterface", args: [interfaceId] });
  if (!supports) throw new Error("Contract does not declare required ERC-165 NFT interface");
  const codeHash = keccak256(code);
  await inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [18881]);
    const state = await db.query<{ start_block: string; last_block: string }>(
      "SELECT start_block,last_block FROM nft_indexer_state WHERE chain_id=18881",
    );
    if (state.rows[0] && deploymentBlock <= BigInt(state.rows[0].last_block)) {
      throw new Error("Deployment precedes indexed cursor. Reindex from an earlier anchor before registering this collection");
    }
    await db.query(
      `INSERT INTO nft_collections
       (chain_id,contract_address,token_standard,deployment_block,code_hash,checked_block,source_verified,operator_evidence)
       VALUES(18881,$1,$2,$3,$4,$5,FALSE,$6)`,
      [address.toLowerCase(), standard, deploymentBlock.toString(), codeHash,
        (head - 12n).toString(), "https://evmexplorer.testnet.ultra.io/address/" + address],
    );
  });
  console.log(JSON.stringify({
    chainId: 18881, address: address.toLowerCase(), standard, deploymentBlock: deploymentBlock.toString(),
    codeHash, bytecodePresent: true, declaredNftInterface: true,
    sourceVerified: false, independentAudit: false,
  }));
}

main().catch((error) => {
  console.error("Collection not registered:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}).finally(async () => { await getDb().end().catch(() => {}); });
