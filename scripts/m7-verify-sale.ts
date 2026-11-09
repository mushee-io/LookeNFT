/**
 * M7 operator-only REAL settlement evidence verifier. No keys or transactions.
 * Refuses to journal without independent Ultra Testnet RPC AND Blockscout
 * confirmation, matching EIP712 calldata, NFT transfer and value split.
 */
import {
  createPublicClient,http,parseEventLogs,decodeFunctionData,isAddress,
  type Hex,type Address
} from "viem";
import { ULTRA_TESTNET } from "../lib/network";
import { marketAbi,erc721Abi,erc1155Abi,hashListing,type Listing } from "../lib/m7/market";
import { getDb } from "../lib/server/db";

const ZERO="0x"+"0".repeat(40);
function normalized(x:string){return x.toLowerCase();}
async function main(){
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw Error("M7 independent verifier is Testnet-only");
 const market=process.env.M7_MARKET_ADDRESS||"";
 const txHash=process.env.M7_SALE_TX_HASH||"";
 const external=process.env.M7_INDEPENDENT_RPC_URL||"";
 if(!isAddress(market,{strict:false})||!/^0x[0-9a-fA-F]{64}$/.test(txHash))
  throw Error("Actual M7 market address and buyer-approved transaction hash required");
 const secondary=new URL(external);
 if(secondary.protocol!=="https:"||secondary.username||secondary.password||
    secondary.hostname===new URL(ULTRA_TESTNET.rpcUrl).hostname)
  throw Error("Independent RPC must be another real HTTPS provider");
 const a=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
 const b=createPublicClient({transport:http(external,{timeout:12000,retryCount:1})});
 if(await a.getChainId()!==18881||await b.getChainId()!==18881)
  throw Error("M7 independent RPC chain ID mismatch");
 const addr=market as Address,hash=txHash as Hex;
 const [tx,ra,rb,headA,headB,codeA,codeB,versionA,versionB]=await Promise.all([
  a.getTransaction({hash}),a.getTransactionReceipt({hash}),b.getTransactionReceipt({hash}),
  a.getBlockNumber(),b.getBlockNumber(),a.getCode({address:addr}),
  b.getCode({address:addr}),
  a.readContract({address:addr,abi:marketAbi,functionName:"VERSION"}),
  b.readContract({address:addr,abi:marketAbi,functionName:"VERSION"})
 ]);
 if(!codeA||codeA==="0x"||codeA!==codeB||versionA!==1n||versionB!==1n||
   ra.status!=="success"||rb.status!=="success"||tx.chainId!==18881||
   normalized(tx.to||"")!==normalized(market)||ra.blockNumber!==rb.blockNumber||
   normalized(ra.blockHash)!==normalized(rb.blockHash))
  throw Error("Market bytecode, version, approved transaction or receipts disagree");
 if(ra.blockNumber+12n>headA||ra.blockNumber+12n>headB)
  throw Error("External Testnet receipt lacks 12-block confirmation");
 const [ba,bb]=await Promise.all([
  a.getBlock({blockNumber:ra.blockNumber}),b.getBlock({blockNumber:ra.blockNumber})
 ]);
 if(normalized(ba.hash)!==normalized(ra.blockHash)||normalized(bb.hash)!==normalized(ra.blockHash))
  throw Error("Independent canonical block witness disagrees");
 const explorerURL=ULTRA_TESTNET.explorerUrl+"/api/v2/transactions/"+txHash;
 const response=await fetch(explorerURL,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error("Blockscout independent source failed: HTTP "+response.status);
 const data=await response.json() as {hash?:string;block_hash?:string;block?:number;status?:string};
 if(normalized(data.hash||"")!==normalized(txHash)||
   normalized(data.block_hash||"")!==normalized(ra.blockHash)||
   data.block!==Number(ra.blockNumber)||data.status!=="ok")
  throw Error("Explorer evidence differs from both RPCs");
 const decoded=decodeFunctionData({abi:marketAbi,data:tx.input});
 if(decoded.functionName!=="buy")throw Error("Settlement transaction is not buy");
 const [order,signature]=decoded.args as unknown as [Listing,Hex];
 const computed=hashListing(order,addr);
 const events=parseEventLogs({abi:marketAbi,logs:ra.logs,eventName:"ListingFilled"});
 const other=parseEventLogs({abi:marketAbi,logs:rb.logs,eventName:"ListingFilled"});
 const matched=events.filter(e=>normalized(e.address)===normalized(market)&&
   normalized(e.args.orderHash)===normalized(computed));
 const corroborated=other.filter(e=>normalized(e.address)===normalized(market)&&
   normalized(e.args.orderHash)===normalized(computed));
 if(matched.length!==1||corroborated.length!==1)
  throw Error("Unique independently confirmed ListingFilled event missing");
 const ev=matched[0],otherEvent=corroborated[0];
 if(ev.args.seller.toLowerCase()!==order.seller.toLowerCase()||
    ev.args.buyer.toLowerCase()!==tx.from.toLowerCase()||
    ev.args.priceWei!==tx.value||
    ev.args.priceWei!==order.unitPriceWei*order.quantity||
    ev.args.priceWei!==ev.args.feeWei+ev.args.royaltyWei+ev.args.sellerProceedsWei||
    ev.args.feeWei!==tx.value*200n/10000n||
    ev.args.royaltyWei>tx.value*1000n/10000n||
    ev.args.quantity!==order.quantity||
    ev.args.nonce!==order.nonce||
    ev.args.standard!==order.standard||
    ev.args.feeWei!==otherEvent.args.feeWei||
    ev.args.royaltyWei!==otherEvent.args.royaltyWei||
    ev.args.sellerProceedsWei!==otherEvent.args.sellerProceedsWei)
  throw Error("Settlement accounting, signature-bound terms or event proof disagree");
 if(!signature||signature==="0x")throw Error("Settlement calldata missing genuine signature");
 const db=getDb();
 const saved=await db.query<{order_hash:string;marketplace:string;seller_wallet:string;collection_address:string;nonce:string}>(
  "SELECT order_hash,marketplace,seller_wallet,collection_address,nonce::text FROM nft_m7_signed_listings WHERE order_hash=$1 AND chain_id=18881",
  [computed.toLowerCase()]
 );
 if(saved.rowCount!==1||normalized(saved.rows[0].marketplace)!==normalized(market)||
   normalized(saved.rows[0].seller_wallet)!==normalized(order.seller)||
   normalized(saved.rows[0].collection_address)!==normalized(order.collection)||
   BigInt(saved.rows[0].nonce)!==order.nonce)
  throw Error("Only real previously authorised signed listing candidates may be journalled");
 const transfers=order.standard===1
 ?parseEventLogs({abi:marketAbi,logs:ra.logs,eventName:"Transfer"}).filter(e=>
    normalized(e.address)===normalized(order.collection)&&e.args.tokenId===order.tokenId&&
    normalized(e.args.from)===normalized(order.seller)&&normalized(e.args.to)===normalized(tx.from))
 :parseEventLogs({abi:marketAbi,logs:ra.logs,eventName:"TransferSingle"}).filter(e=>
    normalized(e.address)===normalized(order.collection)&&e.args.id===order.tokenId&&
    e.args.value===order.quantity&&normalized(e.args.from)===normalized(order.seller)&&
    normalized(e.args.to)===normalized(tx.from));
 if(transfers.length!==1)throw Error("No unique exact NFT delivery transfer in independently agreed receipt");
 if(order.standard===1){
  const owner=await a.readContract({address:order.collection,abi:erc721Abi,
    functionName:"ownerOf",args:[order.tokenId],blockNumber:ra.blockNumber});
  if(normalized(owner)!==normalized(tx.from))throw Error("ERC721 ownership at receipt block differs");
 } else {
  const balance=await a.readContract({address:order.collection,abi:erc1155Abi,
    functionName:"balanceOf",args:[tx.from,order.tokenId],blockNumber:ra.blockNumber});
  if(balance<order.quantity)throw Error("ERC1155 receipt-block buyer balance below delivery");
 }
 const listingHash=computed.toLowerCase();
 const logIndex=ev.logIndex;
 if(logIndex===null||logIndex===undefined)throw Error("Missing real event log index");
 const row=[
   18881,txHash.toLowerCase(),logIndex,listingHash,ra.blockNumber.toString(),
   ra.blockHash.toLowerCase(),order.seller.toLowerCase(),tx.from.toLowerCase(),
   order.collection.toLowerCase(),order.tokenId.toString(),order.quantity.toString(),
   ev.args.priceWei.toString(),ev.args.feeWei.toString(),ev.args.royaltyWei.toString(),
   ev.args.sellerProceedsWei.toString(),ev.args.royaltyRecipient.toLowerCase()===ZERO?null:ev.args.royaltyRecipient.toLowerCase(),
   ULTRA_TESTNET.rpcUrl,external,ULTRA_TESTNET.explorerUrl+"/tx/"+txHash
 ];
 const client=await db.connect();
 try{
  await client.query("BEGIN");
  const recorded=await client.query(
   `INSERT INTO nft_m7_verified_settlements(
     chain_id,tx_hash,log_index,order_hash,block_number,block_hash,seller_wallet,
     buyer_wallet,collection_address,token_id,quantity,price_wei,fee_wei,
     royalty_wei,seller_proceeds_wei,royalty_recipient,primary_rpc,independent_rpc,explorer_tx_url
   ) VALUES(${row.map((_,i)=>"$"+(i+1)).join(",")})
   ON CONFLICT DO NOTHING RETURNING tx_hash`,row
  );
  if(recorded.rowCount!==1)throw Error("Duplicate or replayed verified settlement");
  const changed=await client.query(
   "UPDATE nft_m7_signed_listings SET state='filled_verified' WHERE order_hash=$1 AND state='unverified_candidate' RETURNING order_hash",
   [listingHash]
  );
  if(changed.rowCount!==1)throw Error("Signed order was not eligible for verified settlement");
  await client.query("COMMIT");
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 console.log(JSON.stringify({
   status:"independent-RPC-plus-Blockscout-settlement-witness",
   orderHash:computed,txHash,blockHash:ra.blockHash,blockNumber:ra.blockNumber.toString(),
   amountUOSWei:tx.value.toString(),tokenId:order.tokenId.toString(),
   auditApproved:false,mainnetExecuted:false
 }));
}
main().catch(e=>{
 console.error(JSON.stringify({status:"NO_GO_UNVERIFIED",reason:e instanceof Error?e.message:String(e),
   fabricatedSettlement:false,transactionBroadcast:false}));
 process.exitCode=1;
});
