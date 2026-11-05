import { type NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth";
import { apiFailure, noStore } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    return noStore(session ? { authenticated: true, ...session } : { authenticated: false });
  } catch (error) { return apiFailure(error); }
}
