import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getDb, inTransaction } from "@/lib/server/db";
import { requireOperator } from "@/lib/server/curation";
import { ApiError, apiFailure, noStore } from "@/lib/server/http";
import {
  mediaOperationEnabled, cloudinaryReady, scanServiceReady,
  guardMultipart, readMultipart, validateMedia,
} from "@/lib/m6/security";
import { scanWithClamAV, uploadAuthenticatedMedia } from "@/lib/m6/providers";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  try {
    const session={ wallet: await requireOperator(request) };
    const db=getDb();
    const r=await db.query(
      `SELECT id::text,media_kind,mime_type,byte_length,sha256,state,
          scan_result,media_ipfs_cid,ipfs_verified_at,created_at,reviewed_at
        FROM nft_media_assets WHERE chain_id=18881 AND owner_wallet=$1
        ORDER BY created_at DESC LIMIT 50`,[session.wallet]
    );
    return noStore({status:"read-only",assets:r.rows,
      uploadsEnabled:mediaOperationEnabled()&&cloudinaryReady()&&scanServiceReady(),
      pinningEnabled:process.env.M6_IPFS_PINNING_ENABLED==="true"});
  } catch(e){return apiFailure(e);}
}

export async function POST(request:NextRequest){
  let id:string|null=null;
  try {
    const session={ wallet: await requireOperator(request) };
    if(!mediaOperationEnabled()||!cloudinaryReady()||!scanServiceReady())
      throw new ApiError(503,"M6 upload disabled until operator-backed Cloudinary and malware scanner are configured");
    guardMultipart(request);
    const form=await readMultipart(request);
    if(Array.from(form.keys()).length!==1||!form.has("file"))throw new ApiError(400,"Only one file field is allowed");
    const file=form.get("file");
    if(!(file instanceof File))throw new ApiError(400,"Missing binary file");
    const bytes=Buffer.from(await file.arrayBuffer());
    const media=validateMedia(bytes,file.type,file.name);
    id=randomUUID();
    await inTransaction(async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[session.wallet+":m6-upload"]);
      const r=await db.query<{n:string;total:string}>(
        `SELECT count(*)::text n,coalesce(sum(byte_length),0)::text total
          FROM nft_media_assets WHERE owner_wallet=$1 AND created_at>now()-interval '1 hour'`,
        [session.wallet]
      );
      if(BigInt(r.rows[0].n)>=10n||BigInt(r.rows[0].total)+BigInt(media.bytes.length)>50n*1024n*1024n)
        throw new ApiError(429,"Upload limit reached (10 files / 50MiB per wallet/hour)");
      await db.query(
        `INSERT INTO nft_media_assets(id,owner_wallet,media_kind,mime_type,byte_length,sha256)
          VALUES($1,$2,$3,$4,$5,$6)`,
        [id,session.wallet,media.kind,media.mime,media.bytes.length,media.sha256]
      );
    });
    let evidence;
    try { evidence=await scanWithClamAV(media.bytes); }
    catch(e){
      await getDb().query("UPDATE nft_media_assets SET state='scan_failed',scan_result='error',updated_at=now() WHERE id=$1 AND owner_wallet=$2",[id,session.wallet]);
      throw e;
    }
    if(evidence.result!=="clean"){
      await getDb().query(
        `UPDATE nft_media_assets SET state='scan_failed',scan_engine=$3,
          scan_result='infected',scan_evidence_sha256=$4,scan_checked_at=now(),updated_at=now()
          WHERE id=$1 AND owner_wallet=$2`,
        [id,session.wallet,evidence.engine,evidence.evidenceHash]
      );
      throw new ApiError(422,"The malware scanner rejected the uploaded file");
    }
    // No media becomes publicly deliverable merely because it passed AV.
    let stored;
    try {stored=await uploadAuthenticatedMedia(media,id);}
    catch(e){
      await getDb().query(
        `UPDATE nft_media_assets SET state='upload_failed',scan_engine=$3,
         scan_result='clean',scan_evidence_sha256=$4,scan_checked_at=now(),updated_at=now()
         WHERE id=$1 AND owner_wallet=$2`,
        [id,session.wallet,evidence.engine,evidence.evidenceHash]
      );
      throw e;
    }
    const r=await getDb().query(
      `UPDATE nft_media_assets SET state='needs_moderation',scan_engine=$3,scan_result='clean',
       scan_checked_at=now(),scan_evidence_sha256=$4,provider_asset_id=$5,
       provider_public_id=$6,provider_version=$7,updated_at=now()
       WHERE id=$1 AND owner_wallet=$2 AND state='reserved'
       RETURNING id::text,state,media_kind,mime_type,byte_length,sha256`,
      [id,session.wallet,evidence.engine,evidence.evidenceHash,stored.assetId,stored.publicId,stored.version]
    );
    if(r.rowCount!==1)throw Error("Media reservation changed before upload commit; operator cleanup required");
    return noStore({asset:r.rows[0],note:"Stored as Cloudinary authenticated media; awaiting independent human moderation. No public media URL exists."},201);
  } catch(e){return apiFailure(e);}
}
