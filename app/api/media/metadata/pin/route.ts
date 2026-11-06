import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ApiError,apiFailure,guardMutation,noStore,parseBody } from "@/lib/server/http";
import { canonicalJSON } from "@/lib/m6/metadata";
import { pinMetadataJSON,pinningReady } from "@/lib/m6/providers";
import { createHash } from "node:crypto";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest){
  let id:string|null=null,owner:string|null=null;
  try{
    guardMutation(request);
    const session=await requireSession(request);owner=session.wallet;
    if(!pinningReady())throw new ApiError(503,"Operator-approved IPFS metadata pinning is not enabled");
    const body=await parseBody(request,500);
    if(typeof body.id!=="string"||!/^[a-f0-9-]{36}$/i.test(body.id))
      throw new ApiError(400,"Valid metadata version UUID required");
    id=body.id;
    const db=getDb();
    const result=await db.query<{metadata:unknown;metadata_sha256:string}>(
      `UPDATE nft_media_metadata_versions SET state='pinning'
       WHERE id=$1 AND owner_wallet=$2 AND chain_id=18881 AND state='draft'
       RETURNING metadata,metadata_sha256`,[id,owner]
    );
    if(result.rowCount!==1)throw new ApiError(409,"Metadata version unavailable or already pinned");
    const item=result.rows[0];
    const canonical=canonicalJSON(item.metadata);
    const digest=createHash("sha256").update(canonical).digest("hex");
    if(digest!==item.metadata_sha256)throw new Error("Stored JSON does not match canonical metadata digest");
    const pinned=await pinMetadataJSON(item.metadata,item.metadata_sha256);
    if(!pinned.gatewayVerified)
      throw new ApiError(424,"IPFS metadata gateway bytes differ from pinned canonical JSON; no verified pin");
    const updated=await db.query(
      `UPDATE nft_media_metadata_versions SET state='pinned',ipfs_cid=$3,
         pinned_at=now() WHERE id=$1 AND owner_wallet=$2 AND state='pinning'
       RETURNING id::text,version,state,ipfs_cid`,[id,owner,pinned.cid]
    );
    if(updated.rowCount!==1)throw new Error("Metadata pin reservation no longer active");
    return noStore({record:updated.rows[0],ipfsUri:"ipfs://"+pinned.cid,
      note:"Pin and gateway bytes matched; still not confirmed as an on-chain tokenURI."});
  }catch(e){
    if(id&&owner)await getDb().query(
      `UPDATE nft_media_metadata_versions SET state='draft'
       WHERE id=$1 AND owner_wallet=$2 AND state='pinning'`,[id,owner]
    ).catch(()=>{});
    return apiFailure(e);
  }
}
