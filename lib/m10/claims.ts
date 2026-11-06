import {createHash} from "node:crypto";
import {importSPKI,jwtVerify} from "jose";
import {isAddress,getAddress} from "viem";
import {ApiError} from "../server/http";

/** M10 requires a compatible AUTHORISED Looke Social issuer.
 * Looke Social's checked main branch DOES NOT yet provide this issuer.
 * A public social page, username or unsigned JSON is never identity proof.
 */
export type SocialPost={id:string;body:string;createdAt:string;mediaKind:null|"image"|"video";mediaUrl:string|null};
export type SocialSnapshot={
 wallet:string;profileId:string;handle:string;displayName:string;bio:string;
 publicApproved:boolean;suspended:false;posts:SocialPost[];
 sourceCommit:string;issuer:string;jti:string;issuedAt:Date;expiresAt:Date;assertionSha256:string;
};
export type SocialTrust={
 issuer:string;publicKeyPem:string;expectedSourceCommit:string;
 mediaHosts:string[];
};
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const hex40=/^[a-f0-9]{40}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const handlePattern=/^[a-z][a-z0-9_]{2,23}$/;
const isRecord=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function text(v:unknown,min:number,max:number,name:string):string{
 if(typeof v!=="string"||v.length<min||v.length>max||/\u0000/.test(v))
  throw new ApiError(401,"Untrusted Looke Social "+name);
 return v;
}
function canonicalWallet(v:unknown):string{
 if(typeof v!=="string"||!isAddress(v,{strict:false})||
    /^0x0{40}$/i.test(v))throw new ApiError(401,"Looke Social wallet invalid");
 return getAddress(v).toLowerCase();
}
export function socialTrustFromEnvironment():SocialTrust{
 if(process.env.M10_SOCIAL_SYNC_ENABLED!=="true"||
    process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw new ApiError(503,"M10 Looke Social synchronisation is disabled");
 const issuer=process.env.M10_SOCIAL_ISSUER||"";
 const pem=process.env.M10_SOCIAL_PUBLIC_KEY_PEM?.replace(/\\n/g,"\n")||"";
 const source=process.env.M10_SOCIAL_SOURCE_COMMIT||"";
 const hostString=process.env.M10_SOCIAL_MEDIA_ALLOWED_HOSTS||"";
 if(!issuer.startsWith("https://")||!pem.includes("BEGIN PUBLIC KEY")||
    !hex40.test(source)||hostString.split(",").some(h=>h.trim()!==""&&!/^[a-z0-9.-]{4,120}$/.test(h.trim())))
  throw new ApiError(503,"Pinned authorised Looke Social issuer/source/EdDSA key missing");
 return {issuer,publicKeyPem:pem,expectedSourceCommit:source,
  mediaHosts:hostString.split(",").map(h=>h.trim()).filter(Boolean)};
}
function trustedHttpsMedia(raw:unknown,kind:unknown,hosts:string[]){
 if(raw===null||raw===undefined){
  if(kind!==null&&kind!==undefined)throw new ApiError(401,"Social media kind without URL");
  return {mediaKind:null,mediaUrl:null} as const;
 }
 const value=text(raw,12,500,"media URL");
 let uri:URL;
 try{uri=new URL(value);}catch{throw new ApiError(401,"Invalid social media URL");}
 if(uri.protocol!=="https:"||uri.username||uri.password||uri.search||
   uri.hash||uri.port||!hosts.includes(uri.hostname.toLowerCase())||
   (kind!=="image"&&kind!=="video"))
  throw new ApiError(401,"Looke Social media URL has not been operator-approved");
 return {mediaKind:kind as "image"|"video",mediaUrl:value};
}
export async function verifySocialAssertion(
 raw:unknown,trust:SocialTrust,clock=new Date()
):Promise<SocialSnapshot>{
 const assertion=text(raw,70,16_384,"assertion");
 if(!trust.issuer.startsWith("https://")||!hex40.test(trust.expectedSourceCommit))
  throw new ApiError(503,"Looke Social trust anchor is not configured");
 let claims:Record<string,unknown>;
 try{
  const publicKey=await importSPKI(trust.publicKeyPem,"EdDSA");
  const result=await jwtVerify(assertion,publicKey,{
   issuer:trust.issuer,audience:"lookenft-social-proof",algorithms:["EdDSA"],
   clockTolerance:"5s",currentDate:clock,maxTokenAge:"10m"
  });
  claims=result.payload as Record<string,unknown>;
 }catch{throw new ApiError(401,"Invalid, stale or unsigned Looke Social JWT");}
 if(claims.chainId!==18881||claims.source!=="looke-social-postgres"||
   claims.version!==1||claims.sourceCommit!==trust.expectedSourceCommit||
   !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
   (claims.exp as number)-(claims.iat as number)>600||
   (claims.iat as number)>clock.getTime()/1000+5)
  throw new ApiError(401,"Unsupported Looke source, chain, version or time");
 const wallet=canonicalWallet(claims.wallet);
 if(claims.sub!==wallet||claims.profileId!==wallet)
  throw new ApiError(403,"Looke Social profile identity not bound to the wallet");
 const jti=text(claims.jti,8,256,"nonce");
 const profile=claims.profile;
 if(!isRecord(profile)||canonicalWallet(profile.address)!==wallet||
    profile.suspended!==false||profile.publicApproved!==true)
  throw new ApiError(403,"Looke Social profile suspended, unapproved or mismatched");
 const handle=text(profile.handle,3,24,"handle");
 if(!handlePattern.test(handle))throw new ApiError(401,"Invalid Looke Social handle");
 const displayName=text(profile.displayName,1,60,"display name");
 const bio=text(profile.bio,0,240,"bio");
 if(!Array.isArray(claims.posts)||claims.posts.length>12)
  throw new ApiError(401,"Looke Social posts must be source-attested and bounded");
 const used=new Set<string>();
 const posts:SocialPost[]=claims.posts.map((input:unknown)=>{
  if(!isRecord(input)||!uuid.test(String(input.id))||input.author!==wallet||
    input.hidden!==false||input.deleted!==false||input.moderationApproved!==true)
   throw new ApiError(401,"A post is missing authentic author or moderation approval");
  const id=String(input.id).toLowerCase();
  if(used.has(id))throw new ApiError(409,"Duplicate signed Looke Social post");
  used.add(id);
  const body=text(input.body,1,1000,"post text");
  if(!/\S/u.test(body))throw new ApiError(401,"Empty Social post");
  const date=Date.parse(text(input.createdAt,20,35,"post date"));
  if(!Number.isFinite(date)||date>clock.getTime()+5000||date<0)
   throw new ApiError(401,"Invalid source-backed post timestamp");
  if(input.mediaUrl!==null&&input.mediaUrl!==undefined&&input.mediaStatus!=="approved")
   throw new ApiError(403,"Social media is not genuinely moderator-approved");
  const media=trustedHttpsMedia(input.mediaUrl??null,input.mediaKind??null,trust.mediaHosts);
  return {id,body,createdAt:new Date(date).toISOString(),...media};
 });
 return {
  wallet,profileId:wallet,handle,displayName,bio,publicApproved:true,suspended:false,
  posts,sourceCommit:trust.expectedSourceCommit,issuer:trust.issuer,jti,
  issuedAt:new Date((claims.iat as number)*1000),
  expiresAt:new Date((claims.exp as number)*1000),assertionSha256:sha(assertion)
 };
}
export function strictSocialHandle(raw:string){
 if(typeof raw!=="string"||!handlePattern.test(raw))
  throw new ApiError(400,"Looke Social handle must be lowercase 3–24 chars");
 return raw;
}
export function trustedSocialDeepLink(base:string,handle:string,collection:string):string{
 const uri=new URL(base);
 if(uri.protocol!=="https:"||uri.pathname!=="/"||uri.search||uri.hash||
    uri.username||uri.password||!handlePattern.test(handle)||
    !isAddress(collection,{strict:false}))
  throw new ApiError(503,"Approved public Looke Social URL/handle/collection unavailable");
 // Link only to existing Looke Social page. Do NOT claim a post was submitted.
 return new URL("/social",uri.origin).toString();
}
