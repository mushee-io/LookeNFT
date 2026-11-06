/**
 * M8 operator-only read-only independent UOS offer evidence verifier.
 * Actual RPCs + real Blockscout tx status are mandatory; never broadcasts,
 * seeds fake offers, signs transactions, or claims audit approval.
 */
import {createPublicClient,http,decodeFunctionData,parseEventLogs,isAddress,type Hex,type Address} from "viem";
import {ULTRA_TESTNET} from "../lib/network";
import {offerAbi,offerHash,verifyOfferEOA,type Offer} from "../lib/m8/offers";
import {getDb} from "../lib/server/db";
const ZERO="0x"+"0".repeat(40);
const lc=(x:string)=>x.toLowerCase();
async function main(){
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")throw Error("M8 verifier restricted to Ultra EVM Testnet");
 const vault=process.env.M8_VAULT_ADDRESS||"",hash=process.env.M8_EVENT_TX_HASH||"";
 const external=process.env.M8_INDEPENDENT_RPC_URL||"";
 const kind=process.env.M8_EVENT_KIND||"";
 if(!["funded","accepted","refunded"].includes(kind)||!isAddress(vault,{strict:false})||
  !/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error("Real vault, event kind and funding/settlement/refund hash required");
 const secondary=new URL(external),primary=new URL(ULTRA_TESTNET.rpcUrl);
 if(secondary.protocol!=="https:"||secondary.username||secondary.password||
  secondary.hostname===primary.hostname||secondary.hash)
  throw Error("Independent RPC must be another operator-controlled HTTPS provider");
 const a=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
 const b=createPublicClient({transport:http(external,{timeout:12000,retryCount:1})});
 const contract=vault as Address,txHash=hash as Hex;
 const [chainA,chainB,tx,ra,rb,ha,hb,codeA,codeB,va,vb]=await Promise.all([
  a.getChainId(),b.getChainId(),a.getTransaction({hash:txHash}),
  a.getTransactionReceipt({hash:txHash}),b.getTransactionReceipt({hash:txHash}),
  a.getBlockNumber(),b.getBlockNumber(),a.getCode({address:contract}),b.getCode({address:contract}),
  a.readContract({address:contract,abi:offerAbi,functionName:"VERSION"}),
  b.readContract({address:contract,abi:offerAbi,functionName:"VERSION"})
 ]);
 if(chainA!==18881||chainB!==18881||tx.chainId!==18881||lc(tx.to||"")!==lc(vault)||
  !codeA||codeA==="0x"||codeA!==codeB||va!==1n||vb!==1n||
  ra.status!=="success"||rb.status!=="success"||ra.blockNumber!==rb.blockNumber||
  lc(ra.blockHash)!==lc(rb.blockHash)||ra.blockNumber+12n>ha||ra.blockNumber+12n>hb)
  throw Error("Two RPC providers lack common canonical funded offer transaction and version evidence");
 const [blockA,blockB]=await Promise.all([
  a.getBlock({blockNumber:ra.blockNumber}),b.getBlock({blockNumber:ra.blockNumber})
 ]);
 if(lc(blockA.hash)!==lc(ra.blockHash)||lc(blockB.hash)!==lc(ra.blockHash))
  throw Error("Independent block hashes disagree");
 const explorer=ULTRA_TESTNET.explorerUrl+"/api/v2/transactions/"+hash;
 const response=await fetch(explorer,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error("Blockscout independent HTTP "+response.status+"; no verified offer");
 const body=await response.json() as {hash?:string;block_hash?:string;block?:number;status?:string};
 if(lc(body.hash||"")!==lc(hash)||lc(body.block_hash||"")!==lc(ra.blockHash)||
  body.block!==Number(ra.blockNumber)||body.status!=="ok")
  throw Error("Blockscout transaction/block/status differs from independent RPCs");
 const decoded=decodeFunctionData({abi:offerAbi,data:tx.input});
 const expectedFn=kind==="funded"?"fund":kind==="accepted"?"accept":null;
 if(expectedFn&&decoded.functionName!==expectedFn)throw Error("Offer event kind does not match signed transaction calldata");
 if(kind==="refunded"&&!["refundTo","refundExpired"].includes(decoded.functionName))
  throw Error("Missing actual refunded offer transaction calldata");
 const args=decoded.args;
 const o=args[0] as Offer,digest=offerHash(o,contract);
 const onchainHash=await a.readContract({address:contract,abi:offerAbi,functionName:"offerHash",args:[o]});
 if(lc(digest)!==lc(onchainHash))throw Error("Off-chain buyer EIP712 hash differs from contract hash");
 const events=kind==="funded"?"OfferFunded":kind==="accepted"?"OfferAccepted":"OfferRefunded";
 const primaryEvents=parseEventLogs({abi:offerAbi,logs:ra.logs,eventName:events});
 const secondaryEvents=parseEventLogs({abi:offerAbi,logs:rb.logs,eventName:events});
 const matched=primaryEvents.filter(e=>lc(e.address)===lc(vault)&&lc(e.args.offerHash)===lc(digest));
 const other=secondaryEvents.filter(e=>lc(e.address)===lc(vault)&&lc(e.args.offerHash)===lc(digest));
 if(matched.length!==1||other.length!==1)throw Error("Independent unique offer event missing");
 const ev=matched[0];
 if(kind==="funded"){
  const signature=args[1] as Hex;
  if(tx.value!==o.totalPriceWei||lc(tx.from)!==lc(o.buyer)||!await verifyOfferEOA(o,contract,signature)||
    ev.args.totalPriceWei!==o.totalPriceWei||lc(ev.args.buyer)!==lc(o.buyer))
   throw Error("Buyer signature, exact funded UOS or event differs");
 }else if(kind==="accepted"){
  if(tx.value!==0n||lc(tx.from)!==lc(ev.args.seller)||lc(ev.args.buyer)!==lc(o.buyer)||
    ev.args.totalPriceWei!==o.totalPriceWei||
    ev.args.totalPriceWei!==ev.args.feeWei+ev.args.royaltyWei+ev.args.sellerProceedsWei||
    ev.args.feeWei!==o.totalPriceWei*200n/10000n||
    ev.args.royaltyWei>o.totalPriceWei*1000n/10000n||
    ev.args.nonce!==o.nonce||ev.args.quantity!==o.quantity||
    ev.args.tokenId!==o.tokenId||lc(ev.args.collection)!==lc(o.collection))
   throw Error("Accepted offer NFT, buyer/seller, fee, royalty or proceeds disagree");
  const transferName=o.standard===1?"Transfer":"TransferSingle";
  const transfers=parseEventLogs({abi:offerAbi,logs:ra.logs,eventName:transferName});
  const proof=transfers.filter(e=>
   lc(e.address)===lc(o.collection)&&
   lc(e.args.from)===lc(ev.args.seller)&&lc(e.args.to)===lc(o.buyer)&&
   (o.standard===1?e.args.tokenId===o.tokenId:
     e.args.id===o.tokenId&&e.args.value===o.quantity));
  if(proof.length!==1)throw Error("Independently matched real NFT transfer absent");
  if(o.standard===1){
   const owner=await a.readContract({address:o.collection,
    abi:[{type:"function",name:"ownerOf",inputs:[{name:"id",type:"uint256"}],
      outputs:[{type:"address"}],stateMutability:"view"}] as const,
    functionName:"ownerOf",args:[o.tokenId],blockNumber:ra.blockNumber});
   if(lc(owner)!==lc(o.buyer))throw Error("NFT owner at settlement block differs from buyer");
  }else {
   const balance=await a.readContract({address:o.collection,
    abi:[{type:"function",name:"balanceOf",
     inputs:[{name:"owner",type:"address"},{name:"id",type:"uint256"}],
     outputs:[{type:"uint256"}],stateMutability:"view"}] as const,
    functionName:"balanceOf",args:[o.buyer,o.tokenId],blockNumber:ra.blockNumber});
   if(balance<o.quantity)throw Error("ERC1155 buyer balance lower than transfer at block");
  }
 }else{
  if(tx.value!==0n||ev.args.amountWei!==o.totalPriceWei||lc(ev.args.buyer)!==lc(o.buyer)||
     ev.args.nonce!==o.nonce||!ev.args.recipient)
   throw Error("Refund recipient, UOS amount or offer nonce differs");
 }
 const db=getDb();
 const candidate=await db.query<{
  vault_address:string;buyer_wallet:string;collection_address:string;total_price_wei:string;state:string
 }>(
  "SELECT vault_address,buyer_wallet,collection_address,total_price_wei::text,state FROM nft_m8_offer_candidates WHERE chain_id=18881 AND offer_hash=$1",
  [lc(digest)]
 );
 if(candidate.rowCount!==1||lc(candidate.rows[0].vault_address)!==lc(vault)||
  lc(candidate.rows[0].buyer_wallet)!==lc(o.buyer)||
  lc(candidate.rows[0].collection_address)!==lc(o.collection)||
  BigInt(candidate.rows[0].total_price_wei)!==o.totalPriceWei)
  throw Error("No real registered buyer offer matching the exact chain event");
 const logIndex=ev.logIndex;
 if(logIndex===undefined||logIndex===null)throw Error("Actual log index missing");
 const fee=kind==="accepted"?ev.args.feeWei:0n;
 const royalty=kind==="accepted"?ev.args.royaltyWei:0n;
 const proceeds=kind==="accepted"?ev.args.sellerProceedsWei:0n;
 const counterparty=kind==="accepted"?ev.args.seller:kind==="refunded"?ev.args.recipient:null;
 const values=[18881,lc(hash),logIndex,lc(digest),kind,ra.blockNumber.toString(),
  lc(ra.blockHash),lc(o.buyer),counterparty?lc(counterparty):null,lc(o.collection),
  o.totalPriceWei.toString(),fee.toString(),royalty.toString(),proceeds.toString(),
  ULTRA_TESTNET.rpcUrl,external,ULTRA_TESTNET.explorerUrl+"/tx/"+hash];
 const conn=await db.connect();
 try{
  await conn.query("BEGIN");
  const inserted=await conn.query(
   `INSERT INTO nft_m8_verified_offer_events(
    chain_id,tx_hash,log_index,offer_hash,event_kind,block_number,block_hash,
    buyer_wallet,counterparty_wallet,collection_address,total_price_wei,
    fee_wei,royalty_wei,seller_proceeds_wei,primary_rpc,independent_rpc,explorer_url
   ) VALUES(${values.map((_,i)=>"$"+(i+1)).join(",")}) ON CONFLICT DO NOTHING RETURNING tx_hash`,values
  );
  if(inserted.rowCount!==1)throw Error("Duplicate/replayed evidence is rejected");
  const next=kind==="funded"?"independently_funded":kind==="accepted"?"accepted_verified":"refunded_verified";
  const required=kind==="funded"?"primary_rpc_funded_unverified":"independently_funded";
  const changed=await conn.query(
   `UPDATE nft_m8_offer_candidates SET state=$2,independently_checked_at=now()
      WHERE offer_hash=$1 AND state=$3 RETURNING offer_hash`,[lc(digest),next,required]
  );
  if(changed.rowCount!==1)throw Error("Invalid offer evidence state transition");
  await conn.query("COMMIT");
 }catch(e){await conn.query("ROLLBACK");throw e;}finally{conn.release();}
 console.log(JSON.stringify({status:"INDEPENDENTLY_VERIFIED",kind,offerHash:digest,
  txHash:hash,blockHash:ra.blockHash,chainId:18881,noNewFinancialTransaction:true,securityAuditSigned:false}));
}
main().catch(e=>{
 console.error(JSON.stringify({status:"NO_GO_UNVERIFIED",reason:e instanceof Error?e.message:String(e),
  noSyntheticEvidence:true,noTransactionBroadcast:true}));
 process.exitCode=1;
});
