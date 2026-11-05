import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { E721, E1155_BATCH, E1155_SINGLE, decodeTransfers, type RpcLog } from "../lib/indexer/events";
import { metadataUrl, sanitizeMetadata } from "../lib/indexer/metadata";

const CONTRACT = ("0x" + "1".repeat(40)) as Hex;
const ALICE = ("0x" + "a".repeat(40)) as Hex;
const BOB = ("0x" + "b".repeat(40)) as Hex;
const hash = ("0x" + "4".repeat(64)) as Hex;
const txHash = ("0x" + "7".repeat(64)) as Hex;
const common = { address: CONTRACT, blockNumber: 42n, blockHash: hash, transactionHash: txHash, transactionIndex: 2, logIndex: 3 };

test("strictly decode a real ERC-721 Transfer log structure", () => {
  const topics = encodeEventTopics({ abi: [E721], eventName: "Transfer", args: { from: ALICE, to: BOB, tokenId: 42n } });
  const log: RpcLog = { ...common, topics, data: "0x" };
  assert.deepEqual(decodeTransfers(log, "erc721").map((t) => [t.tokenId, t.amount, t.from, t.to]),
    [["42", "1", ALICE, BOB]]);
  assert.deepEqual(decodeTransfers(log, "erc1155"), []);
});

test("strictly decode ERC-1155 TransferSingle with actual ABI-encoded data", () => {
  const topics = encodeEventTopics({ abi: [E1155_SINGLE], eventName: "TransferSingle", args: { operator: ALICE, from: ALICE, to: BOB } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [7n, 5n]);
  const items = decodeTransfers({ ...common, topics, data }, "erc1155");
  assert.equal(items.length, 1);
  assert.equal(items[0].tokenId, "7");
  assert.equal(items[0].amount, "5");
});

test("ERC-1155 TransferBatch preserves item indices for one-log multi-token transfers", () => {
  const topics = encodeEventTopics({ abi: [E1155_BATCH], eventName: "TransferBatch", args: { operator: ALICE, from: ALICE, to: BOB } });
  const data = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], [[4n, 5n], [2n, 9n]]);
  const items = decodeTransfers({ ...common, topics, data }, "erc1155");
  assert.deepEqual(items.map((x) => [x.itemIndex, x.tokenId, x.amount]), [[0, "4", "2"], [1, "5", "9"]]);
});

test("RPC log missing block hash or transaction data fails closed", () => {
  const topics = encodeEventTopics({ abi: [E721], eventName: "Transfer", args: { from: ALICE, to: BOB, tokenId: 42n } });
  assert.throws(() => decodeTransfers({ ...common, topics, data: "0x", blockHash: null }, "erc721"), /Incomplete/);
  assert.throws(() => decodeTransfers({ ...common, topics, data: "0x", transactionIndex: -1 }, "erc721"), /Incomplete/);
});

test("on-chain metadata URLs reject private hosts, unallowlisted URLs, scripts and redirects", () => {
  const oldHosts = process.env.NFT_METADATA_ALLOWED_HOSTS, oldGateway = process.env.NFT_IPFS_GATEWAY;
  process.env.NFT_METADATA_ALLOWED_HOSTS = "ipfs.io,assets.example.org";
  process.env.NFT_IPFS_GATEWAY = "https://ipfs.io";
  try {
    const cid = "Qm" + "a".repeat(44);
    assert.equal(metadataUrl("ipfs://" + cid + "/1.json"), "https://ipfs.io/ipfs/" + cid + "/1.json");
    assert.equal(metadataUrl("https://assets.example.org/2.json"), "https://assets.example.org/2.json");
    assert.equal(metadataUrl("http://assets.example.org/2.json"), null);
    assert.equal(metadataUrl("https://127.0.0.1/2.json"), null);
    assert.equal(metadataUrl("https://localhost/2.json"), null);
    assert.equal(metadataUrl("javascript:alert(1)"), null);
    assert.equal(metadataUrl("https://attacker.org/2.json"), null);
    assert.equal(metadataUrl("https://user:pass@assets.example.org/a"), null);
    assert.equal(metadataUrl("https://assets.example.org:8080/a"), null);
    const padded = (15n).toString(16).padStart(64, "0");
    assert.equal(metadataUrl("https://assets.example.org/{id}.json", 15n), "https://assets.example.org/" + padded + ".json");
    assert.equal(sanitizeMetadata({ name: "Hi\u0000", image: "javascript:alert(1)", attributes: [{ trait_type: "Level", value: 2 }] }).image, null);
    assert.deepEqual(sanitizeMetadata({ name: "Hi", attributes: [{ trait_type: "Level", value: 2 }] }).attributes, [{ traitType: "Level", value: 2 }]);
  } finally {
    if (oldHosts === undefined) delete process.env.NFT_METADATA_ALLOWED_HOSTS; else process.env.NFT_METADATA_ALLOWED_HOSTS = oldHosts;
    if (oldGateway === undefined) delete process.env.NFT_IPFS_GATEWAY; else process.env.NFT_IPFS_GATEWAY = oldGateway;
  }
});
