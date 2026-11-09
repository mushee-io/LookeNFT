import { type NextRequest } from "next/server";
import { clearSessionCookie, revokeSession } from "@/lib/server/auth";
import { apiFailure, guardMutation, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    guardMutation(request);
    await revokeSession(request);
    const response = noStore({ authenticated: false });
    clearSessionCookie(response);
    return response;
  } catch (error) { return apiFailure(error); }
}
