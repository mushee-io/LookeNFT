import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createChallengeMessage, digest, validateChainId, walletAddress } from "../lib/server/auth";
import { appOrigin, guardMutation, parseBody } from "../lib/server/http";
import { describeWalletError, hexChain, validAccounts } from "../lib/wallet-provider";
import { ACTIVE_NETWORK } from "../lib/network";

const address = "0x000000000000000000000000000000000000dEaD";

test("Ultra EVM scope is strictly testnet-first", () => {
  assert.equal(ACTIVE_NETWORK.chainId, 18881);
  validateChainId(18881);
  assert.throws(() => validateChainId(19991));
  assert.throws(() => validateChainId(1));
  assert.throws(() => validateChainId("18881"));
});

test("wallet address validation rejects malformed inputs", () => {
  assert.equal(walletAddress(address), address.toLowerCase());
  for (const input of ["", "0x123", "0x" + "g".repeat(40), 1, null, [], {}]) {
    assert.throws(() => walletAddress(input));
  }
});

test("challenge binds domain, wallet, network, expiry and signing purpose", () => {
  const msg = createChallengeMessage(address, "a".repeat(36), "2026-11-05T12:00:00.000Z", "2026-11-05T12:05:00.000Z");
  assert.match(msg, /localhost:3000 wants you to sign in/);
  assert.match(msg, /Chain ID: 18881/);
  assert.match(msg, /Nonce: a{36}/);
  assert.match(msg, /Expiration Time: 2026-11-05T12:05:00/);
  assert.match(msg, /does not approve transactions or NFT transfers/);
  assert.match(msg, /URI: http:\/\/localhost:3000/);
  assert.equal(digest("abc").length, 64);
  assert.notEqual(digest("secret"), "secret");
  assert.equal(appOrigin().origin, "http://localhost:3000");
});

function post(origin: string | null, contentType = "application/json", body = "{}") {
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (origin !== null) headers.Origin = origin;
  return new NextRequest("http://localhost:3000/api/auth/challenge", { method: "POST", headers, body });
}

test("state-changing endpoints reject foreign/missing Origin and non-JSON content", () => {
  assert.doesNotThrow(() => guardMutation(post("http://localhost:3000")));
  assert.throws(() => guardMutation(post("https://attacker.example")), /Origin not allowed/);
  assert.throws(() => guardMutation(post(null)), /Origin not allowed/);
  assert.throws(() => guardMutation(post("http://localhost:3000", "text/plain")), /JSON content type/);
});

test("request body bounds block oversized payloads and JSON arrays", async () => {
  await assert.rejects(parseBody(post("http://localhost:3000", "application/json", "[" + "]")), /Invalid JSON object/);
  await assert.rejects(parseBody(post("http://localhost:3000", "application/json", '{"a":"' + "x".repeat(5000) + '"}')), /Request too large/);
  const data = await parseBody(post("http://localhost:3000", "application/json", '{"address":"ok"}'));
  assert.equal(data.address, "ok");
});

test("wallet provider parsing and rejection feedback", () => {
  assert.deepEqual(validAccounts([address, "0x123", 123]), [address]);
  assert.equal(hexChain("0x49c1"), 18881);
  assert.equal(hexChain("18881"), null);
  assert.equal(hexChain({}), null);
  assert.match(describeWalletError({ code: 4001 }), /rejected/);
});
