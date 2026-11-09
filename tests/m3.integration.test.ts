import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { getDb } from "../lib/server/db";
import { E721, E1155_SINGLE, E1155_BATCH, type RpcLog } from "../lib/indexer/events";
import { scanOnce } from "../lib/indexer/sync";
import { getOwnership, indexerCoverage, listCollections } from "../lib/indexer/query";
import { listCollectionTokens } from "../lib/indexer/query-tokens";
import { verifyIndependentSources } from "../lib/indexer/verify";
import type { ChainReader, ChainBlock } from "../lib/indexer/reader";

const NFT721 = ("0x" + "1".repeat(40)) as Address;
const NFT1155 = ("0x" + "2".repeat(40)) as Address;
const ALICE = ("0x" + "a".repeat(40)) as Address;
const BOB = ("0x" + "b".repeat(40)) as Address;
const ZERO = ("0x" + "0".repeat(40)) as Address;
const txHash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const hash = (n: number, fork = false) => ("0x" + (fork ? "f" : "a") + n.toString(16).padStart(63, "0")) as Hex;

function transfer721(block: number, from: Address, to: Address, token: bigint, index = 0): RpcLog {
  return {
    address: NFT721, blockNumber: BigInt(block), blockHash: hash(block),
    transactionHash: txHash(block * 100 + index), transactionIndex: index, logIndex: index,
    topics: encodeEventTopics({ abi: [E721], eventName: "Transfer", args: { from, to, tokenId: token } }),
    data: "0x",
  };
}
function transfer1155(block: number, to: Address, id: bigint, value: bigint): RpcLog {
  return {
    address: NFT1155, blockNumber: BigInt(block), blockHash: hash(block),
    transactionHash: txHash(block * 100 + 9), transactionIndex: 9, logIndex: 9,
    topics: encodeEventTopics({ abi: [E1155_SINGLE], eventName: "TransferSingle", args: { operator: ALICE, from: ZERO, to } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [id, value]),
  };
}
function transfer1155Batch(block: number): RpcLog {
  return {
    address: NFT1155, blockNumber: BigInt(block), blockHash: hash(block),
    transactionHash: txHash(block * 100 + 10), transactionIndex: 10, logIndex: 10,
    topics: encodeEventTopics({ abi: [E1155_BATCH], eventName: "TransferBatch", args: { operator: ALICE, from: ZERO, to: BOB } }),
    data: encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], [[8n, 9n], [2n, 3n]]),
  };
}
class FixtureReader implements ChainReader {
  public fork = false;
  public badLog = false;
  public tip = 105n;
  async chainId() { return 18881; }
  async head() { return this.tip; }
  async block(height: bigint): Promise<ChainBlock> {
    const n = Number(height);
    if (n < 100 || n > 104) throw new Error("Unseeded mock block");
    const alternate = this.fork && n >= 102;
    return { number: height, hash: hash(n, alternate), parentHash: hash(n - 1, this.fork && n > 102) };
  }
  async logs(height: bigint, addresses: Address[]): Promise<RpcLog[]> {
    const n = Number(height);
    const allowed = new Set(addresses.map((s) => s.toLowerCase()));
    let events: RpcLog[] = [];
    if (n === 101) events = [
      transfer721(n, ZERO, ALICE, 5n),
      transfer1155(n, BOB, 7n, 4n),
      transfer1155Batch(n),
    ];
    if (n === 102 && !this.fork) events = [transfer721(n, ALICE, BOB, 5n)];
    if (n === 104 && this.badLog) events = [transfer721(103, ALICE, BOB, 5n)];
    return events.filter((event) => allowed.has(event.address.toLowerCase()));
  }
}

test("PostgreSQL: no invented collections; canonical sync, idempotency, ERC-721/1155 holdings, reorg rollback and independent disagreement", async () => {
  const db = getDb();
  await db.query("DELETE FROM nft_indexer_blocks WHERE chain_id=18881");
  await db.query("DELETE FROM nft_indexer_state WHERE chain_id=18881");
  await db.query("DELETE FROM nft_collections WHERE chain_id=18881");
  const reader = new FixtureReader();
  const startBlock = 101n;

  const before = await scanOnce(reader, db, { startBlock, confirmations: 2 });
  assert.equal(before.status, "no-collections");
  assert.equal(await indexerCoverage().then((x) => x.active), false);

  await assert.rejects(db.query(
    "INSERT INTO nft_collections(chain_id,contract_address,token_standard,deployment_block,code_hash,checked_block,operator_evidence) VALUES(19991,$1,'erc721',101,$2,101,'synthetic fixture only')",
    [NFT721, hash(11)],
  ), /check constraint/i);
  for (const [address, standard] of [[NFT721, "erc721"], [NFT1155, "erc1155"]] as const) {
    await db.query(
      "INSERT INTO nft_collections(chain_id,contract_address,token_standard,deployment_block,code_hash,checked_block,operator_evidence) VALUES(18881,$1,$2,101,$3,101,$4)",
      [address, standard, hash(11), "TEST FIXTURE: MOCK CONTRACT NOT DEPLOYED"],
    );
  }

  const first = await scanOnce(reader, db, { startBlock, confirmations: 2 });
  assert.equal(first.status, "scanned");
  assert.equal(first.scannedBlocks, 3); // 101,102,103 finalized after 2 confirmations
  assert.equal(first.transferItems, 5);
  assert.equal(first.lastBlock, "103");
  assert.equal((await scanOnce(reader, db, { startBlock, confirmations: 2 })).transferItems, 0);
  assert.equal((await listCollections()).length, 2);
  assert.equal((await listCollectionTokens(NFT721)).length, 1);
  const aliceBefore = await getOwnership(ALICE);
  const bobBefore = await getOwnership(BOB);
  assert.ok(!aliceBefore.some((x) => x.standard === "erc721"));
  assert.ok(bobBefore.some((x) => x.standard === "erc721" && x.tokenId === "5"));
  assert.ok(bobBefore.some((x) => x.standard === "erc1155" && x.tokenId === "7" && x.balance === "4"));
  assert.ok(bobBefore.some((x) => x.standard === "erc1155" && x.tokenId === "8" && x.balance === "2"));

  const proof = await verifyIndependentSources(db, reader, new FixtureReader(), async (height) => ({ hash: hash(Number(height)) }));
  assert.equal(proof.scope, "block-and-token-event");
  assert.equal(proof.matchedTransferItems, 1); // latest indexed transfer block is 102
  await assert.rejects(verifyIndependentSources(db, reader, new FixtureReader(), async () => ({ hash: hash(404) })), /disagree/);

  // Fork drops the ERC-721 transfer in 102; owner reverts to Alice, no stale Bob balance.
  reader.fork = true;
  const after = await scanOnce(reader, db, { startBlock, confirmations: 2 });
  assert.equal(after.rolledBackBlocks, 2);
  assert.equal(after.scannedBlocks, 2);
  const aliceAfter = await getOwnership(ALICE);
  const bobAfter = await getOwnership(BOB);
  assert.ok(aliceAfter.some((x) => x.standard === "erc721" && x.tokenId === "5"));
  assert.ok(!bobAfter.some((x) => x.standard === "erc721"));
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM nft_token_transfers")).rows[0].n, 4);
  // A malformed RPC block log must fail transactionally with no partial cursor advance.
  reader.tip = 106n;
  reader.badLog = true;
  await assert.rejects(scanOnce(reader, db, { startBlock, confirmations: 2 }), /wrong-block or wrong-hash/);
  assert.equal((await indexerCoverage()).lastBlock, "103");

  // In CI these are explicit synthetic fixtures, NEVER actual chain confirmations.
  await db.query("DELETE FROM nft_indexer_blocks WHERE chain_id=18881");
  await db.query("DELETE FROM nft_indexer_state WHERE chain_id=18881");
  await db.query("DELETE FROM nft_collections WHERE chain_id=18881");
});
