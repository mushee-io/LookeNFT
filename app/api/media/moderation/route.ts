import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getDb, inTransaction } from "@/lib/server/db";
import { ApiError, apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export function moderatorAuthorised(wallet:string):boolean{
  const list=(process.env.M6_MODERATOR_WALLETS||"").split(",")
    .map(s=>s.trim().toLowerCase()).filter(Boolean);
  return list.length>0&&list.includes(wallet.toLowerCase());
}
function reviewerReason(value:unknown):string{
  if(typeof value!=="string")throw new ApiError(400,"Reviewer reason and actual evidence reference required");
  const reason=value.replace(/[\u0000-\u001f\u007f]/g," ").trim();
  if(reason.length<15||reason.length>1000)throw new ApiError(400,"Reviewer evidence must be 15–1000 characters");
  return reason;
}
async function moderator(request:NextRequest){
  const session=await requireSession(request);
  if(!moderatorAuthorised(session.wallet))
    throw new ApiError(403,"Authorised moderator wallet session required");
  return session.wallet;
}

export async function GET(request:NextRequest){
  try {
    await moderator(request);
    const r=await getDb().query(
      `SELECT id::text,owner_wallet,media_kind,mime_type,byte_length,sha256,
          state,scan_engine,scan_checked_at,scan_evidence_sha256,
          provider_asset_id,provider_public_id,created_at
        FROM nft_media_assets WHERE chain_id=18881 AND state='needs_moderation'
        ORDER BY created_at ASC LIMIT 40`
    );
    // Cloudinary asset IDs are provided only to authorised reviewers, never public.
    return noStore({queue:r.rows,note:"Review authenticated asset in Cloudinary's protected admin console and document actual moderation evidence before deciding."});
  } catch(e){return apiFailure(e);}
}

export async function POST(request:NextRequest){
  try {
    guardMutation(request);
    const who=await moderator(request);
    const data=await parseBody(request,2500);
    const assetId=data.assetId;
    if(typeof assetId!=="string"||!/^[a-f0-9-]{36}$/i.test(assetId))
      throw new ApiError(400,"Valid media UUID required");
    if(data.decision!=="approved"&&data.decision!=="rejected")
      throw new ApiError(400,"Decision must be approved or rejected");
    const reason=reviewerReason(data.reason);
    const result=await inTransaction(async db=>{
      const r=await db.query<{id:string;state:string;scan_result:string|null;provider_asset_id:string|null;owner_wallet:string}>(
        `SELECT id::text,state,scan_result,provider_asset_id,owner_wallet
          FROM nft_media_assets WHERE id=$1 AND chain_id=18881 FOR UPDATE`,
        [assetId]
      );
      const item=r.rows[0];
      if(!item||item.state!=="needs_moderation"||item.scan_result!=="clean"||!item.provider_asset_id)
        throw new ApiError(409,"Asset is not eligible for a human moderation decision");
      if(item.owner_wallet===who)
        throw new ApiError(403,"Creators cannot self-approve their own media");
      await db.query(
        `UPDATE nft_media_assets SET state=$2,reviewer_wallet=$3,reviewer_reason=$4,
          reviewed_at=now(),updated_at=now() WHERE id=$1 AND state='needs_moderation'`,
        [assetId,data.decision,who,reason]
      );
      await db.query(
        `INSERT INTO nft_media_review_events(id,media_id,reviewer_wallet,decision,reason)
          VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(),assetId,who,data.decision,reason]
      );
      return {id:assetId,state:data.decision,reviewedBy:who};
    });
    return noStore({asset:result,moderation:"human-wallet-session-decision-only"});
  }catch(e){return apiFailure(e);}
}
