import { NextRequest } from "next/server";
import {
  createPublicClient,http,isAddress,type Address,type Hex,
} from "viem";
import { requireSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ApiError,apiFailure,guardMutation,noStore,parseBody } from "@/lib/server/http";
import { ULTRA_TESTNET } from "@/lib/network";
import {
  M7_MARKET_ADDRESS, marketAbi, erc721Abi, erc1155Abi,hashListing,
  parseListingDraft,verifyListingSignature,m7Gate,
  type ListingDraft
} from "@/lib/m7/market";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const publicClient=createPublicClient({
 transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})
});

export async function GET(request:NextRequest){
 try{
  const session=await requireSession(request);
  const self=request.nextUrl.searchParams.get("scope")==="mine";
  const query=self
  ? `SELECT order_hash,marketplace,seller_wallet,collection_address,token_standard,
       token_id::text,quantity::text,unit_price_wei::text,nonce::text,deadline,
       reserved_buyer,min_proceeds_wei::text,max_fee_bps,max_royalty_bps,
       state,created_at FROM nft_m7_signed_listings
       WHERE chain_id=18881 AND seller_wallet=$1 ORDER BY created_at DESC LIMIT 30`
  : `SELECT order_hash,marketplace,seller_wallet,collection_address,token_standard,
       token_id::text,quantity::text,unit_price_wei::text,nonce::text,deadline,
       reserved_buyer,min_proceeds_wei::text,max_fee_bps,max_royalty_bps,
       state,created_at FROM nft_m7_signed_listings WHERE chain_id=18881
       AND deadline>now() ORDER BY created_at DESC LIMIT 30`;
  const result=await getDb().query(query,self?[session.wallet]:[]);
  return noStore({entries:result.rows,
    status:"read-only-signed-candidates-not-current-sale-offers",
    settlementEnabled:false,
    warning:"Database candidates are NOT proof of ownership, approval, available UOS purchase or confirmed settlement."});
 }catch(e){return apiFailure(e);}
}

export async function POST(request:NextRequest){
 try{
  guardMutation(request);
  const session=await requireSession(request);
  if(process.env.M7_LISTINGS_ENABLED!=="true"||m7Gate("list"))
    throw new ApiError(503,"Marketplace signature registration is operator-disabled or unverified");
  const body=await parseBody(request,6000);
  const signature=body.signature;
  if(typeof signature!=="string"||!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new ApiError(400,"Expected a genuine EOA EIP-712 signature");
  if(!body.listing||typeof body.listing!=="object"||Array.isArray(body.listing))
    throw new ApiError(400,"Listing fields are required");
  const data=body.listing as Record<string,unknown>;
  const allowed=["collection","tokenId","quantity","unitPriceUOS","nonce",
    "deadlineSeconds","reservedBuyer","minSellerProceedsUOS","maxFeeBps","maxRoyaltyBps","standard"];
  if(Object.keys(data).some(k=>!allowed.includes(k))||
     allowed.some(k=>typeof data[k]!=="string"))
    throw new ApiError(400,"Unexpected or missing listing fields");
  const draft=data as unknown as ListingDraft;
  const seller=session.wallet as Address;
  const order=parseListingDraft(draft,seller);
  const market=M7_MARKET_ADDRESS as Address;
  if(!await verifyListingSignature(order,market,signature as Hex))
    throw new ApiError(401,"EIP-712 seller signature does not match session wallet and market domain");
  if(await publicClient.getChainId()!==18881)throw new ApiError(503,"Wrong RPC chain");
  const code=await publicClient.getCode({address:market});
  const version=await publicClient.readContract({address:market,abi:marketAbi,functionName:"VERSION"});
  const onchainHash=await publicClient.readContract({
    address:market,abi:marketAbi,functionName:"hashListing",args:[order]
  });
  const digest=hashListing(order,market);
  if(!code||code==="0x"||version!==1n||onchainHash.toLowerCase()!==digest.toLowerCase())
    throw new ApiError(503,"Marketplace deployed contract/version/order hash not verified");
  const registry=await getDb().query<{token_standard:string}>(
    `SELECT token_standard FROM nft_collections
      WHERE chain_id=18881 AND contract_address=$1`,[order.collection.toLowerCase()]
  );
  const standard=order.standard===1?"erc721":"erc1155";
  if(registry.rowCount!==1||registry.rows[0].token_standard!==standard)
    throw new ApiError(404,"NFT collection is not approved in the real M3 registry");
  // Re-read direct Testnet owner/approval; an old indexer row does NOT authorise a sale.
  const [approved,nonceFloor,nonceConsumed]=await Promise.all([
    publicClient.readContract({address:market,abi:marketAbi,functionName:"isFillable",
      args:[order,signature as Hex]}),
    publicClient.readContract({address:market,abi:marketAbi,functionName:"minimumNonce",
      args:[seller]}),
    publicClient.readContract({address:market,abi:marketAbi,functionName:"invalidNonces",
      args:[seller,order.nonce]})
  ]);
  if(!approved||nonceConsumed||order.nonce<nonceFloor)
    throw new ApiError(409,"NFT ownership, transfer approval, nonce or seller signature is not currently valid");
  if(standard==="erc721"){
    const [owner,isApproved,allApproved]=await Promise.all([
      publicClient.readContract({address:order.collection,abi:erc721Abi,functionName:"ownerOf",args:[order.tokenId]}),
      publicClient.readContract({address:order.collection,abi:erc721Abi,functionName:"getApproved",args:[order.tokenId]}),
      publicClient.readContract({address:order.collection,abi:erc721Abi,functionName:"isApprovedForAll",args:[seller,market]})
    ]);
    if(owner.toLowerCase()!==seller.toLowerCase()||
      (!allApproved&&isApproved.toLowerCase()!==market.toLowerCase()))
      throw new ApiError(409,"Seller no longer owns/approves the actual ERC721 token");
  } else {
    const [balance,isApproved]=await Promise.all([
      publicClient.readContract({address:order.collection,abi:erc1155Abi,functionName:"balanceOf",args:[seller,order.tokenId]}),
      publicClient.readContract({address:order.collection,abi:erc1155Abi,functionName:"isApprovedForAll",args:[seller,market]})
    ]);
    if(balance<order.quantity||!isApproved)
      throw new ApiError(409,"Seller balance/approval insufficient for ERC1155 quantity");
  }
  const db=getDb();
  const result=await db.query<{order_hash:string}>(
    `INSERT INTO nft_m7_signed_listings (
      order_hash,marketplace,seller_wallet,collection_address,token_standard,
      token_id,quantity,unit_price_wei,nonce,deadline,reserved_buyer,
      min_proceeds_wei,max_fee_bps,max_royalty_bps,signature,
      last_rpc_checked_at,last_rpc_fillable,last_rpc_block
    ) VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10,$11,$12::numeric,$13,$14,$15,
      now(),true,$16)
    RETURNING order_hash`,
    [digest.toLowerCase(),market.toLowerCase(),seller.toLowerCase(),order.collection.toLowerCase(),
      standard,order.tokenId.toString(),order.quantity.toString(),order.unitPriceWei.toString(),
      order.nonce.toString(),new Date(Number(order.deadline)*1000),
      order.reservedBuyer==="0x0000000000000000000000000000000000000000"?null:order.reservedBuyer.toLowerCase(),
      order.minSellerProceedsWei.toString(),order.maxFeeBps,order.maxRoyaltyBps,
      signature.toLowerCase(),(await publicClient.getBlockNumber()).toString()]
  );
  return noStore({orderHash:result.rows[0].order_hash,status:"registered-signed-candidate",
    note:"Stored genuine signature and source-backed preflight only. Ownership/approval may change; no NFT is escrowed or sold."},201);
 }catch(e){return apiFailure(e);}
}
