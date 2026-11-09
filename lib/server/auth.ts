import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import type { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { ACTIVE_NETWORK } from "@/lib/network";
import { getDb, inTransaction } from "@/lib/server/db";
import { ApiError, appOrigin } from "@/lib/server/http";

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-lookenft_session" : "lookenft_session";

export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function walletAddress(value: unknown): string {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new ApiError(400, "Invalid EVM wallet address");
  return getAddress(value).toLowerCase();
}
export function validateChainId(value: unknown): void {
  if (value !== ACTIVE_NETWORK.chainId) throw new ApiError(400, "Wrong Ultra EVM network");
}
export function createChallengeMessage(address: string, nonce: string, issuedAt: string, expiresAt: string, origin = appOrigin()): string {
  return `${origin.host} wants you to sign in with your Ethereum account:
${getAddress(address)}

Sign in to Looke NFT Marketplace. This does not approve transactions or NFT transfers.

URI: ${origin.origin}
Version: 1
Chain ID: ${ACTIVE_NETWORK.chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expiresAt}`;
}

export async function issueChallenge(rawAddress: unknown, chainId: unknown, request?: NextRequest) {
  const address = walletAddress(rawAddress);
  validateChainId(chainId);
  const nonce = randomBytes(18).toString("hex");
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const message = createChallengeMessage(address, nonce, issuedAt, expiresAt, appOrigin(request));
  await inTransaction(async (db) => {
    // Row-level serialization of concurrent challenge issuance for the same address.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [address]);
    const result = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM nft_auth_challenges WHERE wallet_address = $1 AND issued_at > now() - interval '10 minutes'",
      [address],
    );
    if (Number(result.rows[0]?.count || "0") >= 10) throw new ApiError(429, "Too many login requests. Try again later");
    await db.query(
      "INSERT INTO nft_auth_challenges(nonce_hash,wallet_address,chain_id,message,expires_at) VALUES($1,$2,$3,$4,$5)",
      [digest(nonce), address, ACTIVE_NETWORK.chainId, message, expiresAt],
    );
  });
  return { nonce, message, chainId: ACTIVE_NETWORK.chainId, expiresAt };
}

type ChallengeRow = {
  wallet_address: string; chain_id: number; message: string;
  expires_at: Date; used_at: Date | null; failed_attempts: number;
};

export async function verifySignedChallenge(rawNonce: unknown, rawSignature: unknown, rawAddress: unknown) {
  if (typeof rawNonce !== "string" || !/^[a-f0-9]{36}$/.test(rawNonce)) throw new ApiError(400, "Invalid challenge");
  if (typeof rawSignature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(rawSignature)) throw new ApiError(400, "Invalid signature");
  const address = walletAddress(rawAddress);
  return inTransaction(async (db) => {
    const record = await db.query<ChallengeRow>(
      "SELECT wallet_address,chain_id,message,expires_at,used_at,failed_attempts FROM nft_auth_challenges WHERE nonce_hash=$1 FOR UPDATE",
      [digest(rawNonce)],
    );
    const challenge = record.rows[0];
    if (!challenge || challenge.wallet_address !== address || challenge.chain_id !== ACTIVE_NETWORK.chainId ||
        challenge.used_at || challenge.expires_at.getTime() <= Date.now() || challenge.failed_attempts >= 5) {
      throw new ApiError(401, "Challenge expired, unavailable or already used");
    }
    const valid = await verifyMessage({
      address: getAddress(address),
      message: challenge.message,
      signature: rawSignature as Hex,
    }).catch(() => false);
    if (!valid) {
      await db.query("UPDATE nft_auth_challenges SET failed_attempts=failed_attempts+1 WHERE nonce_hash=$1", [digest(rawNonce)]);
      return { error: "Signature does not match requested wallet" as const };
    }
    await db.query("UPDATE nft_auth_challenges SET used_at=now() WHERE nonce_hash=$1", [digest(rawNonce)]);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.query(
      "INSERT INTO nft_wallet_sessions(token_hash,wallet_address,chain_id,expires_at) VALUES($1,$2,$3,$4)",
      [digest(token), address, ACTIVE_NETWORK.chainId, expiresAt],
    );
    return { token, wallet: address, expiresAt: expiresAt.toISOString() };
  });
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000,
  });
}
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 0,
  });
}

export type AuthSession = { wallet: string; chainId: number; expiresAt: string; profileId: string | null };
export async function getSession(request: NextRequest): Promise<AuthSession | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await getDb().query<{
    wallet_address: string; chain_id: number; expires_at: Date; profile_id: string | null;
  }>(
    `SELECT s.wallet_address,s.chain_id,s.expires_at,p.profile_id
     FROM nft_wallet_sessions s
     LEFT JOIN nft_profile_links p ON p.wallet_address=s.wallet_address
     WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.chain_id=$2`,
    [digest(token), ACTIVE_NETWORK.chainId],
  );
  const row = result.rows[0];
  return row ? { wallet: row.wallet_address, chainId: row.chain_id, expiresAt: row.expires_at.toISOString(), profileId: row.profile_id } : null;
}

export async function requireSession(request: NextRequest): Promise<AuthSession> {
  const session = await getSession(request);
  if (!session) throw new ApiError(401, "Sign in with your wallet first");
  return session;
}

export async function revokeSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await getDb().query("UPDATE nft_wallet_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL", [digest(token)]);
}
