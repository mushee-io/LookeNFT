import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {guardMutation,noStore,apiFailure,ApiError} from "@/lib/server/http";
import {requireAcceptanceOperator} from "@/lib/m11/acceptance";
import {currentNoGoAssessment,persistNoGoAssessment,getRecentNoGoReviews} from "@/lib/m12/final";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 try{
  const session=await requireSession(req);
  requireAcceptanceOperator(session.wallet);
  const assessment=await currentNoGoAssessment(session.wallet);
  return noStore({stage:"M12_FINAL_TESTNET_ACCEPTANCE",
   ...assessment,recentNoGoReviews:await getRecentNoGoReviews(),
   humanSignoffAvailable:false,realSourceVerified:false,releaseDecision:"NO_GO",
   warning:"Signed evidence candidates and local CI are NOT a release approval. All 18 external source and human gates remain NO-GO."});
 }catch(e){return apiFailure(e);}
}
export async function POST(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  requireAcceptanceOperator(session.wallet,true);
  if(req.headers.get("content-length")&&Number(req.headers.get("content-length"))>2048)
   throw new ApiError(413,"NO-GO review request too large");
  const body=await req.json() as unknown;
  if(!body||typeof body!=="object"||Array.isArray(body)||
   Object.keys(body).length!==1||
   (body as {decision?:unknown}).decision!=="NO_GO")
   throw new ApiError(400,"Explicit NO_GO only; M12 cannot self-authorise a GO");
  const result=await persistNoGoAssessment(session.wallet);
  return noStore({...result,releaseAuthorised:false,mainnetAuthorised:false,
   warning:"An internal NO_GO record is not a signed external audit or successful Testnet acceptance."},201);
 }catch(e){return apiFailure(e);}
}
