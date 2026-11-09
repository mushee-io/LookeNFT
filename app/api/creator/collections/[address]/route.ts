import { NextRequest } from "next/server";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { requireSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ApiError, apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";
import { validateCommunityCoverUrl } from "@/lib/server/community-cover";
import { ULTRA_TESTNET } from "@/lib/network";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const abi=parseAbi([
 "function owner() view returns (address)",
 "function paused() view returns (bool)",
 "function phaseCount() view returns (uint256)",
 "function mintPhases(uint256) view returns (uint64 start,uint64 end,uint96 unitPrice,uint32 walletCap,uint32 phaseCap,uint32 minted,bytes32 merkleRoot,bool cancelled)"
]);
const emptyRoot="0x"+"0".repeat(64);

async function authorized(request:NextRequest,raw:string){
 const session=await requireSession(request);
 if(session.chainId!==18881||!isAddress(raw,{strict:false}))
  throw new ApiError(403,"An authenticated Ultra EVM Testnet owner wallet is required");
 const address=getAddress(raw).toLowerCase();
 const row=await getDb().query<{status:string;operator_wallet:string;archived_at:Date|null}>(
  "SELECT status,operator_wallet,archived_at FROM looke_curated_collections WHERE chain_id=18881 AND contract_address=$1",
  [address]);
 if(row.rowCount!==1)throw new ApiError(404,"Collection is not registered in LookeNFT");
 const [chain,owner,code]=await Promise.all([
  rpc.getChainId(),
  rpc.readContract({address:address as `0x${string}`,abi,functionName:"owner"}),
  rpc.getCode({address:address as `0x${string}`})
 ]).catch(()=>{throw new ApiError(503,"Could not verify the current collection owner on Ultra Testnet");});
 if(chain!==18881||!code||code==="0x"||owner.toLowerCase()!==session.wallet.toLowerCase())
  throw new ApiError(403,"Only the current on-chain collection owner can manage this collection");
 return {address,owner:session.wallet.toLowerCase(),status:row.rows[0].status,archivedAt:row.rows[0].archived_at};
}

export async function PATCH(request:NextRequest,{params}:{params:Promise<{address:string}>}){
 try{
  guardMutation(request);
  const {address:raw}=await params;
  const user=await authorized(request,raw);
  const body=await parseBody(request,5000);
  if(body.action==="restore"&&Object.keys(body).length===1){
   const restored=await getDb().query(
    "UPDATE looke_curated_collections SET archived_at=NULL,status='draft',mint_enabled=FALSE,operator_wallet=$2,updated_at=now() WHERE chain_id=18881 AND contract_address=$1 RETURNING status",
    [user.address,user.owner]);
   return noStore({restored:true,address:user.address,collection:restored.rows[0]});
  }
  if(user.archivedAt)throw new ApiError(409,"Restore this deleted Testnet collection before editing it");
  const allowed=["title","description","coverUrl","avatarUrl","status"];
  if(Object.keys(body).length===0||Object.keys(body).some(k=>!allowed.includes(k)))
   throw new ApiError(400,"Only title, description, banner, avatar and collection listing status can be changed");
  const changes:string[]=[];
  const values:unknown[]=[user.address];
  if("title" in body){
   if(typeof body.title!=="string"||body.title.trim().length<2||body.title.trim().length>90)
    throw new ApiError(400,"Collection name must contain 2–90 characters");
   values.push(body.title.trim());changes.push("title=$"+values.length);
  }
  if("description" in body){
   if(typeof body.description!=="string"||body.description.length>1200)
    throw new ApiError(400,"Collection description must be under 1200 characters");
   values.push(body.description.trim());changes.push("description=$"+values.length);
  }
  if("coverUrl" in body){
   values.push(validateCommunityCoverUrl(body.coverUrl));changes.push("cover_url=$"+values.length);
  }
  if("avatarUrl" in body){
   values.push(validateCommunityCoverUrl(body.avatarUrl));changes.push("avatar_url=$"+values.length);
  }
  if("status" in body){
   if(body.status!=="published"&&body.status!=="draft")
    throw new ApiError(400,"Only published/draft collection visibility is supported");
   values.push(body.status);changes.push("status=$"+values.length);
   if(body.status==="draft")changes.push("mint_enabled=FALSE");
   if(body.status==="published")changes.push("published_at=COALESCE(published_at,now())");
  }
  changes.push("operator_wallet=$"+(values.push(user.owner)));
  changes.push("updated_at=now()");
  const result=await getDb().query(
   "UPDATE looke_curated_collections SET "+changes.join(",")+" WHERE chain_id=18881 AND contract_address=$1 RETURNING title,description,cover_url,avatar_url,status,mint_enabled",
   values);
  return noStore({saved:true,address:user.address,collection:result.rows[0]});
 }catch(error){return apiFailure(error);}
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{address:string}>}){
 try{
  guardMutation(request);
  const {address:raw}=await params;
  const user=await authorized(request,raw);
  const body=await parseBody(request,1024);
  if(Object.keys(body).length!==1||body.confirm!==user.address)
   throw new ApiError(400,"Confirm this exact collection address to delete it from LookeNFT");
  const result=await getDb().query(
   "UPDATE looke_curated_collections SET archived_at=COALESCE(archived_at,now()),status='draft',mint_enabled=FALSE,operator_wallet=$2,updated_at=now() WHERE chain_id=18881 AND contract_address=$1 RETURNING archived_at",
   [user.address,user.owner]);
  return noStore({removedFromLookeNFT:true,archivedAt:result.rows[0].archived_at,address:user.address,
   note:"Collection and NFTs remain deployed on Ultra EVM Testnet. No on-chain tokens were burned."});
 }catch(error){return apiFailure(error);}
}

export async function POST(request:NextRequest,{params}:{params:Promise<{address:string}>}){
 try{
  guardMutation(request);
  const {address:raw}=await params;
  const user=await authorized(request,raw);
  if(user.archivedAt)throw new ApiError(409,"Restore this deleted Testnet collection before syncing minting");
  const body=await parseBody(request,1024);
  if(body.action!=="sync-free-mint"||Object.keys(body).some(k=>!["action","phaseId"].includes(k)))
   throw new ApiError(400,"Only source-backed free mint synchronization is supported");
  const id=body.phaseId;
  if(typeof id!=="string"||!/^[1-9][0-9]{0,2}$/.test(id)||Number(id)>100)
   throw new ApiError(400,"A real on-chain phase ID is required");
  const address=user.address as `0x${string}`;
  const [phaseCount,paused,phase,block]=await Promise.all([
   rpc.readContract({address,abi,functionName:"phaseCount"}),
   rpc.readContract({address,abi,functionName:"paused"}),
   rpc.readContract({address,abi,functionName:"mintPhases",args:[BigInt(id)]}),
   rpc.getBlock({blockTag:"latest"})
  ]);
  if(BigInt(id)>phaseCount)throw new ApiError(409,"The NFT contract has not scheduled this phase");
  const [start,end,price,walletCap,cap,minted,root,cancelled]=phase;
  if(price!==0n||root.toLowerCase()!==emptyRoot||walletCap<1||cap<1||cap<=minted)
   throw new ApiError(409,"Only free, public Testnet mint phases are supported");
  // A scheduled future phase is visible but not yet claimable.
  const valid=!paused&&!cancelled&&block.timestamp<=end&&start>0n&&end>start;
  await getDb().query(
   "UPDATE looke_curated_collections SET mint_phase_id=$2,mint_enabled=$3,updated_at=now(),operator_wallet=$4 WHERE chain_id=18881 AND contract_address=$1",
   [user.address,id,valid,user.owner]);
  return noStore({address:user.address,phaseId:id,mintScheduled:valid,mintActive:valid&&block.timestamp>=start,onchainPaused:paused,startsAt:start.toString(),endsAt:end.toString()});
 }catch(error){return apiFailure(error);}
}
