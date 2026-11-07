import {NextRequest} from "next/server";
import {createPublicClient,getAddress,http,isAddress,parseAbi} from "viem";
import {requireSession} from "@/lib/server/auth";
import {getDb} from "@/lib/server/db";
import {ApiError,apiFailure,guardMutation,noStore,parseBody} from "@/lib/server/http";
import {ULTRA_TESTNET} from "@/lib/network";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const abi=parseAbi(["function owner() view returns (address)","function ownerOf(uint256) view returns (address)"]);
export async function PATCH(request:NextRequest,{params}:{params:Promise<{address:string;tokenId:string}>}){
 try{
  guardMutation(request);
  const session=await requireSession(request);
  const {address:raw,tokenId:rawId}=await params;
  if(session.chainId!==18881||!isAddress(raw,{strict:false})||
     !/^(0|[1-9][0-9]{0,77})$/.test(rawId))
   throw new ApiError(400,"Valid Ultra Testnet ERC-721 collection and token ID required");
  const address=getAddress(raw);
  const tokenId=BigInt(rawId);
  if(tokenId>2n**256n-1n)throw new ApiError(400,"Invalid token ID");
  const body=await parseBody(request,512);
  if(Object.keys(body).length!==1||typeof body.hidden!=="boolean")
   throw new ApiError(400,"Only hidden=true or hidden=false is supported");
  const row=await getDb().query<{token_standard:string;archived_at:Date|null}>(
   `SELECT n.token_standard,c.archived_at FROM nft_collections n
     INNER JOIN looke_curated_collections c
     ON c.chain_id=n.chain_id AND c.contract_address=n.contract_address
     WHERE n.chain_id=18881 AND n.contract_address=$1`,[address.toLowerCase()]);
  if(row.rowCount!==1||row.rows[0].token_standard!=="erc721")
   throw new ApiError(404,"Registered ERC-721 Testnet collection required");
  const [chain,owner,code]=await Promise.all([
   rpc.getChainId(),
   rpc.readContract({address,abi,functionName:"owner"}),
   rpc.getCode({address})
  ]).catch(()=>{throw new ApiError(503,"Unable to verify the NFT contract owner");});
  if(chain!==18881||!code||code==="0x"||owner.toLowerCase()!==session.wallet.toLowerCase())
   throw new ApiError(403,"Only the current on-chain collection owner can manage its NFT gallery");
  if(body.hidden===true){
   if(row.rows[0].archived_at)throw new ApiError(409,"Restore this collection before editing individual NFTs");
   const tokenOwner=await rpc.readContract({address,abi,functionName:"ownerOf",
     args:[tokenId]}).catch(()=>null);
   if(!tokenOwner||tokenOwner.toLowerCase()!==session.wallet.toLowerCase())
    throw new ApiError(403,"You can only hide NFTs that you currently own");
   await getDb().query(
    `INSERT INTO looke_hidden_testnet_tokens(chain_id,contract_address,token_id,hidden_by)
      VALUES(18881,$1,$2::numeric,$3)
      ON CONFLICT(chain_id,contract_address,token_id)
      DO UPDATE SET hidden_by=EXCLUDED.hidden_by,hidden_at=now()`,
    [address.toLowerCase(),rawId,session.wallet.toLowerCase()]);
  }else{
   await getDb().query(
    "DELETE FROM looke_hidden_testnet_tokens WHERE chain_id=18881 AND contract_address=$1 AND token_id=$2::numeric",
    [address.toLowerCase(),rawId]);
  }
  return noStore({address:address.toLowerCase(),tokenId:rawId,hidden:body.hidden,
   note:"Gallery visibility only; no NFT burn, transfer or chain deletion occurred"});
 }catch(error){return apiFailure(error);}
}
