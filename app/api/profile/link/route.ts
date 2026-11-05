import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { linkLookeProfile, verifyLookeIdentityAssertion } from "@/lib/server/identity";
import { apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    guardMutation(request);
    const session = await requireSession(request);
    const data = await parseBody(request, 12_288);
    const identity = await verifyLookeIdentityAssertion(data.assertion);
    await linkLookeProfile(session.wallet, identity);
    return noStore({ linked: true, profileId: identity.profileId });
  } catch (error) {
    // Unique constraints cover both duplicate jti and independently linked profile.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
      return noStore({ error: "Identity assertion already used or profile linked" }, 409);
    return apiFailure(error);
  }
}
