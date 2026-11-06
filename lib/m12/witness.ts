import {createPublicClient,http,isAddress,keccak256,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "../network";
import {ApiError} from "../server/http";

export type WitnessBlock={number:bigint;hash:Hex;parentHash:Hex};
export type ReadonlyWitnessProvider={
 url:string;chainId():Promise<number>;head():Promise<bigint>;
 block(height:bigint):Promise<WitnessBlock>;
 code(address:Address,height:bigint):Promise<Hex|undefined>;
};
export type ExplorerVerifier=(height:bigint,expectedHash:Hex)=>Promise<boolean>;
const digest=/^0x[a-f0-9]{64}$/i;
const networkIp=/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|.*\.local$)/i;
export function publicRpcURL(raw:string):string{
 let u:URL;try{u=new URL(raw);}catch{throw new ApiError(503,"Independent Testnet RPC address missing");}
 if(u.protocol!=="https:"||!u.hostname.includes(".")||networkIp.test(u.hostname)||
  u.username||u.password||u.port||u.hash||u.search)
  throw new ApiError(503,"Independently operated public HTTPS RPC required, without embedded credentials");
 return u.toString();
}
export function distinctRPCs(primary:string,independent:string):void{
 const p=new URL(publicRpcURL(primary)),s=new URL(publicRpcURL(independent));
 if(p.hostname.toLowerCase()===s.hostname.toLowerCase()||
  p.origin.toLowerCase()===s.origin.toLowerCase())
  throw new ApiError(409,"Two different HTTPS RPC hostnames required; distinct hostnames alone are NOT proof of independent operators");
}
export function provider(url:string):ReadonlyWitnessProvider{
 const safe=publicRpcURL(url);
 const client=createPublicClient({transport:http(safe,{timeout:12000,retryCount:0})});
 return {url:safe,chainId:()=>client.getChainId(),
  head:()=>client.getBlockNumber(),
  block:async n=>{
   const b=await client.getBlock({blockNumber:n});
   if(!b.hash||!b.parentHash)throw new ApiError(409,"RPC supplied pending or incomplete canonical block");
   return {number:b.number,hash:b.hash,parentHash:b.parentHash};
  },
  code:(address,n)=>client.getCode({address,blockNumber:n})
 };
}
export const officialBlockscout:ExplorerVerifier=async(n,hash)=>{
 const response=await fetch(ULTRA_TESTNET.explorerUrl+"/api/v2/blocks/"+n.toString(),{
  redirect:"error",cache:"no-store",signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw new ApiError(503,"Official Blockscout HTTP "+response.status+"; independent source witness unavailable");
 const j=await response.json() as {hash?:string;height?:number};
 return typeof j.hash==="string"&&j.hash.toLowerCase()===hash.toLowerCase()&&
  (j.height===undefined||j.height===Number(n));
};
export type WitnessResult={
 chainId:18881;number:string;hash:string;parentHash:string;
 primaryUrl:string;independentUrl:string;confirmations:number;
 independentlyCorroboratedAtBlock:true;
 operatorIndependenceReviewed:false;
 nftOwnershipVerified:false;contractAuditVerified:false;
 financialExecutionAuthorised:false;releaseApproved:false;
};
export async function corroborateBlock(
 primary:ReadonlyWitnessProvider,second:ReadonlyWitnessProvider,
 explorer:ExplorerVerifier,confirmations=12
):Promise<WitnessResult>{
 distinctRPCs(primary.url,second.url);
 if(!Number.isSafeInteger(confirmations)||confirmations<12||confirmations>128)
  throw new ApiError(409,"At least 12 verified Testnet confirmations required");
 const [c1,c2,h1,h2]=await Promise.all([
  primary.chainId(),second.chainId(),primary.head(),second.head()
 ]);
 if(c1!==18881||c2!==18881)
  throw new ApiError(409,"No Testnet proof: mismatched or mainnet chain ID");
 const minimum=h1<h2?h1:h2;
 if(minimum<BigInt(confirmations+1))
  throw new ApiError(409,"Both independent Testnet heads need confirmed blocks");
 const at=minimum-BigInt(confirmations);
 const [b1,b2]=await Promise.all([primary.block(at),second.block(at)]);
 if(b1.number!==at||b2.number!==at||!digest.test(b1.hash)||
  !digest.test(b1.parentHash)||b1.hash.toLowerCase()!==b2.hash.toLowerCase()||
  b1.parentHash.toLowerCase()!==b2.parentHash.toLowerCase())
  throw new ApiError(409,"Independent Testnet block or canonical parent hash mismatch");
 if(!await explorer(at,b1.hash))
  throw new ApiError(409,"Official Blockscout contradicts canonical Testnet block hash");
 return {chainId:18881,number:at.toString(),hash:b1.hash.toLowerCase(),
  parentHash:b1.parentHash.toLowerCase(),primaryUrl:primary.url,
  independentUrl:second.url,confirmations,
  independentlyCorroboratedAtBlock:true,operatorIndependenceReviewed:false,
  nftOwnershipVerified:false,contractAuditVerified:false,
  financialExecutionAuthorised:false,releaseApproved:false};
}
export async function verifyReadOnlyContractCode(
 primary:ReadonlyWitnessProvider,second:ReadonlyWitnessProvider,
 block:WitnessResult,address:string,pinnedRuntimeHash:string
):Promise<{address:string;codeHash:string;matchedAtBlock:string;securityAuditVerified:false}>{
 if(!isAddress(address,{strict:false})||!digest.test(pinnedRuntimeHash)||
  address.toLowerCase()==="0x"+"0".repeat(40))
  throw new ApiError(409,"Real operator-approved Testnet contract address and code hash required");
 const at=BigInt(block.number);
 const [a,b]=await Promise.all([
  primary.code(address as Address,at),second.code(address as Address,at)
 ]);
 if(!a||a==="0x"||!b||b==="0x"||a.toLowerCase()!==b.toLowerCase()||
  keccak256(a).toLowerCase()!==pinnedRuntimeHash.toLowerCase())
  throw new ApiError(409,"Real runtime bytecode not independently matched to approved contract");
 return {address:address.toLowerCase(),codeHash:keccak256(a).toLowerCase(),
  matchedAtBlock:block.number,securityAuditVerified:false};
}
