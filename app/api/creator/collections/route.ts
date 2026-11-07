import { NextRequest } from "next/server";
import { createPublicClient, getAddress, http, isAddress, keccak256, parseAbi } from "viem";
import { requireSession } from "@/lib/server/auth";
import { getDb, inTransaction } from "@/lib/server/db";
import { ApiError, apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";
import { ULTRA_TESTNET } from "@/lib/network";
import { validateCommunityCoverUrl } from "@/lib/server/community-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const rpc = createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const collectionAbi = parseAbi([
  "function owner() view returns (address)",
  "function supportsInterface(bytes4) view returns (bool)"
]);

/**
 * Permissionless wallet-created ERC721 / ERC1155 Testnet collection listing.
 * The browser deploys contract bytecode directly from each creator wallet.
 * No owner-only factory, admin key, paid minting, or platform signing is involved.
 * Registry admission verifies a successful transaction deployed this exact
 * contract, the signer still owns it, it has deployed code and an NFT interface.
 */
export async function POST(request: NextRequest) {
 try {
  guardMutation(request);
  const session = await requireSession(request);
  if(session.chainId !== 18881) throw new ApiError(403,"Sign in using an Ultra EVM Testnet wallet");
  const body=await parseBody(request,5000);
  if(Object.keys(body).some(k=>!["address","txHash","standard","title","description","coverUrl"].includes(k)))
    throw new ApiError(400,"Unsupported creator collection field");
  if(typeof body.address!=="string"||!isAddress(body.address,{strict:false}))
    throw new ApiError(400,"Valid collection address required");
  if(typeof body.txHash!=="string"||!/^0x[a-fA-F0-9]{64}$/.test(body.txHash))
    throw new ApiError(400,"Confirmed wallet-signed deployment transaction required");
  if(body.standard!=="erc721"&&body.standard!=="erc1155")
    throw new ApiError(400,"Unsupported NFT standard");
  const title=typeof body.title==="string"?body.title.trim():"";
  const description=typeof body.description==="string"?body.description.trim():"";
  if(title.length<2||title.length>90||description.length>1200)
    throw new ApiError(400,"Collection title or description out of range");
  const coverUrl=validateCommunityCoverUrl(body.coverUrl);
  const creator=session.wallet.toLowerCase();
  const address=getAddress(body.address);
  const chain=await rpc.getChainId();
  if(chain!==18881)throw new ApiError(503,"RPC is not connected to Ultra EVM Testnet");
  const receipt=await rpc.getTransactionReceipt({hash:body.txHash as `0x${string}`})
   .catch(()=>{throw new ApiError(409,"Deployment transaction has not confirmed on Testnet");});
  // Only direct EVM contract-creation transactions are accepted on this path.
  // The receiving contract address is derived from the wallet's real transaction,
  // not accepted from an unverified request body.
  if(receipt.status!=="success"||receipt.from.toLowerCase()!==creator||
     receipt.to!==null||!receipt.contractAddress||
     receipt.contractAddress.toLowerCase()!==address.toLowerCase())
    throw new ApiError(409,"This wallet must have directly deployed the specified NFT contract");
  const head=await rpc.getBlockNumber();
  if(head<receipt.blockNumber)
    throw new ApiError(409,"Testnet deployment transaction has not confirmed yet");
  const snapshot=head;
  const [creationCode,currentCode,owner,supported]=await Promise.all([
    rpc.getCode({address,blockNumber:receipt.blockNumber}),
    rpc.getCode({address,blockNumber:snapshot}),
    rpc.readContract({address,abi:collectionAbi,functionName:"owner",blockNumber:snapshot}),
    rpc.readContract({address,abi:collectionAbi,functionName:"supportsInterface",
      args:[body.standard==="erc721"?"0x80ac58cd":"0xd9b67a26"],blockNumber:snapshot})
  ]).catch(()=>{throw new ApiError(503,"Unable to check NFT ownership and deployed code on Ultra Testnet");});
  if(!creationCode||creationCode==="0x"||!currentCode||currentCode==="0x"||
     !supported||owner.toLowerCase()!==creator)
    throw new ApiError(409,"Collection failed the deployed NFT bytecode, interface or creator ownership checks");

  // Transactional, idempotent registration. Existing canonical registry rows
  // must match the standard; never backfill across a passed indexer checkpoint.
  const result=await inTransaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock($1)",[18881]);
    const existing=await db.query<{token_standard:string}>(
      "SELECT token_standard FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",
      [address.toLowerCase()]
    );
    if(existing.rowCount){
      if(existing.rows[0].token_standard!==body.standard)
        throw new ApiError(409,"Canonical indexer records a different token standard");
    }else{
      const state=await db.query<{last_block:string}>(
        "SELECT last_block FROM nft_indexer_state WHERE chain_id=18881"
      );
      if(state.rows[0] && receipt.blockNumber<=BigInt(state.rows[0].last_block))
        throw new ApiError(409,"Indexer must independently reindex the already-passed deployment block");
      await db.query(
        `INSERT INTO nft_collections(chain_id,contract_address,token_standard,deployment_block,
          code_hash,checked_block,source_verified,operator_evidence)
          VALUES(18881,$1,$2,$3,$4,$5,FALSE,$6)`,
        [address.toLowerCase(),body.standard,receipt.blockNumber.toString(),keccak256(currentCode),
          snapshot.toString(),ULTRA_TESTNET.explorerUrl+"/tx/"+receipt.transactionHash]
      );
    }
    const row=await db.query(
      `INSERT INTO looke_curated_collections
       (chain_id,contract_address,operator_wallet,title,description,cover_url,mint_phase_id,
        status,mint_enabled,published_at)
       VALUES(18881,$1,$2,$3,$4,$5,1,'published',FALSE,now())
       ON CONFLICT(chain_id,contract_address) DO NOTHING RETURNING contract_address`,
      [address.toLowerCase(),creator,title,description,coverUrl]
    );
    if(row.rowCount!==1)throw new ApiError(409,"Collection already registered: no duplicate or overwrite allowed");
    return {registered:true,published:true};
  });
  return noStore({...result,address:address.toLowerCase(),creator,standard:body.standard,
    transactionHash:receipt.transactionHash,sourceVerified:false,mintAvailable:false,
    independentlyAudited:false},201);
 }catch(e){return apiFailure(e);}
}
