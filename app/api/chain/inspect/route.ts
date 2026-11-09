import { NextRequest } from "next/server";
import { createPublicClient, getAddress, http, isAddress, keccak256, parseAbi } from "viem";
import { ULTRA_TESTNET } from "@/lib/network";
import { isSuccessfulDirectCreation } from "@/lib/testnet/direct-creation";
import { ApiError, apiFailure, noStore } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rpc = createPublicClient({
 transport: http(ULTRA_TESTNET.rpcUrl, {timeout:12000, retryCount:1})
});
const abi = parseAbi([
 "function owner() view returns (address)",
 "function supportsInterface(bytes4) view returns (bool)",
 "function name() view returns (string)",
 "function symbol() view returns (string)",
 "function baseTokenURI() view returns (string)",
 "function maxSupply() view returns (uint256)",
 "function totalMinted() view returns (uint256)",
 "function ownerOf(uint256) view returns (address)",
 "function tokenURI(uint256) view returns (string)"
]);

/** Read-only inspection of an existing Ultra EVM ERC-721 collection.
 * There is no database write, wallet signature, mint, or transaction.
 * Any returned token must be independently confirmed by ownerOf.
 */
export async function GET(request:NextRequest) {
 try {
  const rawAddress = request.nextUrl.searchParams.get("address") || "";
  const rawTx = request.nextUrl.searchParams.get("tx") || "";
  if(!isAddress(rawAddress,{strict:false}) || !/^0x[\da-fA-F]{64}$/.test(rawTx))
   throw new ApiError(400,"Valid NFT address and deployment transaction hash required");
  const address = getAddress(rawAddress);
  const hash = rawTx as `0x${string}`;
  const [chainId, receipt, transaction, checkedBlock] = await Promise.all([
   rpc.getChainId(),
   rpc.getTransactionReceipt({hash}),
   rpc.getTransaction({hash}),
   rpc.getBlockNumber()
  ]);
  if(chainId!==18881)throw new ApiError(503,"Not Ultra EVM Testnet");
  if(!isSuccessfulDirectCreation(transaction,receipt) ||
     !receipt.contractAddress ||
     receipt.contractAddress.toLowerCase()!==address.toLowerCase() ||
     transaction.from.toLowerCase()!==receipt.from.toLowerCase())
    throw new ApiError(409,"Not a successful direct NFT contract creation");
  const [code,owner,erc721,name,symbol,baseURI,maxSupply,totalMinted]=await Promise.all([
   rpc.getCode({address,blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"owner",blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"supportsInterface",args:["0x80ac58cd"],blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"name",blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"symbol",blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"baseTokenURI",blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"maxSupply",blockNumber:checkedBlock}),
   rpc.readContract({address,abi,functionName:"totalMinted",blockNumber:checkedBlock})
  ]);
  if(!code||code==="0x"||!erc721||owner.toLowerCase()!==transaction.from.toLowerCase())
   throw new ApiError(409,"ERC-721 bytecode, ownership or interface proof invalid");
  const tokens: Array<{tokenId:string; owner:string;tokenURI:string}>=[];
  if(totalMinted>0n){
   const [firstOwner,firstURI]=await Promise.all([
    rpc.readContract({address,abi,functionName:"ownerOf",args:[1n],blockNumber:checkedBlock}),
    rpc.readContract({address,abi,functionName:"tokenURI",args:[1n],blockNumber:checkedBlock})
   ]);
   tokens.push({tokenId:"1",owner:firstOwner.toLowerCase(),tokenURI:firstURI});
  }
  return noStore({
   chainId:18881,address:address.toLowerCase(),standard:"erc721",verified:true,
   deployment:{hash:receipt.transactionHash,creator:receipt.from.toLowerCase(),
    blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash},
   contract:{codeHash:keccak256(code),checkedBlock:checkedBlock.toString(),
    owner:owner.toLowerCase(),name,symbol,baseURI,maxSupply:maxSupply.toString(),
    totalMinted:totalMinted.toString()},tokens,
   source:"independent read-only Ultra Testnet RPC",
   limitations:"Mint token ID #1 verified by ownerOf, not an indexer event or marketplace listing"
  });
 }catch(error){return apiFailure(error);}
}
