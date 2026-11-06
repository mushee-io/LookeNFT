import net from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { ApiError } from "@/lib/server/http";
import { canonicalJSON } from "@/lib/m6/metadata";
import { cloudinaryReady, scanServiceReady, trustedGateway, IPFS_CID, type VerifiedMedia } from "@/lib/m6/security";

export type ScanEvidence={engine:"clamav-instream";result:"clean"|"infected";evidenceHash:string};
function writeSocket(socket:net.Socket,buf:Buffer):Promise<void>{
  return new Promise((resolve,reject)=>socket.write(buf,e=>e?reject(e):resolve()));
}

/** ClamAV INSTREAM, fixed operator-selected destination, no user-controlled URL. */
export async function scanWithClamAV(bytes:Buffer):Promise<ScanEvidence>{
  if(!scanServiceReady())throw new ApiError(503,"Operator malware scanner is not configured");
  const hostname=process.env.M6_CLAMAV_HOST!,port=Number(process.env.M6_CLAMAV_PORT||"3310");
  const socket=net.connect({host:hostname,port});
  socket.setTimeout(15_000);
  const answer=new Promise<string>((resolve,reject)=>{
    let received=Buffer.alloc(0);
    socket.on("data",chunk=>{
      received=Buffer.concat([received,chunk]);
      if(received.length>2048){reject(new Error("Scanner response too large"));return;}
      if(received.includes(0)){resolve(received.toString("utf8").split("\0")[0]);}
    });
    socket.once("error",reject);
    socket.once("timeout",()=>reject(new Error("Scanner timeout")));
    socket.once("close",()=>reject(new Error("Scanner closed without verdict")));
  });
  try{
    await new Promise<void>((resolve,reject)=>{
      if(socket.connecting){socket.once("connect",resolve);socket.once("error",reject);}
      else resolve();
    });
    await writeSocket(socket,Buffer.from("zINSTREAM\0"));
    for(let offset=0;offset<bytes.length;offset+=65536){
      const part=bytes.subarray(offset,offset+65536);
      const count=Buffer.alloc(4);count.writeUInt32BE(part.length);
      await writeSocket(socket,count);
      await writeSocket(socket,part);
    }
    await writeSocket(socket,Buffer.alloc(4));
    const response=await answer;
    const evidenceHash=createHash("sha256").update(response).digest("hex");
    if(/(?:^|:)\s*.*FOUND$/i.test(response))
      return {engine:"clamav-instream",result:"infected",evidenceHash};
    if(!/\bOK$/i.test(response))throw new Error("Malware scanner did not return a clean verdict");
    return {engine:"clamav-instream",result:"clean",evidenceHash};
  } finally {socket.destroy();}
}

type CloudinaryAsset={
  asset_id:string; public_id:string; version:number;
  resource_type:string; type:string; bytes:number;
};
export async function uploadAuthenticatedMedia(
  media:VerifiedMedia,id:string
):Promise<{assetId:string;publicId:string;version:number}>{
  if(!cloudinaryReady())throw new ApiError(503,"Cloudinary operator credentials are missing");
  if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(400,"Invalid storage reservation");
  const cloud=process.env.M6_CLOUDINARY_CLOUD_NAME!;
  const name="lookenft-quarantine/"+id;
  const form=new FormData();
  form.append("file",new Blob([new Uint8Array(media.bytes)],{type:media.mime}),"asset."+media.extension);
  form.append("public_id",name);
  form.append("type","authenticated");
  form.append("overwrite","false");
  form.append("unique_filename","false");
  // Cloudinary supports backend HTTP Basic Auth; secrets NEVER go to browser.
  const auth=Buffer.from(process.env.M6_CLOUDINARY_API_KEY+":"+
    process.env.M6_CLOUDINARY_API_SECRET).toString("base64");
  const response=await fetch(
    "https://api.cloudinary.com/v1_1/"+cloud+"/"+media.kind+"/upload",{
      method:"POST",headers:{Authorization:"Basic "+auth},
      body:form,signal:AbortSignal.timeout(60_000),redirect:"error"
    });
  if(!response.ok)throw new Error("Private Cloudinary upload unavailable: HTTP "+response.status);
  const payload=await response.json() as Partial<CloudinaryAsset>;
  if(payload.type!=="authenticated"||payload.resource_type!==media.kind||
    payload.public_id!==name||payload.bytes!==media.bytes.length||
    typeof payload.asset_id!=="string"||typeof payload.version!=="number"||
    payload.version<=0)throw new Error("Cloudinary returned unexpected private asset identity");
  return {assetId:payload.asset_id,publicId:name,version:payload.version};
}

export function pinningReady():boolean {
  return process.env.M6_IPFS_PINNING_ENABLED==="true" &&
    Boolean((process.env.M6_PINATA_JWT||"").length>=30&&process.env.M6_IPFS_GATEWAY);
}

/** Public IPFS delivery is allowed only AFTER human moderation approval. */
async function pinBody(body:FormData | object,endpoint:"pinFileToIPFS"|"pinJSONToIPFS"):
Promise<string> {
  if(!pinningReady())throw new ApiError(503,"IPFS pinning credentials or approval gate unavailable");
  const jwt=process.env.M6_PINATA_JWT!;
  const response=await fetch("https://api.pinata.cloud/pinning/"+endpoint,{
    method:"POST",headers:{Authorization:"Bearer "+jwt,
      ...(body instanceof FormData?{}:{"content-type":"application/json"})},
    body:body instanceof FormData?body:JSON.stringify(body),
    redirect:"error",signal:AbortSignal.timeout(50_000)
  });
  if(!response.ok)throw new Error("Pinning provider rejected upload: HTTP "+response.status);
  const result=await response.json() as {IpfsHash?:unknown};
  if(typeof result.IpfsHash!=="string"||!IPFS_CID.test(result.IpfsHash))
    throw new Error("Pinning provider returned no valid CID");
  return result.IpfsHash;
}
async function verifyGateway(cid:string, expectedSha256:string,max:number):Promise<boolean>{
  const gateway=trustedGateway(process.env.M6_IPFS_GATEWAY||"");
  const response=await fetch(gateway+"/ipfs/"+cid,{
    redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15_000)
  });
  if(!response.ok||!response.body)return false;
  const reader=response.body.getReader();let length=0;
  const hash=createHash("sha256");
  try {
    while(true){
      const next=await reader.read();if(next.done)break;
      length+=next.value.byteLength;
      if(length>max)throw new Error("IPFS gateway content over allowed limit");
      hash.update(next.value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  return length>0&&hash.digest("hex")===expectedSha256;
}

export async function pinApprovedMedia(bytes:Buffer,media:VerifiedMedia,id:string):
Promise<{cid:string;gatewayVerified:boolean}>{
  const form=new FormData();
  form.append("file",new Blob([new Uint8Array(bytes)],{type:media.mime}),id+"."+media.extension);
  const cid=await pinBody(form,"pinFileToIPFS");
  return {cid,gatewayVerified:await verifyGateway(cid,media.sha256,bytes.length)};
}
export async function pinMetadataJSON(json:unknown,expectedHash:string):
Promise<{cid:string;gatewayVerified:boolean}>{
  const bytes=Buffer.from(canonicalJSON(json));
  if(bytes.length>65_536)throw new ApiError(413,"Metadata JSON too large");
  const form=new FormData();
  form.append("file",new Blob([new Uint8Array(bytes)],{type:"application/json"}),"metadata-"+randomUUID()+".json");
  const cid=await pinBody(form,"pinFileToIPFS");
  return {cid,gatewayVerified:await verifyGateway(cid,expectedHash,65_536)};
}
