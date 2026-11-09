import { type NextRequest } from "next/server";
import { setSessionCookie, verifySignedChallenge } from "@/lib/server/auth";
import { apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    guardMutation(request);
    const data = await parseBody(request);
    const verified = await verifySignedChallenge(data.nonce, data.signature, data.address);
    if ("error" in verified) return noStore({ error: verified.error }, 401);
    const response = noStore({ authenticated: true, wallet: verified.wallet, expiresAt: verified.expiresAt });
    setSessionCookie(response, verified.token);
    return response;
  } catch (error) { return apiFailure(error); }
}
