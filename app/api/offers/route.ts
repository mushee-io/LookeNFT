import { NextRequest } from "next/server";
import {createPublicClient,http,decodeFunctionData,parseEventLogs,isAddress,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "@/lib/network";
import {requireSession} from "@/lib/server/auth";
import {getDb} from "@/lib/server/db";
import {ApiError,apiFailure,guardMutation,noStore,parseBody} from "@/lib/server/http";
import {
 M8_VAULT,offerAbi,parseOffer,offerHash,verifyOfferEOA,offerJson,m8Gate,type OfferDraft,
} from "@/lib/m8/offers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});

export async function GET(request:NextRequest){
 try{
  const session=await requireSession(request);
  const scope=request.nextUrl.searchParams.get("scope");
  const mine=scope==="mine";
  const data=await getDb().query(
   `SELECT offer_hash,vault_address,buyer_wallet,collection_address,token_standard,
     token_id::text,quantity::text,total_price_wei::text,nonce::text,expires_at,
     allowed_seller,min_seller_proceeds_wei::text,max_fee_bps,max_royalty_bps,
     funding_tx_hash,state,first_seen_at
     FROM nft_m8_offer_candidates
     WHERE chain_id=18881 AND ${mine?"buyer_wallet=$1":"state='independently_funded' AND expires_at>now()"}
     ORDER BY first_seen_at DESC LIMIT 50`,
   mine?[session.wallet]:[]
  );
  // Public discovery only contains *independently verified* real funded offers.
  // The viewer cannot infer ownership, seller approval or acceptance from these rows.
  return noStore({offers:data.rows,scope:mine?"own-wallet":"independent-funded-only",
   liveExecutionEnabled:false,warning:"Signed/escrowed offers may be cancelled, expired or no longer fillable. Query actual Testnet before wallet action."});
 }catch(e){return apiFailure(e);}
}

export async function POST(request:NextRequest){
 try{
  guardMutation(request);
  const session=await requireSession(request);
  if(process.env.M8_OFFER_RECORDING_ENABLED!=="true"||m8Gate("fund"))
   throw new ApiError(503,"M8 offer receipt registration is disabled without real operator evidence");
  const body=await parseBody(request,7000);
  if(!body.offer||typeof body.offer!=="object"||Array.isArray(body.offer))
   throw new ApiError(400,"Offer draft required");
  const raw=body.offer as Record<string,unknown>;
  const keys=["collection","tokenId","quantity","totalPriceUOS","nonce","deadline",
   "allowedSeller","minSellerProceedsUOS","maxFeeBps","maxRoyaltyBps","standard"];
  if(Object.keys(raw).some(k=>!keys.includes(k))||keys.some(k=>typeof raw[k]!=="string"))
   throw new ApiError(400,"Offer fields invalid");
  if(typeof body.signature!=="string"||!/^0x[0-9a-fA-F]{130}$/.test(body.signature)||
     typeof body.txHash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(body.txHash))
   throw new ApiError(400,"Genuine EOA signature and real funding transaction hash required");
  const buyer=session.wallet as Address;
  const offer=parseOffer(raw as unknown as OfferDraft,buyer);
  const vault=M8_VAULT as Address,signature=body.signature as Hex,txHash=body.txHash as Hex;
  if(!await verifyOfferEOA(offer,vault,signature))
   throw new ApiError(401,"Buyer EIP-712 signature does not match authenticated wallet");
  if(await rpc.getChainId()!==18881)throw new ApiError(503,"Wrong Ultra EVM chain");
  const [code,version,tx,receipt,head,contractHash,state,nonceHash,locked]=await Promise.all([
   rpc.getCode({address:vault}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"VERSION"}),
   rpc.getTransaction({hash:txHash}),
   rpc.getTransactionReceipt({hash:txHash}),
   rpc.getBlockNumber(),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"offerHash",args:[offer]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"offerState",args:[offerHash(offer,vault)]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"fundedNonceHash",args:[buyer,offer.nonce]}),
   rpc.readContract({address:vault,abi:offerAbi,functionName:"buyerLockedWei",args:[buyer]})
  ]);
  const digest=offerHash(offer,vault);
  if(!code||code==="0x"||version!==1n||contractHash.toLowerCase()!==digest.toLowerCase()||
     tx.chainId!==18881||tx.from.toLowerCase()!==buyer.toLowerCase()||
     tx.to?.toLowerCase()!==vault.toLowerCase()||tx.value!==offer.totalPriceWei||
     receipt.status!=="success"||head<receipt.blockNumber+2n||
     nonceHash.toLowerCase()!==digest.toLowerCase()||state!==1||locked<offer.totalPriceWei)
   throw new ApiError(409,"No currently funded, wallet-approved matching Testnet offer is evidenced");
  const decoded=decodeFunctionData({abi:offerAbi,data:tx.input});
  if(decoded.functionName!=="fund")throw new ApiError(409,"Transaction is not the exact funded-offer call");
  const [actualOrder,actualSignature]=decoded.args;
  if(offerHash(actualOrder,vault).toLowerCase()!==digest.toLowerCase()||
     actualSignature.toLowerCase()!==signature.toLowerCase())
   throw new ApiError(409,"Funding calldata, order hash or wallet signature differs");
  const events=parseEventLogs({abi:offerAbi,logs:receipt.logs,eventName:"OfferFunded"});
  if(events.filter(e=>e.address.toLowerCase()===vault.toLowerCase()&&
      e.args.offerHash.toLowerCase()===digest.toLowerCase()&&
      e.args.buyer.toLowerCase()===buyer.toLowerCase()&&
      e.args.totalPriceWei===offer.totalPriceWei).length!==1)
   throw new ApiError(409,"Matching real funding event absent from primary RPC");
  const standard=offer.standard===1?"erc721":"erc1155";
  const registry=await getDb().query<{token_standard:string}>(
   "SELECT token_standard FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",
   [offer.collection.toLowerCase()]
  );
  if(registry.rowCount!==1||registry.rows[0].token_standard!==standard)
   throw new ApiError(404,"NFT contract not in approved real M3 Testnet registry");
  const saved=await getDb().query<{offer_hash:string}>(
   `INSERT INTO nft_m8_offer_candidates(
    offer_hash,vault_address,buyer_wallet,collection_address,token_standard,
    token_id,quantity,total_price_wei,nonce,expires_at,allowed_seller,
    min_seller_proceeds_wei,max_fee_bps,max_royalty_bps,signature,
    funding_tx_hash,funding_block_number,funding_block_hash
   ) VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,
    $10,$11,$12::numeric,$13,$14,$15,$16,$17,$18)
    RETURNING offer_hash`,
   [digest.toLowerCase(),vault.toLowerCase(),buyer.toLowerCase(),offer.collection.toLowerCase(),
    standard,offer.tokenId.toString(),offer.quantity.toString(),offer.totalPriceWei.toString(),
    offer.nonce.toString(),new Date(Number(offer.deadline)*1000),
    offer.allowedSeller.toLowerCase()==="0x"+"0".repeat(40)?null:offer.allowedSeller.toLowerCase(),
    offer.minSellerProceedsWei.toString(),offer.maxFeeBps,offer.maxRoyaltyBps,
    signature.toLowerCase(),txHash.toLowerCase(),receipt.blockNumber.toString(),receipt.blockHash.toLowerCase()]
  );
  return noStore({offer:offerJson(offer),offerHash:saved.rows[0].offer_hash,
   state:"primary_rpc_funded_unverified",primaryRpcOnly:true,
   warning:"NOT independently verified: requires two RPCs, Blockscout, 12-block finality and human operator review."},201);
 }catch(e){return apiFailure(e);}
}
