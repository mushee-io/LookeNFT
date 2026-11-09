import {NextRequest} from "next/server";
import {requireSession} from "@/lib/server/auth";
import {apiFailure,noStore,ApiError} from "@/lib/server/http";
import {collectionParam,limitMarketWallet,marketOverview,marketOrderbook,privateNotifications} from "@/lib/m9/readmodel";
export const runtime="nodejs";
export const dynamic="force-dynamic";

/**
 * Wallet-scoped read-only snapshots. Authentication and PostgreSQL per-wallet
 * token buckets prevent unbounded anonymous scraping/spam. No transaction routes.
 */
export async function GET(request:NextRequest){
 try{
  if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
   throw new ApiError(503,"M9 read-only market is Ultra EVM Testnet only");
  const session=await requireSession(request);
  const view=request.nextUrl.searchParams.get("view")||"overview";
  if(!["overview","orderbook","notifications"].includes(view))
   throw new ApiError(400,"Unknown read-only M9 view");
  const route=view as "overview"|"orderbook"|"notifications";
  await limitMarketWallet(session.wallet,route,40);
  if(route==="notifications")
   return noStore(await privateNotifications(session.wallet));
  const collection=collectionParam(request.nextUrl.searchParams.get("collection"));
  return noStore(route==="overview"?
   await marketOverview(collection):await marketOrderbook(collection));
 }catch(err){return apiFailure(err);}
}
