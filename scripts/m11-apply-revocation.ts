/**
 * Operator-only, OFF-by-default short-lived Looke Social signed revocation.
 * Takes a JWT supplied through an operator-managed environment, NEVER a key.
 * No public endpoint, no source modification, no social user impersonation.
 */
import {socialTrustFromEnvironment} from "../lib/m10/claims";
import {m11SourceGate,verifyRevocation,persistRevocation} from "../lib/m11/source";
async function main(){
 m11SourceGate("revocation");
 const signed=process.env.M11_SIGNED_REVOCATION_JWT||"";
 if(!signed)throw Error("Actual short-lived operator-authorised Looke Social revocation JWT required");
 const proof=await verifyRevocation(signed,socialTrustFromEnvironment());
 const result=await persistRevocation(proof);
 console.log(JSON.stringify({...result,issuer:proof.issuer,jti:proof.jti,
  noSocialAPIWrites:true,noFinancialTransactions:true}));
}
main().catch(e=>{
 console.error(JSON.stringify({status:"NO_GO_UNVERIFIED",
  reason:e instanceof Error?e.message:"Unknown revocation error",
  noSyntheticSocialAccounts:true}));
 process.exitCode=1;
});
