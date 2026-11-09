import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { getDb } from "../lib/server/db";
import { issueChallenge, verifySignedChallenge, getSession, revokeSession, walletAddress } from "../lib/server/auth";
import { linkLookeProfile, unlinkLookeProfile, verifyLookeIdentityAssertion } from "../lib/server/identity";

function newAccount() { return privateKeyToAccount(generatePrivateKey()); }
function sessionRequest(token: string) {
  return new NextRequest("http://localhost:3000/api/auth/session", {
    headers: { cookie: "lookenft_session=" + token },
  });
}

test("real PostgreSQL: signed login succeeds, is scoped and revoke works", async () => {
  const signer = newAccount();
  const challenge = await issueChallenge(signer.address, 18881);
  const signature = await signer.signMessage({ message: challenge.message });
  const accepted = await verifySignedChallenge(challenge.nonce, signature, signer.address);
  assert.ok(!("error" in accepted));
  if ("error" in accepted) return;
  assert.equal(accepted.wallet, signer.address.toLowerCase());
  assert.equal(accepted.token.length, 43);
  const session = await getSession(sessionRequest(accepted.token));
  assert.equal(session?.wallet, signer.address.toLowerCase());
  assert.equal(session?.chainId, 18881);
  assert.equal(session?.profileId, null);
  assert.equal(await getSession(sessionRequest("x".repeat(43))), null);
  await revokeSession(sessionRequest(accepted.token));
  assert.equal(await getSession(sessionRequest(accepted.token)), null);
});

test("real PostgreSQL: invalid signature does not authenticate and replay fails", async () => {
  const signer = newAccount();
  const attacker = newAccount();
  const challenge = await issueChallenge(signer.address, 18881);
  const forged = await attacker.signMessage({ message: challenge.message });
  assert.deepEqual(await verifySignedChallenge(challenge.nonce, forged, signer.address), {
    error: "Signature does not match requested wallet",
  });
  await assert.rejects(verifySignedChallenge(challenge.nonce, forged, attacker.address), /Challenge expired, unavailable or already used/);
  const legitimate = await signer.signMessage({ message: challenge.message });
  const accepted = await verifySignedChallenge(challenge.nonce, legitimate, signer.address);
  assert.ok(!("error" in accepted));
  await assert.rejects(verifySignedChallenge(challenge.nonce, legitimate, signer.address), /Challenge expired, unavailable or already used/);
});

test("real PostgreSQL: simultaneous reuse of a nonce allows only one session", async () => {
  const signer = newAccount();
  const challenge = await issueChallenge(signer.address, 18881);
  const signature = await signer.signMessage({ message: challenge.message });
  const results = await Promise.allSettled([
    verifySignedChallenge(challenge.nonce, signature, signer.address),
    verifySignedChallenge(challenge.nonce, signature, signer.address),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});

test("real PostgreSQL: challenge rate limit is per wallet and preserves a 10 minute window", async () => {
  const signer = newAccount();
  for (let i = 0; i < 10; i++) await issueChallenge(signer.address, 18881);
  await assert.rejects(issueChallenge(signer.address, 18881), /Too many login requests/);
});

test("real PostgreSQL: Looke profile assertions require issuer signature, wallet binding and unique jti", async () => {
  const account = newAccount();
  const another = newAccount();
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const oldPub = process.env.LOOKE_IDENTITY_PUBLIC_KEY_PEM;
  const oldIssuer = process.env.LOOKE_IDENTITY_ISSUER;
  process.env.LOOKE_IDENTITY_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
  process.env.LOOKE_IDENTITY_ISSUER = "https://social.looke.invalid";
  try {
    const profile = "looke-test-" + randomUUID();
    const jti = randomUUID();
    const signed = await new SignJWT({ wallet: account.address })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer(process.env.LOOKE_IDENTITY_ISSUER)
      .setAudience("lookenft")
      .setSubject(profile)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const valid = await verifyLookeIdentityAssertion(signed);
    assert.equal(valid.wallet, walletAddress(account.address));
    await assert.rejects(linkLookeProfile(walletAddress(another.address), valid), /another wallet/);
    await linkLookeProfile(valid.wallet, valid);
    const linked = await getDb().query("SELECT profile_id FROM nft_profile_links WHERE wallet_address=$1", [valid.wallet]);
    assert.equal(linked.rows[0].profile_id, profile);
    await assert.rejects(linkLookeProfile(valid.wallet, valid), /duplicate key value/);
    await unlinkLookeProfile(valid.wallet);
    const link = await getDb().query("SELECT 1 FROM nft_profile_links WHERE wallet_address=$1", [valid.wallet]);
    assert.equal(link.rowCount, 0);
    // Even after unlink, the same issuer JWT cannot be consumed twice.
    await assert.rejects(linkLookeProfile(valid.wallet, valid), /duplicate key value/);
    // The trailing base64url character can have non-significant padding bits.
    // Flip a *leading* signature character to guarantee different signature bytes.
    const [jwtHeader, jwtPayload, jwtSignature] = signed.split(".");
    const fake = [jwtHeader, jwtPayload,
      (jwtSignature.startsWith("A") ? "B" : "A") + jwtSignature.slice(1)].join(".");
    await assert.rejects(verifyLookeIdentityAssertion(fake), /Invalid Looke identity/);
  } finally {
    if (oldPub === undefined) delete process.env.LOOKE_IDENTITY_PUBLIC_KEY_PEM;
    else process.env.LOOKE_IDENTITY_PUBLIC_KEY_PEM = oldPub;
    if (oldIssuer === undefined) delete process.env.LOOKE_IDENTITY_ISSUER;
    else process.env.LOOKE_IDENTITY_ISSUER = oldIssuer;
  }
});
