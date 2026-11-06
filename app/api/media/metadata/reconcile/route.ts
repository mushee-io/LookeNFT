import { NextRequest } from "next/server";
import { createPublicClient,http,parseAbi } from "viem";
import { ULTRA_TESTNET } from "@/lib/network";
import { getDb } from "@/lib/server/db";
import { requireOperator } from "@/lib/server/curation";
import { ApiError,apiFailure,guardMutation,noStore,parseBody } from "@/lib/server/http";
import { checkCollectionCreator } from "@/lib/m6/metadata";
import { metadataUrl } from "@/lib/indexer/metadata";
import { trustedGateway } from "@/lib/m6/security";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const uri721=parseAbi(["function tokenURI(uint256) view returns (string)"]);
const uri1155=parseAbi(["function uri(uint256) view returns (string)"]);

/** Primary-RPC-only URI comparison. Never authorises a chain transaction. */
export async function POST(request:NextRequest){
  try{
    guardMutation(request);
    const session={ wallet: await requireOperator(request) };
    const body=await parseBody(request,500);
    if(typeof body.id!=="string"||!/^[a-f0-9-]{36}$/i.test(body.id))
      throw new ApiError(400,"Valid metadata version UUID required");
    const db=getDb();
    const result=await db.query<{
      collection_address:string;token_id:string;token_standard:"erc721"|"erc1155";
      state:string;ipfs_cid:string;
    }>(
      `SELECT collection_address,token_id::text,token_standard,state,ipfs_cid
        FROM nft_media_metadata_versions WHERE id=$1 AND owner_wallet=$2 AND chain_id=18881`,
      [body.id,session.wallet]
    );
    if(result.rowCount!==1||result.rows[0].state!=="pinned")
      throw new ApiError(409,"Only owner-scoped pinned metadata can be reconciled");
    const row=result.rows[0];
    const collection=await checkCollectionCreator(row.collection_address,session.wallet);
    if(collection.standard!==row.token_standard)throw new Error("Registered NFT standard changed");
    const client=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
    const block=await client.getBlockNumber();
    const args=[BigInt(row.token_id)] as const;
    const raw=row.token_standard==="erc721"
      ?await client.readContract({address:collection.contract,abi:uri721,
          functionName:"tokenURI",args,blockNumber:block})
      :await client.readContract({address:collection.contract,abi:uri1155,
          functionName:"uri",args,blockNumber:block});
    const expected="ipfs://"+row.ipfs_cid;
    // Accept only exact CID or the already allowlisted IPFS gateway representation.
    const resolved=metadataUrl(raw,BigInt(row.token_id));
    const gateway=trustedGateway(process.env.M6_IPFS_GATEWAY||"");
    if(raw!==expected||resolved!==gateway+"/ipfs/"+row.ipfs_cid)
      throw new ApiError(409,"Actual Testnet tokenURI/uri does not match the pinned metadata CID");
    if(row.token_standard==="erc1155"){
      const evidence=await db.query(
        `SELECT 1 FROM nft_token_transfers
         WHERE chain_id=18881 AND contract_address=$1 AND token_id=$2::numeric LIMIT 1`,
        [row.collection_address,row.token_id]
      );
      if(evidence.rowCount!==1)throw new ApiError(409,"No canonical M3 indexed ERC1155 token existence evidence");
    }
    const updated=await db.query(
      `UPDATE nft_media_metadata_versions SET state='chain_matched',chain_uri=$3,
        chain_checked_block=$4,chain_checked_at=now()
       WHERE id=$1 AND owner_wallet=$2 AND state='pinned'
       RETURNING id::text,state,chain_uri,chain_checked_block::text`,
      [body.id,session.wallet,raw,block.toString()]
    );
    if(updated.rowCount!==1)throw new ApiError(409,"Metadata version was modified concurrently");
    return noStore({record:updated.rows[0],
      verificationLevel:"primary-RPC-tokenURI-only",
      independentRpcVerified:false,securityAudited:false,
      note:"Read-only URI match is not independently verified ownership, sale or mint evidence."});
  }catch(e){return apiFailure(e);}
}
