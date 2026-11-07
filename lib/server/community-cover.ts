import { ApiError } from "@/lib/server/http";

/** Strict, non-fetching HTTPS cover validation for public Testnet drafts. */
export function validateCommunityCoverUrl(value:unknown):string|null{
 if(value===null||value===undefined||value==="")return null;
 if(typeof value!=="string"||value.length>2048)throw new ApiError(400,"Invalid cover image URL");
 let url:URL;
 try{url=new URL(value);}catch{throw new ApiError(400,"Cover must be a valid HTTPS URL");}
 if(url.protocol!=="https:"||url.username||url.password||url.hash||url.port)
   throw new ApiError(400,"Cover requires public HTTPS without credentials or fragments");
 const host=url.hostname.toLowerCase();
 const configured=(process.env.LOOKE_NFT_COVER_HOSTS||"").split(",")
    .map(x=>x.trim().toLowerCase()).filter(Boolean);
 const pinata=host==="gateway.pinata.cloud"||host.endsWith(".mypinata.cloud");
 if(!pinata&&!configured.includes(host))
   throw new ApiError(403,"Cover host must be Pinata or explicitly approved");
 return url.toString();
}
