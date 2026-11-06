import { type NextRequest } from "next/server";
import { issueChallenge } from "@/lib/server/auth";
import { apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    guardMutation(request);
    const data = await parseBody(request);
    return noStore(await issueChallenge(data.address, data.chainId, request));
  } catch (error) { return apiFailure(error); }
}
