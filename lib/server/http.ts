import { NextResponse, type NextRequest } from "next/server";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/**
 * Wallet authentication is host-bound. On Vercel, ephemeral and branch previews
 * have their own valid origins; do NOT accept arbitrary Host or Origin headers.
 */
export function appOrigin(request?: NextRequest): URL {
  const configured = process.env.APP_ORIGIN?.trim() || "";
  const candidate = request
    ? new URL(request.url)
    : new URL(configured || (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL :
        process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "https://looke-ss.vercel.app"));
  const hostname = candidate.hostname.toLowerCase();
  const aliases = [configured ? new URL(configured).hostname : "",
    process.env.VERCEL_URL || "",
    process.env.VERCEL_BRANCH_URL || "",
    process.env.VERCEL_PROJECT_PRODUCTION_URL || "",
    "looke-ss.vercel.app"].filter(Boolean).map(x => x.toLowerCase());
  const verifiedVercelPreview = /^looke(?:-ss)?-[a-z0-9-]+-mushee-ios-projects\\.vercel\\.app$/.test(hostname);
  const devLocalhost = process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(hostname);
  if (request && !(aliases.includes(hostname) || verifiedVercelPreview || devLocalhost))
    throw new ApiError(403, "Application hostname is not approved");
  if (candidate.pathname !== "/" || candidate.search || candidate.hash || candidate.username || candidate.password)
    throw new ApiError(503, "Invalid application origin");
  if (process.env.NODE_ENV === "production" && candidate.protocol !== "https:")
    throw new ApiError(503, "Application origin must use HTTPS");
  if (!["https:", "http:"].includes(candidate.protocol))
    throw new ApiError(503, "Invalid application origin");
  return candidate;
}

/** No cross-origin state mutation and no JSON CSRF through text/plain forms. */
export function guardMutation(request: NextRequest): void {
  if (request.headers.get("origin") !== appOrigin(request).origin) throw new ApiError(403, "Origin not allowed");
  const ct = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (ct !== "application/json") throw new ApiError(415, "JSON content type required");
}

export async function parseBody(request: NextRequest, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new ApiError(413, "Request too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ApiError(413, "Request too large");
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch { /* intentional */ }
  throw new ApiError(400, "Invalid JSON object");
}

export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function apiFailure(error: unknown): NextResponse {
  if (error instanceof ApiError) return noStore({ error: error.message }, error.status);
  console.error("Wallet auth request failed", error instanceof Error ? error.name : "Unknown error");
  return noStore({ error: "Authentication service unavailable" }, 503);
}
