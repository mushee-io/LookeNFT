import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {guardMutation,parseBody,noStore,apiFailure,ApiError} from "@/lib/server/http";
import {m10Gate,limitSocialWallet,profileForWallet,saveSocialSnapshot} from "@/lib/m10/bridge";
import {privateNotifications} from "@/lib/m9/readmodel";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/** Only own linked account. No Looke Social cookies or internal DB secrets shared. */
export async function GET(req:NextRequest){
 try{
  const session=await requireSession(req);
  m10Gate("social");
  await limitSocialWallet(session.wallet,"read",30);
  const profile=await profileForWallet(session.wallet);
  const notifications=profile?await privateNotifications(session.wallet):null;
  return noStore({chainId:18881,profile,verifiedMarketNotifications:notifications?.notifications||[],
   noSyntheticSocialData:true,linkedWallet:session.wallet,
   warning:"Looke Social issuer snapshots must be real, fresh and moderation-approved. No public social post or NFT transaction was created."});
 }catch(err){return apiFailure(err);}
}
export async function POST(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  m10Gate("social");
  await limitSocialWallet(session.wallet,"sync",10);
  const body=await parseBody(req,18_000);
  if(Object.keys(body).length!==1||typeof body.assertion!=="string")
   throw new ApiError(400,"Only the operator-signed Looke Social proof JWT is accepted");
  const proof=await saveSocialSnapshot(session.wallet,body.assertion);
  return noStore({accepted:true,profileId:proof.profileId,handle:proof.handle,
    postCount:proof.posts.length,issuedAt:proof.issuedAt.toISOString(),
    proofExpiresAt:proof.expiresAt.toISOString(),source:proof.sourceCommit,
    warning:"Social posts are imported read-only from a signed moderation-approved source, not created here."},201);
 }catch(err){
  if(err && typeof err==="object"&&"code" in err && err.code==="23505")
   return noStore({error:"Replay or conflicting Looke Social identity"},409);
  return apiFailure(err);
 }
}
