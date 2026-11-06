import { NextRequest } from "next/server";
import { requireOperator } from "@/lib/server/curation";
import { getDb } from "@/lib/server/db";
import { ApiError,apiFailure,noStore } from "@/lib/server/http";
import { guardMultipart,readMultipart,validateMedia } from "@/lib/m6/security";
import { pinApprovedMedia,pinningReady,scanWithClamAV } from "@/lib/m6/providers";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/**
 * After real human moderation, the CREATOR resubmits original file bytes.
 * We confirm the exact original SHA-256, scan again and only then make it
 * publicly fetchable on IPFS. An unauthorised/unclean private asset cannot
 * be pinned through this endpoint.
 */
export async function POST(request:NextRequest){
  let id:string|null=null;
  let owner:string|null=null;
  try{
    const session={ wallet: await requireOperator(request) };
    owner=session.wallet;
    if(!pinningReady()||process.env.M6_MEDIA_UPLOADS_ENABLED!=="true")
      throw new ApiError(503,"Media IPFS pinning disabled until operator credentials and security gates pass");
    guardMultipart(request);
    const form=await readMultipart(request);
    if(Array.from(form.keys()).sort().join(",")!=="assetId,file")
      throw new ApiError(400,"Original file and assetId are both required");
    const requestedId=form.get("assetId"),file=form.get("file");
    if(typeof requestedId!=="string"||!/^[a-f0-9-]{36}$/i.test(requestedId)||
       !(file instanceof File))throw new ApiError(400,"Invalid approved asset identifier or file");
    id=requestedId;
    const media=validateMedia(Buffer.from(await file.arrayBuffer()),file.type,file.name);
    const db=getDb();
    const item=await db.query<{
      id:string;mime_type:string;sha256:string;byte_length:number;state:string;pin_state:string
    }>(
      `UPDATE nft_media_assets SET pin_state='in_progress',updated_at=now()
        WHERE id=$1 AND owner_wallet=$2 AND chain_id=18881 AND state='approved'
        AND pin_state IN ('not_requested','failed')
        AND scan_result='clean'
        RETURNING id::text,mime_type,sha256,byte_length,state,pin_state`,
      [id,owner]
    );
    if(item.rowCount!==1)throw new ApiError(409,"Asset has not been approved or pin attempt already running");
    const original=item.rows[0];
    if(media.mime!==original.mime_type||media.sha256!==original.sha256||
       media.bytes.length!==original.byte_length)
      throw new ApiError(422,"Resubmitted bytes differ from the human-reviewed asset");
    const verdict=await scanWithClamAV(media.bytes);
    if(verdict.result!=="clean")throw new ApiError(422,"Malware scan rejected pinning");
    const pinned=await pinApprovedMedia(media.bytes,media,id);
    await db.query(
      `UPDATE nft_media_assets SET media_ipfs_cid=$3,ipfs_pinned_at=now(),
        ipfs_verified_at=CASE WHEN $4 THEN now() ELSE NULL END,
        pin_state=CASE WHEN $4 THEN 'verified' ELSE 'failed' END,updated_at=now()
        WHERE id=$1 AND owner_wallet=$2 AND state='approved' AND pin_state='in_progress'`,
      [id,owner,pinned.cid,pinned.gatewayVerified]
    );
    if(!pinned.gatewayVerified)
      throw new ApiError(424,"Pin provider returned a CID but independent gateway content hash did not match");
    return noStore({assetId:id,status:"gateway-content-hash-verified",ipfsUri:"ipfs://"+pinned.cid});
  }catch(e){
    if(id&&owner)await getDb().query(
      "UPDATE nft_media_assets SET pin_state='failed',updated_at=now() WHERE id=$1 AND owner_wallet=$2 AND pin_state='in_progress'",
      [id,owner]
    ).catch(()=>{});
    return apiFailure(e);
  }
}
