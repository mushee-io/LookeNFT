import { importSPKI, jwtVerify } from "jose";
import { getDb, inTransaction } from "@/lib/server/db";
import { walletAddress } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/http";

export type VerifiedLookeIdentity = { profileId: string; wallet: string; jti: string };

/**
 * The Looke Social identity issuer must sign this assertion. An arbitrary
 * handle or wallet-provided text is never accepted as proof of ownership.
 */
export async function verifyLookeIdentityAssertion(assertion: unknown): Promise<VerifiedLookeIdentity> {
  if (typeof assertion !== "string" || assertion.length > 8192 || assertion.length < 30) {
    throw new ApiError(400, "Invalid Looke identity assertion");
  }
  const pem = process.env.LOOKE_IDENTITY_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  const issuer = process.env.LOOKE_IDENTITY_ISSUER;
  if (!pem || !issuer) throw new ApiError(503, "Looke Social identity issuer is not configured");
  let claims;
  try {
    const publicKey = await importSPKI(pem, "EdDSA");
    const validated = await jwtVerify(assertion, publicKey, {
      issuer, audience: "lookenft", algorithms: ["EdDSA"], clockTolerance: "5s",
    });
    claims = validated.payload;
  } catch { throw new ApiError(401, "Invalid Looke identity signature or claims"); }
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 128 ||
      typeof claims.jti !== "string" || claims.jti.length < 8 || claims.jti.length > 256 ||
      typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
      Date.now() / 1000 - claims.iat > 600) {
    throw new ApiError(401, "Incomplete or stale Looke identity assertion");
  }
  return { profileId: claims.sub, jti: claims.jti, wallet: walletAddress(claims.wallet) };
}

export async function linkLookeProfile(wallet: string, identity: VerifiedLookeIdentity): Promise<void> {
  if (identity.wallet !== wallet) throw new ApiError(403, "Looke identity belongs to another wallet");
  await inTransaction(async (db) => {
    await db.query("INSERT INTO nft_identity_jtis(jti,wallet_address) VALUES($1,$2)", [identity.jti, wallet]);
    const link = await db.query(
      "INSERT INTO nft_profile_links(wallet_address,profile_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING profile_id",
      [wallet, identity.profileId],
    );
    if (link.rowCount !== 1) throw new ApiError(409, "Wallet or Looke profile is already linked");
  });
}

export async function unlinkLookeProfile(wallet: string): Promise<void> {
  await getDb().query("DELETE FROM nft_profile_links WHERE wallet_address=$1", [wallet]);
}
