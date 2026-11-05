import { NextResponse, type NextRequest } from "next/server";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function appOrigin(): URL {
  const origin = process.env.APP_ORIGIN || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!origin) throw new ApiError(503, "APP_ORIGIN is not configured");
  const url = new URL(origin);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new ApiError(503, "Invalid APP_ORIGIN");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new ApiError(503, "APP_ORIGIN must use HTTPS in production");
  if (!["https:", "http:"].includes(url.protocol)) throw new ApiError(503, "Invalid application origin");
  return url;
}

/** No cross-origin state mutation and no JSON CSRF through text/plain forms. */
export function guardMutation(request: NextRequest): void {
  if (request.headers.get("origin") !== appOrigin().origin) throw new ApiError(403, "Origin not allowed");
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
