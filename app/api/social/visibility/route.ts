import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {guardMutation,parseBody,noStore,apiFailure,ApiError} from "@/lib/server/http";
import {getDb} from "@/lib/server/db";
import {socialTrustFromEnvironment} from "@/lib/m10/claims";
import {profileForWallet,limitSocialWallet} from "@/lib/m10/bridge";
import {m11SourceGate,verifyVisibility,consumeVisibilityDecision} from "@/lib/m11/source";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/** One-use issuer-signed viewer+subject policy, not public user enumeration. */
export async function POST(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  m11SourceGate("visibility");
  await limitSocialWallet(session.wallet,"directory",10);
  const body=await parseBody(req,12_500);
  if(Object.keys(body).length!==1||typeof body.assertion!=="string")
   throw new ApiError(400,"Only signed viewer-bound Looke Social visibility JWT accepted");
  const proof=await verifyVisibility(body.assertion,socialTrustFromEnvironment());
  const decision=await consumeVisibilityDecision(proof,session.wallet,getDb());
  if(!decision.allowed)return noStore({visible:false,profile:null,
   reason:"Issuer-signed viewer policy denies visibility. No profile data disclosed."});
  const profile=await profileForWallet(decision.subject);
  if(!profile)return noStore({visible:false,profile:null,
   reason:"No current approved unrevoked social snapshot for signed subject."});
  return noStore({visible:true,profile,
   source:"one-use EdDSA attested Looke Social viewer-specific block/mute decision",
   warning:"Profile/NFT owner evidence remains time-limited; not a platform follow or token trade."});
 }catch(e){return apiFailure(e);}
}
