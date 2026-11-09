/**
 * M9 operator-invoked READ-ONLY marketplace indexer.
 * No cron, no keys, no signing/broadcast and OFF by default.
 * Requires two distinct actual Ultra Testnet RPCs, independently recorded
 * expected contract code hashes, and functioning official Blockscout API.
 */
import {createPublicClient,http,isAddress,keccak256,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "../lib/network";
import {getDb} from "../lib/server/db";
import {marketAbi} from "../lib/m7/market";
import {offerAbi} from "../lib/m8/offers";
import {
 validateMarketAddresses,M9_SCAN_ENABLED,type RawMarketLog,type MarketHeader
} from "../lib/m9/market";
import {reconcileOnce,type MarketReader} from "../lib/m9/reconcile";

function parseNatural(name:string,fallback:string,min:number,max:number){
 const raw=process.env[name]||fallback;
 if(!/^[0-9]{1,10}$/.test(raw)||Number(raw)<min||Number(raw)>max)
  throw Error(name+" must be within "+min+"–"+max);
 return Number(raw);
}
async function main(){
 if(!M9_SCAN_ENABLED||process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw Error("M9 source-backed scanner is operator-disabled or not Testnet");
 const listing=process.env.M9_LISTING_MARKET_ADDRESS||"";
 const vault=process.env.M9_OFFER_VAULT_ADDRESS||"";
 const pair=validateMarketAddresses(listing,vault);
 const sourceUrl=process.env.M9_INDEPENDENT_RPC_URL||"";
 const parsed=new URL(sourceUrl),primary=new URL(ULTRA_TESTNET.rpcUrl);
 if(parsed.protocol!=="https:"||parsed.username||parsed.password||
  parsed.hostname===primary.hostname||!parsed.hostname)
  throw Error("Independent read-only RPC must be a separate HTTPS hostname");
 const expectedMarket=process.env.M9_EXPECTED_MARKET_CODE_HASH||"";
 const expectedVault=process.env.M9_EXPECTED_VAULT_CODE_HASH||"";
 if(!/^0x[0-9a-fA-F]{64}$/.test(expectedMarket)||
  !/^0x[0-9a-fA-F]{64}$/.test(expectedVault))
  throw Error("Independently approved deployed runtime code hashes required for M7/M8");
 const startText=process.env.M9_MARKET_START_BLOCK||"";
 if(!/^[1-9][0-9]{0,12}$/.test(startText))throw Error("M9_MARKET_START_BLOCK must come from approved Testnet deployments");
 const start=BigInt(startText);
 const confirmations=parseNatural("M9_CONFIRMATIONS","12",12,200);
 const maxBlocks=parseNatural("M9_MAX_BLOCKS","10",1,25);
 const maxDepth=parseNatural("M9_MAX_REORG_DEPTH","50",1,100);
 const p=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
 const s=createPublicClient({transport:http(sourceUrl,{timeout:12000,retryCount:1})});
 const source=(which:"primary"|"independent")=>which==="primary"?p:s;
 const reader:MarketReader={
  chainIds:()=>Promise.all([p.getChainId(),s.getChainId()]),
  heads:()=>Promise.all([p.getBlockNumber(),s.getBlockNumber()]),
  header:async(height,which)=>{
   const block=await source(which).getBlock({blockNumber:height});
   if(!block.hash||!block.parentHash)throw Error("Independent canonical block has no block/parent hash");
   return {number:block.number,hash:block.hash,parentHash:block.parentHash} as MarketHeader;
  },
  logs:async(from,to,which)=>{
   const logs=await source(which).getLogs({address:[pair.listing,pair.vault],
    fromBlock:from,toBlock:to});
   return logs.map(l=>{
    if(l.blockNumber===null||l.blockHash===null||
       l.transactionHash===null||l.logIndex===null)
     throw Error("RPC returned pending or unconfirmed market log");
    return {address:l.address,blockNumber:l.blockNumber,blockHash:l.blockHash,
      transactionHash:l.transactionHash,logIndex:l.logIndex,
      data:l.data,topics:[...l.topics]} as RawMarketLog;
   });
  },
  explorerAgrees:async(header)=>{
   const url=ULTRA_TESTNET.explorerUrl+"/api/v2/blocks/"+header.number.toString();
   const response=await fetch(url,{redirect:"error",cache:"no-store",
     signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error("Blockscout HTTP "+response.status+" at confirmed block "+header.number);
   const json=await response.json() as {hash?:string;height?:number};
   return json.hash?.toLowerCase()===header.hash.toLowerCase() &&
     (json.height===undefined||json.height===Number(header.number));
  },
  contractChecks:async()=>{
   const ids=await Promise.all([p.getChainId(),s.getChainId()]);
   if(ids.some(id=>id!==18881))return false;
   const [m1,m2,v1,v2,mv1,mv2,vv1,vv2]=await Promise.all([
    p.getCode({address:pair.listing}),s.getCode({address:pair.listing}),
    p.getCode({address:pair.vault}),s.getCode({address:pair.vault}),
    p.readContract({address:pair.listing,abi:marketAbi,functionName:"VERSION"}),
    s.readContract({address:pair.listing,abi:marketAbi,functionName:"VERSION"}),
    p.readContract({address:pair.vault,abi:offerAbi,functionName:"VERSION"}),
    s.readContract({address:pair.vault,abi:offerAbi,functionName:"VERSION"})
   ]);
   return Boolean(m1&&m2&&v1&&v2&&m1!=="0x"&&v1!=="0x"&&
    m1===m2&&v1===v2&&
    keccak256(m1 as Hex).toLowerCase()===expectedMarket.toLowerCase()&&
    keccak256(v1 as Hex).toLowerCase()===expectedVault.toLowerCase()&&
    mv1===1n&&mv2===1n&&vv1===1n&&vv2===1n);
  }
 };
 const pool=getDb();
 try{
  const result=await reconcileOnce(reader,pool,{
   startBlock:start,confirmations,maxBlocks,maxReorgDepth:maxDepth,
   listing:pair.listing,vault:pair.vault
  });
  console.log(JSON.stringify({...result,mainnet:false,signatures:false,
   verifiedTrades:undefined,independentBlockscout:true}));
 }finally{await pool.end();}
}
main().catch(err=>{
 console.error(JSON.stringify({status:"NO_GO_UNVERIFIED",
  reason:err instanceof Error?err.message:"Unknown source failure",
  noSyntheticEvents:true,noTransactions:true}));
 process.exitCode=1;
});
