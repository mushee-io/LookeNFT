import { isIP } from "node:net";

export type SanitizedMetadata = {
  name: string | null; description: string | null; image: string | null;
  externalUrl: string | null; attributes: Array<{ traitType: string; value: string | number }>;
};

const MAX_BYTES = 65_536;
const CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;
const ALLOWED_HOSTS = () => (process.env.NFT_METADATA_ALLOWED_HOSTS || "")
  .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

function trustedHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.search.length > 1024 || url.href.length > 2048 ||
        isIP(url.hostname) || !/^[a-z0-9.-]+$/.test(url.hostname) ||
        url.hostname === "localhost" || url.hostname.endsWith(".local") ||
        url.hostname.endsWith(".internal") || url.hostname.includes("..") ||
        !ALLOWED_HOSTS().includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

/** Arbitrary on-chain tokenURI must NEVER be fetched as an unrestricted URL. */
export function metadataUrl(raw: unknown, tokenId?: bigint): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  const substituted = raw.replace(/\{id\}/gi, tokenId === undefined ? "" : tokenId.toString(16).padStart(64, "0"));
  if (substituted.startsWith("ipfs://")) {
    const path = substituted.slice(7);
    const [cid, ...parts] = path.replace(/^ipfs\//, "").split("/");
    const gateway = process.env.NFT_IPFS_GATEWAY;
    if (!CID.test(cid) || !gateway || parts.some((p) => !/^[a-zA-Z0-9._-]{1,120}$/.test(p) || p === ".." || p === ".")) return null;
    try {
      const host = new URL(gateway);
      if (host.pathname !== "/" || host.search || host.hash) return null;
      return trustedHttpsUrl(host.origin + "/ipfs/" + cid + (parts.length ? "/" + parts.map(encodeURIComponent).join("/") : ""));
    } catch { return null; }
  }
  return trustedHttpsUrl(substituted);
}
function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}
export function sanitizeMetadata(value: unknown): SanitizedMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NFT metadata must be a JSON object");
  const raw = value as Record<string, unknown>;
  const attrs: SanitizedMetadata["attributes"] = [];
  if (Array.isArray(raw.attributes)) {
    for (const entry of raw.attributes.slice(0, 30)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const attr = entry as Record<string, unknown>;
      const traitType = shortText(attr.trait_type, 80);
      const value = typeof attr.value === "number" && Number.isFinite(attr.value) ? attr.value : shortText(attr.value, 160);
      if (traitType && value !== null) attrs.push({ traitType, value });
    }
  }
  return {
    name: shortText(raw.name, 120),
    description: shortText(raw.description, 1200),
    image: metadataUrl(raw.image),
    externalUrl: metadataUrl(raw.external_url),
    attributes: attrs,
  };
}

export async function loadMetadata(url: string): Promise<SanitizedMetadata> {
  if (!trustedHttpsUrl(url)) throw new Error("Metadata host is not operator-allowlisted");
  const response = await fetch(url, {
    method: "GET", redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(6000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok || !response.body || (response.headers.get("content-type") || "").split(";")[0] !== "application/json")
    throw new Error("Metadata JSON response is unavailable");
  const size = Number(response.headers.get("content-length") || 0);
  if (size > MAX_BYTES) throw new Error("Metadata too large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > MAX_BYTES) throw new Error("Metadata exceeds 64KiB");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return sanitizeMetadata(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
