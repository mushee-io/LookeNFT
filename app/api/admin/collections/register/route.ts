import { NextRequest } from "next/server";
import { createPublicClient,getAddress,http,isAddress,keccak256,parseAbi,parseEventLogs } from "viem";
import { requireOperator } from "@/lib/server/curation";
import { factoryAbi } from "@/lib/m4/factory";
import { ULTRA_TESTNET } from "@/lib/network";
import { getDb,inTransaction } from "@/lib/server/db";
import { ApiError,apiFailure,guardMutation,noStore,parseBody } from "@/lib/server/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const ownerAbi=parseAbi(["function owner() view returns (address)","function supportsInterface(bytes4) view returns (bool)"]);

/**
 * Claim an operator-owned V3 collection only from a CONFIRMED factory event.
 * Writes the canonical indexer record, never mints an NFT or enables financial execution.
 */
export async function POST(request:NextRequest){
 try{
  guardMutation(request);
  const operator=await requireOperator(request);
  const body=await parseBody(request,1200);
  if(Object.keys(body).some(k=>!["address","txHash","standard"].includes(k)))
   throw new ApiError(400,"Unsupported registration field");
  if(typeof body.address!=="string"||!isAddress(body.address,{strict:false}))
   throw new ApiError(400,"Valid collection contract required");
  if(typeof body.txHash!=="string"||!/^0x[a-fA-F0-9]{64}$/.test(body.txHash))
   throw new ApiError(400,"Confirmed deployment transaction hash required");
  if(body.standard!=="erc721"&&body.standard!=="erc1155")
   throw new ApiError(400,"Collection standard must be erc721 or erc1155");
  const configured=process.env.LOOKE_NFT_OWNER_FACTORY_ADDRESS||"";
  if(!isAddress(configured,{strict:false}))
   throw new ApiError(503,"Verified owner-only V3 factory is not configured");
  const address=getAddress(body.address),factory=getAddress(configured);
  const chain=await rpc.getChainId();
  if(chain!==18881)throw new ApiError(503,"Ultra Testnet RPC chain mismatch");
  const receipt=await rpc.getTransactionReceipt({hash:body.txHash as `0x${string}`})
   .catch(()=>{throw new ApiError(409,"Deployment transaction not yet confirmed on Ultra Testnet");});
  if(receipt.status!=="success"||receipt.from.toLowerCase()!==operator||receipt.to?.toLowerCase()!==factory.toLowerCase())
   throw new ApiError(409,"Deployment transaction was not a successful operator-approved V3 factory call");
  const head=await rpc.getBlockNumber();
  if(head<receipt.blockNumber+12n)
   throw new ApiError(409,"Wait for at least 12 Ultra Testnet confirmations before registering the collection");
  const logs=parseEventLogs({abi:factoryAbi,eventName:"CollectionCreated",strict:true,
   logs:receipt.logs.filter(log=>log.address.toLowerCase()===factory.toLowerCase())});
  const standardId=body.standard==="erc721"?1:2;
  if(!logs.some(event=>event.args.collection?.toLowerCase()===address.toLowerCase() &&
    event.args.creator?.toLowerCase()===operator && event.args.standard===standardId))
   throw new ApiError(409,"The signed factory transaction does not prove creation of this collection");
  const checkedBlock=head-12n;
  const [history,code,declaredOwner,interfaceSupport,registered,version,factoryOwner]=await Promise.all([
   rpc.getCode({address,blockNumber:receipt.blockNumber}),
   rpc.getCode({address,blockNumber:checkedBlock}),
   rpc.readContract({address,abi:ownerAbi,functionName:"owner",blockNumber:checkedBlock}),
   rpc.readContract({address,abi:ownerAbi,functionName:"supportsInterface",
     args:[body.standard==="erc721"?"0x80ac58cd":"0xd9b67a26"],blockNumber:checkedBlock}),
   rpc.readContract({address:factory,abi:factoryAbi,functionName:"isCollection",args:[address],blockNumber:checkedBlock}),
   rpc.readContract({address:factory,abi:factoryAbi,functionName:"VERSION",blockNumber:checkedBlock}),
   rpc.readContract({address:factory,abi:ownerAbi,functionName:"owner",blockNumber:checkedBlock})
  ]).catch(()=>{throw new ApiError(503,"Unable to verify deployed collection and owner factory at confirmed Ultra block");});
  if(!history||history==="0x"||!code||code==="0x"||!interfaceSupport||!registered||
    version!==3n||factoryOwner.toLowerCase()!==operator||declaredOwner.toLowerCase()!==operator)
   throw new ApiError(409,"Collection failed confirmed owner, interface, bytecode or V3 factory proof");
  const result=await inTransaction(async db=>{
   await db.query("SELECT pg_advisory_xact_lock($1)",[18881]);
   const existing=await db.query("SELECT contract_address FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",
      [address.toLowerCase()]);
   if(existing.rowCount) return {registered:true,existing:true};
   const state=await db.query<{last_block:string}>(
    "SELECT last_block FROM nft_indexer_state WHERE chain_id=18881"
   );
   if(state.rows[0]&&receipt.blockNumber<=BigInt(state.rows[0].last_block))
    throw new ApiError(409,"Indexer already passed this deployment block; operator must reindex from an earlier verified anchor");
   await db.query(
    `INSERT INTO nft_collections(chain_id,contract_address,token_standard,deployment_block,
       code_hash,checked_block,source_verified,operator_evidence)
       VALUES(18881,$1,$2,$3,$4,$5,FALSE,$6)`,
    [address.toLowerCase(),body.standard,receipt.blockNumber.toString(),keccak256(code),
      checkedBlock.toString(),ULTRA_TESTNET.explorerUrl+"/tx/"+receipt.transactionHash]
   );
   return {registered:true,existing:false};
  });
  return noStore({...result,address:address.toLowerCase(),standard:body.standard,
   deploymentTx:receipt.transactionHash,confirmedAtBlock:checkedBlock.toString(),
   sourceVerified:false,independentAudit:false});
 }catch(e){return apiFailure(e);}
}
