import { createHash } from "node:crypto";
import { createPublicClient,http,isAddress,parseAbi,type Address } from "viem";
import { ULTRA_TESTNET } from "@/lib/network";
import { ApiError } from "@/lib/server/http";
import { getDb } from "@/lib/server/db";
import { IPFS_CID } from "@/lib/m6/security";

export type Attribute={trait_type:string;value:string|number};
export type CreatorMetadata={
  name:string;description:string;attributes:Attribute[];
  image?:string;animation_url?:string;
};
export type MetadataDraftInput={
  assetId:string;collection:string;tokenId:string;
  name:string;description:string;attributes:unknown;
};
const OWNER_ABI=parseAbi(["function owner() view returns (address)"]);
function cleanText(value:unknown,max:number,field:string,mayBeEmpty=false):string{
  if(typeof value!=="string"||value.length>max||
     /[\u0000-\u001f\u007f]/.test(value)||
     /<\/?[a-z!][^>]*>/i.test(value)||
     (!mayBeEmpty&&!value.trim()))throw new ApiError(400,"Invalid "+field);
  return value.trim();
}

export function parseAttributes(value:unknown):Attribute[]{
  if(!Array.isArray(value)||value.length>20)throw new ApiError(400,"Metadata attributes must be an array of at most 20 entries");
  return value.map((attribute,index)=>{
    if(!attribute||typeof attribute!=="object"||Array.isArray(attribute))
      throw new ApiError(400,"Malformed attribute at index "+index);
    const a=attribute as Record<string,unknown>;
    const trait_type=cleanText(a.trait_type,80,"trait_type");
    const v=a.value;
    if(typeof v!=="number"&&typeof v!=="string")
      throw new ApiError(400,"Attributes require simple string or numeric values");
    if(typeof v==="number"&&!Number.isFinite(v))throw new ApiError(400,"Attribute number must be finite");
    return {trait_type,value:typeof v==="number"?v:cleanText(v,160,"attribute value")};
  });
}
export function canonicalJSON(value:unknown):string { 
  const sorted=(data:unknown):unknown=>Array.isArray(data)?data.map(sorted): 
    data&&typeof data==='object'?Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)])):data;
  return JSON.stringify(sorted(value));
}
export function buildMetadata(
  name:unknown,description:unknown,rawAttributes:unknown,
  cid:string,kind:"image"|"video"
):{json:CreatorMetadata;sha256:string}{
  if(!IPFS_CID.test(cid))throw new ApiError(400,"An independently gateway-verified media CID is required");
  if(kind!=="image"&&kind!=="video")throw new ApiError(400,"Unknown media kind");
  const title=cleanText(name,120,"metadata name");
  const desc=cleanText(description,1200,"description",true);
  const attrs=parseAttributes(rawAttributes);
  const uri="ipfs://"+cid;
  const json:CreatorMetadata={
    name:title,description:desc,attributes:attrs,
    ...(kind==="image"?{image:uri}:{animation_url:uri})
  };
  const raw=canonicalJSON(json);
  return {json,sha256:createHash("sha256").update(raw).digest("hex")};
}
export function parseTokenId(value:unknown):string{
  if(typeof value!=="string"||!/^(0|[1-9]\d{0,77})$/.test(value))
    throw new ApiError(400,"Token ID must be a canonical unsigned decimal string");
  if(BigInt(value)>(1n<<256n)-1n)throw new ApiError(400,"Token ID exceeds uint256");
  return value;
}

/** No spoofed collection ownership: use a real operator-registered Testnet contract. */
export async function checkCollectionCreator(
  collection:unknown,wallet:string
):Promise<{contract:Address;standard:"erc721"|"erc1155"}>{
  if(typeof collection!=="string"||!isAddress(collection,{strict:false}))
    throw new ApiError(400,"Valid collection contract required");
  const contract=collection.toLowerCase() as Address;
  const registry=await getDb().query<{token_standard:"erc721"|"erc1155"}>(
    "SELECT token_standard FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",
    [contract]
  );
  if(registry.rowCount!==1)throw new ApiError(404,"Collection is not approved in M3 Testnet registry");
  const client=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
  if(await client.getChainId()!==18881)throw new ApiError(503,"NFT RPC chain ID mismatch");
  const currentOwner=await client.readContract({
    address:contract,abi:OWNER_ABI,functionName:"owner"
  });
  if(currentOwner.toLowerCase()!==wallet.toLowerCase())
    throw new ApiError(403,"Only the real collection owner can author metadata");
  return {contract,standard:registry.rows[0].token_standard};
}
