import { createPublicClient, http, type Address, type Hex } from "viem";
import { ACTIVE_NETWORK } from "@/lib/network";
import type { RpcLog } from "./events";

export type ChainBlock = { number: bigint; hash: Hex; parentHash: Hex };
export interface ChainReader {
  chainId(): Promise<number>;
  head(): Promise<bigint>;
  block(height: bigint): Promise<ChainBlock>;
  logs(height: bigint, addresses: Address[]): Promise<RpcLog[]>;
}

export function createChainReader(url = ACTIVE_NETWORK.rpcUrl): ChainReader {
  if (!url.startsWith("https://")) throw new Error("RPC requires HTTPS");
  const rpc = createPublicClient({ transport: http(url, { timeout: 12_000, retryCount: 1 }) });
  return {
    chainId: () => rpc.getChainId(),
    head: () => rpc.getBlockNumber(),
    async block(height) {
      const b = await rpc.getBlock({ blockNumber: height });
      if (!b.hash || b.number === null) throw new Error("RPC block has no canonical hash or height");
      return { number: b.number, hash: b.hash, parentHash: b.parentHash };
    },
    async logs(height, addresses) {
      if (addresses.length === 0) return [];
      // A single block, approved contract addresses only. Never scan unrestricted logs.
      const records = await rpc.getLogs({ address: addresses, fromBlock: height, toBlock: height });
      return records as RpcLog[];
    },
  };
}
