import { decodeEventLog, parseAbiItem, type Hex } from "viem";

export type TokenStandard = "erc721" | "erc1155";
export const E721 = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
export const E1155_SINGLE = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
export const E1155_BATCH = parseAbiItem("event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)");

export type RpcLog = {
  address: string; blockNumber: bigint | null; blockHash: Hex | null;
  transactionHash: Hex | null; transactionIndex: number | null;
  logIndex: number | null; topics: readonly Hex[]; data: Hex;
};
export type Transfer = {
  contract: string; standard: TokenStandard; blockNumber: bigint; blockHash: string;
  txHash: string; txIndex: number; logIndex: number; itemIndex: number;
  tokenId: string; from: string; to: string; amount: string;
};
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

function address(value: unknown): string {
  if (typeof value !== "string" || !EVM_ADDRESS.test(value)) throw new Error("Malformed indexed address");
  return value.toLowerCase();
}
function amount(value: unknown): string {
  if (typeof value !== "bigint" || value < 0n || value.toString().length > 78)
    throw new Error("Malformed or oversized indexed token quantity");
  return value.toString();
}
export function decodeTransfers(log: RpcLog, standard: TokenStandard): Transfer[] {
  if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null ||
      log.transactionIndex === null || log.logIndex === null ||
      log.blockNumber < 0n || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 ||
      !Number.isSafeInteger(log.transactionIndex) || log.transactionIndex < 0 ||
      !EVM_HASH.test(log.blockHash) || !EVM_HASH.test(log.transactionHash)) {
    throw new Error("Incomplete or malformed RPC transfer log");
  }
  const abi = standard === "erc721" ? [E721] : [E1155_SINGLE, E1155_BATCH];
  let decoded: { eventName: string; args: unknown };
  try {
    decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }) as unknown as {
      eventName: string; args: unknown;
    };
  } catch {
    // A whitelisted contract may emit unrelated events; only decode known transfer selectors.
    return [];
  }
  const args = decoded.args as Record<string, unknown>;
  const from = address(args.from), to = address(args.to);
  const values: Array<{ tokenId: string; quantity: string }> = [];
  if (standard === "erc721" && decoded.eventName === "Transfer") {
    values.push({ tokenId: amount(args.tokenId), quantity: "1" });
  } else if (standard === "erc1155" && decoded.eventName === "TransferSingle") {
    values.push({ tokenId: amount(args.id), quantity: amount(args.value) });
  } else if (standard === "erc1155" && decoded.eventName === "TransferBatch") {
    if (!Array.isArray(args.ids) || !Array.isArray(args.values) ||
        args.ids.length !== args.values.length || args.ids.length > 512)
      throw new Error("Invalid ERC-1155 transfer batch");
    args.ids.forEach((id, i) => values.push({ tokenId: amount(id), quantity: amount((args.values as unknown[])[i]) }));
  } else return [];
  return values.map((value, itemIndex) => ({
    contract: address(log.address), standard, blockNumber: log.blockNumber!,
    blockHash: log.blockHash!.toLowerCase(), txHash: log.transactionHash!.toLowerCase(),
    txIndex: log.transactionIndex!, logIndex: log.logIndex!, itemIndex,
    tokenId: value.tokenId, from, to, amount: value.quantity,
  }));
}
