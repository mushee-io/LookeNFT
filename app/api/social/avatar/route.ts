import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {guardMutation,parseBody,noStore,apiFailure,ApiError} from "@/lib/server/http";
import {m10Gate,limitSocialWallet,profileForWallet} from "@/lib/m10/bridge";
import {verifyAndSaveAvatar,unsetAvatar,type AvatarRequest} from "@/lib/m10/ownership";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 try{
  const session=await requireSession(req);
  m10Gate("social");
  await limitSocialWallet(session.wallet,"avatar",30);
  const profile=await profileForWallet(session.wallet);
  return noStore({chainId:18881,avatar:profile?.avatar||null,
   approvedImageUrl:profile?.approvedImageUrl||null,
   source:"two-independent-RPCs-plus-Blockscout-plus-M3-indexer",
   warning:"Ownership is verified at one independently corroborated historical block, not guaranteed at the present instant."});
 }catch(err){return apiFailure(err);}
}
export async function POST(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  m10Gate("social");m10Gate("avatar");
  await limitSocialWallet(session.wallet,"avatar",6);
  const body=await parseBody(req,1500);
  const keys=["collection","tokenId","standard"];
  if(Object.keys(body).some(x=>!keys.includes(x))||keys.some(x=>typeof body[x]!=="string"))
   throw new ApiError(400,"Only collection, token ID and ERC721/ERC1155 standard allowed");
  const proof=await verifyAndSaveAvatar(session.wallet,{
   wallet:session.wallet,collection:body.collection as string,
   tokenId:body.tokenId as string,standard:body.standard as AvatarRequest["standard"]
  });
  return noStore({verified:true,chainId:18881,evidence:proof,
   warning:"Read-only independently checked NFT profile reference; no token transfer, sale or onchain avatar change."},201);
 }catch(err){return apiFailure(err);}
}
export async function DELETE(req:NextRequest){
 try{
  guardMutation(req);
  const session=await requireSession(req);
  await limitSocialWallet(session.wallet,"avatar",6);
  await unsetAvatar(session.wallet);
  return noStore({selected:false,warning:"Local NFT avatar reference cleared; no blockchain transaction."});
 }catch(err){return apiFailure(err);}
}
