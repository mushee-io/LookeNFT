import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {guardMutation,parseBody,noStore,apiFailure,ApiError} from "@/lib/server/http";
import {requireAcceptanceOperator} from "@/lib/m11/acceptance";
import {assertIndependentReviewers,reviewerTrustFromEnvironment,
 verifyHumanReviewAssertion,recordSignedHumanCandidate} from "@/lib/m12/human";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  requireAcceptanceOperator(session.wallet,true);
  const body=await parseBody(req,12500);
  if(Object.keys(body).length!==2||
    !["security_reviewer","release_operator"].includes(String(body.role))||
    typeof body.assertion!=="string")
   throw new ApiError(400,"Separate signed human reviewer role and JWT required");
  const security=reviewerTrustFromEnvironment("security_reviewer");
  const release=reviewerTrustFromEnvironment("release_operator");
  assertIndependentReviewers(security,release);
  const trust=body.role==="security_reviewer"?security:release;
  const claim=await verifyHumanReviewAssertion(body.assertion,trust);
  const record=await recordSignedHumanCandidate(claim,{security,release});
  return noStore({...record,releaseDecision:"NO_GO",
   warning:"Genuine signer provenance candidate only. Does NOT certify audit findings, independent sources, operator rollout or grant trading permission."},201);
 }catch(e){return apiFailure(e);}
}
