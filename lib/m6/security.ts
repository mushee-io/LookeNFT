import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { ApiError, appOrigin } from "@/lib/server/http";
import type { NextRequest } from "next/server";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = 11 * 1024 * 1024;
export type VerifiedMedia = {
  kind: "image" | "video"; mime: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "video/webm";
  extension: string; sha256: string; bytes: Buffer;
};
const signatures = {
  "image/png": { extension: "png", kind: "image" },
  "image/jpeg": { extension: "jpg", kind: "image" },
  "image/webp": { extension: "webp", kind: "image" },
  "video/mp4": { extension: "mp4", kind: "video" },
  "video/webm": { extension: "webm", kind: "video" },
} as const;

/** Files are opaque bytes, NEVER an SVG, HTML, PDF, ZIP or user-supplied URL. */
export function sniffMedia(bytes: Buffer): keyof typeof signatures | null {
  if (bytes.length < 32) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      bytes.toString("ascii",12,16)==="IHDR" &&
      bytes.readUInt32BE(8)===13 && bytes.readUInt32BE(16)>0 && bytes.readUInt32BE(20)>0)
    return "image/png";
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255 &&
      bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217)
    return "image/jpeg";
  if (bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP" &&
      bytes.readUInt32LE(4)===bytes.length-8 &&
      ["VP8 ","VP8L","VP8X"].includes(bytes.toString("ascii",12,16)))
    return "image/webp";
  if (bytes.toString("ascii",4,8)==="ftyp" &&
      bytes.readUInt32BE(0)>=16 && bytes.readUInt32BE(0)<=bytes.length &&
      ["isom","iso2","mp41","mp42","avc1","M4V ","M4A ","iso5","iso6"].includes(bytes.toString("ascii",8,12)))
    return "video/mp4";
  if (bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) &&
      bytes.subarray(0,256).includes(Buffer.from("webm")))
    return "video/webm";
  return null;
}
export function validateMedia(bytes: Buffer, declaredMime: string, filename: string): VerifiedMedia {
  const actual = sniffMedia(bytes);
  if (!actual || !(actual in signatures)) throw new ApiError(415, "Unsupported or invalid media signature");
  if (declaredMime !== actual) throw new ApiError(415, "Declared content type differs from media bytes");
  const info = signatures[actual], image = info.kind === "image";
  if (bytes.length > (image ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES))
    throw new ApiError(413, "Media exceeds the per-format size limit");
  if (filename.length<5 || filename.length>160 || /[\\/\u0000-\u001f]/.test(filename))
    throw new ApiError(400, "Invalid upload filename");
  const ext = filename.toLowerCase().split(".").at(-1);
  if (!(ext===info.extension || (actual==="image/jpeg" && ext==="jpeg")))
    throw new ApiError(415, "Filename extension conflicts with detected media type");
  return { kind:info.kind, mime:actual,extension:info.extension,
    sha256:createHash("sha256").update(bytes).digest("hex"), bytes };
}

export function guardMultipart(request: NextRequest): void {
  if (request.headers.get("origin")!==appOrigin().origin) throw new ApiError(403, "Origin not allowed");
  const type=request.headers.get("content-type")||"";
  if (!/^multipart\/form-data;\s*boundary=[a-zA-Z0-9'()+_,.\/:=?-]{1,100}$/.test(type))
    throw new ApiError(415, "Multipart upload with bounded boundary required");
  const length=request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length)>MAX_MULTIPART_BYTES || Number(length)<1))
    throw new ApiError(413, "Bounded upload content length required");
}

/** Enforces request cap regardless of misleading Content-Length. */
export async function readMultipart(request: NextRequest): Promise<FormData> {
  if (!request.body) throw new ApiError(400, "Missing upload body");
  const reader=request.body.getReader();const chunks:Buffer[]=[];let size=0;
  try {
    while (true) {
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>MAX_MULTIPART_BYTES)throw new ApiError(413,"Multipart body exceeds 11MiB");
      chunks.push(Buffer.from(part.value));
    }
  } finally {await reader.cancel().catch(()=>{});}
  const raw=Buffer.concat(chunks);
  const parsed=new Request("https://internal.invalid",{
    method:"POST",headers:{"content-type":request.headers.get("content-type")!},
    body:new Uint8Array(raw)
  });
  return parsed.formData();
}

export function mediaOperationEnabled(): boolean {
  return process.env.M6_MEDIA_UPLOADS_ENABLED==="true";
}
export function scanServiceReady(): boolean {
  return Boolean(process.env.M6_CLAMAV_HOST &&
    /^\d{2,5}$/.test(process.env.M6_CLAMAV_PORT||"3310"));
}
export function cloudinaryReady(): boolean {
  const cloud=process.env.M6_CLOUDINARY_CLOUD_NAME||"";
  return /^[a-z0-9_-]{3,64}$/i.test(cloud) &&
    /^\d{5,30}$/.test(process.env.M6_CLOUDINARY_API_KEY||"") &&
    (process.env.M6_CLOUDINARY_API_SECRET||"").length>=16;
}

export const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;
export function trustedGateway(value: string): string {
  let u:URL;
  try {u=new URL(value);} catch {throw new ApiError(503,"Invalid IPFS gateway configuration");}
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.pathname!=="/"||u.search||
     u.hash||isIP(u.hostname)||!(/^[a-z0-9.-]+$/).test(u.hostname)||
     u.hostname==="localhost"||u.hostname.endsWith(".local")||u.hostname.endsWith(".internal"))
    throw new ApiError(503,"Unsafe IPFS gateway configuration");
  return u.origin;
}
