import {acceptanceReport} from "../lib/m11/acceptance";
import {mediaAcceptanceDependencies} from "../lib/m11/media";
import {getDb} from "../lib/server/db";
async function main(){
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
    process.env.M11_OPERATOR_READONLY_CHECK_ENABLED!=="true")
  throw Error("M11 operator source inspection disabled by default; Testnet only");
 const report=await acceptanceReport();
 const dependencies=mediaAcceptanceDependencies();
 console.log(JSON.stringify({
  ...report,mediaSources:dependencies,
  trustedSocialIssuerAvailable:Boolean(process.env.M10_SOCIAL_ISSUER&&process.env.M10_SOCIAL_PUBLIC_KEY_PEM),
  walletConnectProjectConfigured:Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
  operatorDatabaseConnected:true,
  requiredHumanApprovalStillOutstanding:true,
  noOnchainBroadcast:true
 }));
 await getDb().end();
}
main().catch(e=>{
 console.error(JSON.stringify({status:"NO_GO_OPERATOR_CHECK",
  reason:e instanceof Error?e.message:"Unknown error",
  noSyntheticEvidence:true}));
 process.exitCode=1;
});
