import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {noStore,apiFailure} from "@/lib/server/http";
import {m10Gate,limitSocialWallet,publicCreatorDirectory} from "@/lib/m10/bridge";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 try{
  const session=await requireSession(req);
  m10Gate("directory");
  await limitSocialWallet(session.wallet,"directory",25);
  const search=req.nextUrl.searchParams.get("search")||"";
  const data=await publicCreatorDirectory(search,20);
  return noStore({...data,chainId:18881,
   warning:"Creator discovery is disabled until Looke Social issues signed public/moderation/blocked-viewer policy attestations. No fake profiles, follower counts or posts are supplied."});
 }catch(err){return apiFailure(err);}
}
