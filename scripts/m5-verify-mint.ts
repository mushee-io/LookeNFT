/**
 * M5 operator-only real-mint evidence gate.
 * READ-ONLY blockchain verification across 2 independently hosted Testnet RPCs
 * and official Blockscout, then INSERT proven receipt into PostgreSQL.
 * No signing keys, deployments, mint transactions or synthetic substitutions.
 */
import {
  createPublicClient,http,isAddress,parseEventLogs,type Address,type Hex
} from "viem";
import { ACTIVE_NETWORK } from "../lib/network";
import { factoryAbi } from "../lib/m4/factory";
import { mintAbi } from "../lib/m5/mint";
import { getDb } from "../lib/server/db";

async function main(){
  if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")throw Error("Testnet-only mint verifier");
  const factory=process.env.M5_FACTORY_ADDRESS||"";
  const collection=process.env.M5_COLLECTION_ADDRESS||"";
  const hash=process.env.M5_CREATION_MINT_TX_HASH||"";
  const secondaryUrl=process.env.M5_INDEPENDENT_RPC_URL||"";
  if(!isAddress(factory,{strict:false})||!isAddress(collection,{strict:false})||
     !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw Error("Real M5 factory, collection and mint transaction hash required");
  const independentlyHosted=new URL(secondaryUrl);
  if(independentlyHosted.protocol!=="https:"||independentlyHosted.username||independentlyHosted.password||
     independentlyHosted.hostname===new URL(ACTIVE_NETWORK.rpcUrl).hostname)
    throw Error("Independent HTTPS RPC must use a different provider");
  const a=createPublicClient({transport:http(ACTIVE_NETWORK.rpcUrl,{timeout:12000,retryCount:1})});
  const b=createPublicClient({transport:http(secondaryUrl,{timeout:12000,retryCount:1})});
  if(await a.getChainId()!==18881||await b.getChainId()!==18881)
    throw Error("Testnet RPC chain ID mismatch");
  const txHash=hash as Hex,coll=collection as Address,factoryAddr=factory as Address;
  const [tx,receipt,otherReceipt,headA,headB,registered,versionA,versionB,codeA,codeB]=await Promise.all([
    a.getTransaction({hash:txHash}),
    a.getTransactionReceipt({hash:txHash}),
    b.getTransactionReceipt({hash:txHash}),
    a.getBlockNumber(),b.getBlockNumber(),
    a.readContract({address:factoryAddr,abi:factoryAbi,functionName:"isCollection",args:[coll]}),
    a.readContract({address:factoryAddr,abi:factoryAbi,functionName:"VERSION"}),
    b.readContract({address:factoryAddr,abi:factoryAbi,functionName:"VERSION"}),
    a.getCode({address:coll}),b.getCode({address:coll})
  ]);
  if(tx.chainId!==18881||tx.to?.toLowerCase()!==coll.toLowerCase()||
     receipt.status!=="success"||otherReceipt.status!=="success"||!registered||
     versionA!==2n||versionB!==2n||!codeA||codeA==="0x"||codeA!==codeB)
    throw Error("Factory/collection/transaction identity or independent code mismatch");
  if(receipt.blockNumber+12n>headA||receipt.blockNumber+12n>headB)
    throw Error("Transaction not yet twelve blocks deep on both providers");
  if(receipt.blockNumber!==otherReceipt.blockNumber||
     receipt.blockHash.toLowerCase()!==otherReceipt.blockHash.toLowerCase())
    throw Error("Independent receipts disagree");
  const [blockA,blockB]=await Promise.all([
    a.getBlock({blockNumber:receipt.blockNumber}),b.getBlock({blockNumber:receipt.blockNumber})
  ]);
  if(blockA.hash?.toLowerCase()!==receipt.blockHash.toLowerCase()||
     blockB.hash?.toLowerCase()!==receipt.blockHash.toLowerCase())
    throw Error("Independent finalized block hashes disagree");

  // External explorer evidence must be an actual successful response, NOT a 404.
  const explorerTx=ACTIVE_NETWORK.explorerUrl+"/tx/"+hash;
  const response=await fetch(ACTIVE_NETWORK.explorerUrl+"/api/v2/transactions/"+hash,{
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error("Independent Blockscout transaction lookup failed: HTTP "+response.status);
  const fetched:unknown=await response.json();
  if(!fetched||typeof fetched!=="object")throw Error("Explorer transaction response malformed");
  const explorer=fetched as {hash?:string;block_hash?:string;block?:number;status?:string};
  if(explorer.hash?.toLowerCase()!==hash.toLowerCase()||
     explorer.block_hash?.toLowerCase()!==receipt.blockHash.toLowerCase()||
     explorer.block!==Number(receipt.blockNumber)||
     explorer.status!=="ok")
    throw Error("Explorer identity/status/block evidence does not agree with primary/secondary RPC");

  const events=parseEventLogs({abi:mintAbi,logs:receipt.logs,eventName:"PhaseMint"});
  const otherEvents=parseEventLogs({abi:mintAbi,logs:otherReceipt.logs,eventName:"PhaseMint"});
  const found=events.filter(e=>e.address.toLowerCase()===coll.toLowerCase()&&
     e.args.minter.toLowerCase()===tx.from.toLowerCase());
  const second=otherEvents.filter(e=>e.address.toLowerCase()===coll.toLowerCase()&&
     e.args.minter.toLowerCase()===tx.from.toLowerCase());
  if(found.length!==1||second.length!==1)throw Error("Single creator-bound mint event not independently confirmed");
  const ev=found[0],other=second[0];
  if(ev.args.phaseId!==other.args.phaseId||ev.args.nonce!==other.args.nonce||
     ev.args.quantity!==other.args.quantity||ev.args.payment!==other.args.payment||
     ev.args.refund!==other.args.refund||ev.args.quantity===0n)
    throw Error("Independent mint events differ or are malformed");
  if(ev.args.payment>tx.value||tx.value-ev.args.payment!==ev.args.refund)
    throw Error("Native UOS payment and refund do not match transaction value");
  const [is721,is1155]=await Promise.all([
    a.readContract({address:coll,abi:mintAbi,functionName:"supportsInterface",args:["0x80ac58cd"]}).catch(()=>false),
    a.readContract({address:coll,abi:mintAbi,functionName:"supportsInterface",args:["0xd9b67a26"]}).catch(()=>false)
  ]);
  if(!is721&&!is1155)throw Error("NFT ERC165 standard unavailable");
  let firstId=ev.args.tokenId;
  if(is721){
    const minted=parseEventLogs({abi:mintAbi,logs:receipt.logs,eventName:"Transfer"})
      .filter(e=>e.address.toLowerCase()===coll.toLowerCase()&&
       e.args.from.toLowerCase()==="0x"+"0".repeat(40)&&
       e.args.to.toLowerCase()===tx.from.toLowerCase());
    if(minted.length!==Number(ev.args.quantity))throw Error("ERC721 minted transfer count differs");
    firstId=minted[0].args.tokenId;
    for(const e of minted){
      const owner=await a.readContract({
        address:coll,abi:mintAbi,functionName:"ownerOf",
        args:[e.args.tokenId],blockNumber:receipt.blockNumber
      });
      if(owner.toLowerCase()!==tx.from.toLowerCase())
        throw Error("ERC721 ownership differs at receipt block");
    }
  }else{
    const minted=parseEventLogs({abi:mintAbi,logs:receipt.logs,eventName:"TransferSingle"})
      .filter(e=>e.address.toLowerCase()===coll.toLowerCase()&&
       e.args.from.toLowerCase()==="0x"+"0".repeat(40)&&
       e.args.to.toLowerCase()===tx.from.toLowerCase()&&
       e.args.id===ev.args.tokenId&&e.args.value===ev.args.quantity);
    if(minted.length!==1)throw Error("ERC1155 minted TransferSingle amount differs");
  }
  const db=getDb();
  const allowed=await db.query(
    "SELECT 1 FROM nft_collections WHERE chain_id=18881 AND contract_address=$1 AND token_standard=$2",
    [coll.toLowerCase(),is721?"erc721":"erc1155"]
  );
  if(allowed.rowCount!==1)throw Error("Collection is not in operator-approved M3 indexer registry");
  const params=[
    18881,hash.toLowerCase(),ev.logIndex,receipt.blockNumber.toString(),receipt.blockHash.toLowerCase(),
    factory.toLowerCase(),coll.toLowerCase(),tx.from.toLowerCase(),is721?"erc721":"erc1155",
    ev.args.phaseId.toString(),ev.args.nonce.toString(),firstId.toString(),
    ev.args.quantity.toString(),ev.args.payment.toString(),ev.args.refund.toString(),
    ACTIVE_NETWORK.rpcUrl,secondaryUrl,explorerTx
  ];
  const insert=await db.query<{tx_hash:string}>(
    `INSERT INTO nft_mint_verified_receipts(
      chain_id,tx_hash,log_index,block_number,block_hash,factory_address,
      collection_address,minter_address,token_standard,phase_id,mint_nonce,token_id,
      quantity,payment_wei,refund_wei,primary_rpc,independent_rpc,explorer_tx_url
    ) VALUES(${params.map((_,i)=>"$"+(i+1)).join(",")})
    ON CONFLICT DO NOTHING RETURNING tx_hash`,params
  );
  if(insert.rowCount!==1)throw Error("Mint receipt already recorded or nonce replay; do not overwrite evidence");
  console.log(JSON.stringify({
    status:"independently-verified-and-inserted",
    chainId:18881,transaction:hash,collection:coll,
    blockHash:receipt.blockHash,blockNumber:receipt.blockNumber.toString(),
    quantity:ev.args.quantity.toString(),paymentWei:ev.args.payment.toString(),
    refundWei:ev.args.refund.toString(),explorerTx,
    sourceCodeIndependentlyAudited:false
  }));
}
main().catch(e=>{
  console.error(JSON.stringify({
    status:"BLOCKED_NOT_VERIFIED",reason:e instanceof Error?e.message:String(e),
    noTransactionBroadcast:true,noSyntheticEvidence:true
  }));
  process.exitCode=1;
}).finally(async()=>{
  // Do not instantiate a DB connection just to close it when verification failed early.
});
