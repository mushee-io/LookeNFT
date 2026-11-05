import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { unlinkLookeProfile } from "@/lib/server/identity";
import { apiFailure, guardMutation, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    guardMutation(request);
    const session = await requireSession(request);
    await unlinkLookeProfile(session.wallet);
    return noStore({ linked: false });
  } catch (error) { return apiFailure(error); }
}
