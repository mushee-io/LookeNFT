import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {guardMutation,parseBody,noStore,apiFailure,ApiError} from "@/lib/server/http";
import {acceptanceReport,requireAcceptanceOperator,storeEvidenceCandidate,verifyEvidenceSubmission} from "@/lib/m11/acceptance";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 try{
  const session=await requireSession(req);
  requireAcceptanceOperator(session.wallet);
  return noStore(await acceptanceReport());
 }catch(e){return apiFailure(e);}
}
export async function POST(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  requireAcceptanceOperator(session.wallet,true);
  const body=await parseBody(req,12_500);
  if(Object.keys(body).length!==1||typeof body.assertion!=="string")
   throw new ApiError(400,"Only one independently reviewed EdDSA candidate evidence JWT accepted");
  const issuer=process.env.M11_EVIDENCE_ISSUER||"";
  const pem=process.env.M11_EVIDENCE_PUBLIC_KEY_PEM?.replace(/\\n/g,"\n")||"";
  if(!issuer.startsWith("https://")||!pem.includes("BEGIN PUBLIC KEY"))
   throw new ApiError(503,"External reviewer signature verification is not configured");
  const proof=await verifyEvidenceSubmission(body.assertion,{
   issuer,publicKeyPem:pem,operatorWallet:session.wallet
  });
  const candidate=await storeEvidenceCandidate(proof);
  return noStore({...candidate,
   warning:"Evidence submitted as UNVERIFIED candidate only. This does not enable financial execution, audit approvals or mainnet."},201);
 }catch(e){return apiFailure(e);}
}
