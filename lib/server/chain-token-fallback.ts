import {createPublicClient,http,keccak256,parseAbi,type Address} from "viem";
import {ULTRA_TESTNET} from "@/lib/network";

const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const erc721=parseAbi([
 "function totalMinted() view returns (uint256)",
 "function ownerOf(uint256) view returns (address)",
 "function tokenURI(uint256) view returns (string)"
]);
export type VerifiedChainToken={
 tokenId:string;standard:"erc721";lastObservedBlock:string;lastTxHash:null;
 owner:string;tokenURI:string;name?:string;imageUrl?:string;
 evidenceSource:"verified-on-chain-ownerOf";
};

export function ipfsGateway(uri:string, gatewayHost:string):string|null{
 if(!uri.startsWith("ipfs://")||uri.length>350)return null;
 const m=uri.slice(7).match(/^(b[a-z2-7]{25,90}|Qm[1-9A-HJ-NP-Za-km-z]{44})(?:\/([\w./-]*))?$/);
 if(!m||m[2]?.split("/").some(p=>p==="."||p===".."||p===""))return null;
 return "https://"+gatewayHost+"/ipfs/"+m[1]+(m[2]?"/"+m[2]:"");
}
export function trustedGateway(coverUrl:string|null):string{
 if(!coverUrl)return "gateway.pinata.cloud";
 try{
  const u=new URL(coverUrl);
  if(u.protocol==="https:"&&/^[a-z0-9-]+\.mypinata\.cloud$/i.test(u.hostname))
   return u.hostname.toLowerCase();
 }catch{/* Ignore invalid cover */ }
 return "gateway.pinata.cloud";
}
async function getMetadata(uri:string,gatewayHost:string):Promise<{name?:string;imageUrl?:string}>{
 const address=ipfsGateway(uri,gatewayHost);
 if(!address)return {};
 try{
  const res=await fetch(address,{cache:"no-store",signal:AbortSignal.timeout(7000),headers:{accept:"application/json"}});
  if(!res.ok)return {};
  const body=await res.text();if(body.length>32768)return {};
  const metadata=JSON.parse(body) as Record<string,unknown>;
  const name=typeof metadata.name==="string"?metadata.name.slice(0,120):undefined;
  let imageUrl:string|undefined;
  if(typeof metadata.image==="string"){
   const ipfs=ipfsGateway(metadata.image,gatewayHost);
   if(ipfs)imageUrl=ipfs;
   else{try{
    const u=new URL(metadata.image);
    if(u.protocol==="https:"&&/^[a-z0-9-]+\.mypinata\.cloud$/i.test(u.hostname))
     imageUrl=u.toString();
   }catch{/* Untrusted image URL */}}
  }
  return {name,imageUrl};
 }catch{return {};}
}

/**
 * Bounded, read-only ERC721 token fallback for when the event indexer is not
 * running. This is an ownership snapshot, not a fabricated mint event.
 * Only sequential tokens on verified Looke721Collection deployments qualify.
 */
export async function verifiedChainTokens(
 address:Address,expectedCodeHash:string,coverUrl:string|null,limit=10
):Promise<{tokens:VerifiedChainToken[];checkedBlock:string;partial:boolean}>{
 const [chainId,block,code]=await Promise.all([
  rpc.getChainId(),rpc.getBlockNumber(),rpc.getCode({address})
 ]);
 if(chainId!==18881||!code||code==="0x"||
    keccak256(code).toLowerCase()!==expectedCodeHash.toLowerCase())
  throw new Error("On-chain NFT bytecode does not match the registered collection");
 const total=await rpc.readContract({address,abi:erc721,functionName:"totalMinted",blockNumber:block});
 const count=Number(total<BigInt(limit)?total:BigInt(limit));
 const gateway=trustedGateway(coverUrl);
 const tokens:VerifiedChainToken[]=[];
 for(let i=1;i<=count;i++){
  const tokenId=BigInt(i);
  const [owner,tokenURI]=await Promise.all([
   rpc.readContract({address,abi:erc721,functionName:"ownerOf",args:[tokenId],blockNumber:block}),
   rpc.readContract({address,abi:erc721,functionName:"tokenURI",args:[tokenId],blockNumber:block})
  ]);
  const metadata=await getMetadata(tokenURI,gateway);
  tokens.push({tokenId:String(i),standard:"erc721",
   lastObservedBlock:block.toString(),lastTxHash:null,owner:owner.toLowerCase(),
   tokenURI,evidenceSource:"verified-on-chain-ownerOf",...metadata});
 }
 return {tokens,checkedBlock:block.toString(),partial:total>BigInt(limit)};
}
