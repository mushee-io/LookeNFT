/** Operator-only, independent-RPC read-only order-snapshot updater. */
import {ULTRA_TESTNET} from "../lib/network";
import {getDb} from "../lib/server/db";
import {refreshOrderSnapshots} from "../lib/m9/snapshots";
async function main(){
 if(process.env.M9_READONLY_SYNC_ENABLED!=="true"||
  process.env.M9_ORDER_SNAPSHOT_ENABLED!=="true"||
  process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw Error("M9 snapshots disabled until operator source and acceptance checks");
 const independent=process.env.M9_INDEPENDENT_RPC_URL||"";
 const url=new URL(independent);
 if(url.protocol!=="https:"||url.hostname===new URL(ULTRA_TESTNET.rpcUrl).hostname||
  url.username||url.password)throw Error("M9 requires independent HTTPS Testnet RPC");
 const pool=getDb();
 try{console.log(JSON.stringify(await refreshOrderSnapshots(pool,independent)));}
 finally{await pool.end();}
}
main().catch(e=>{
 console.error(JSON.stringify({status:"NO_GO_UNVERIFIED",
  reason:e instanceof Error?e.message:"Unknown source failure",noTrades:true}));
 process.exitCode=1;
});
