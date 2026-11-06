import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getDb,inTransaction } from "@/lib/server/db";
import { ApiError,apiFailure,guardMutation,noStore,parseBody } from "@/lib/server/http";
import { buildMetadata,checkCollectionCreator,parseTokenId } from "@/lib/m6/metadata";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  try {
    const session=await requireSession(request);
    const r=await getDb().query(
      `SELECT id::text,collection_address,token_standard,token_id::text,
         version,asset_id::text,metadata,metadata_sha256,state,ipfs_cid,
         chain_uri,chain_checked_block::text,created_at,pinned_at
         FROM nft_media_metadata_versions
         WHERE chain_id=18881 AND owner_wallet=$1 ORDER BY created_at DESC LIMIT 50`,
      [session.wallet]
    );
    return noStore({records:r.rows,coverage:"owner-scoped-drafts-and-read-only-chain-evidence"});
  }catch(e){return apiFailure(e);}
}

export async function POST(request:NextRequest){
  try {
    guardMutation(request);
    const session=await requireSession(request);
    const body=await parseBody(request,8192);
    if(Object.keys(body).some(k=>!["assetId","collection","tokenId","name","description","attributes"].includes(k)))
      throw new ApiError(400,"Unrecognised metadata field");
    if(typeof body.assetId!=="string"||!/^[a-f0-9-]{36}$/i.test(body.assetId))
      throw new ApiError(400,"Valid approved media UUID required");
    const tokenId=parseTokenId(body.tokenId);
    const r=await getDb().query<{
      media_kind:"image"|"video";media_ipfs_cid:string;ipfs_verified_at:Date;
    }>(
      `SELECT media_kind,media_ipfs_cid,ipfs_verified_at FROM nft_media_assets
        WHERE id=$1 AND owner_wallet=$2 AND chain_id=18881 AND state='approved'
          AND pin_state='verified' AND media_ipfs_cid IS NOT NULL
          AND ipfs_verified_at IS NOT NULL`,[body.assetId,session.wallet]
    );
    if(r.rowCount!==1)throw new ApiError(409,"Use human-approved media with independently hash-verified IPFS bytes");
    const asset=r.rows[0];
    const {contract,standard}=await checkCollectionCreator(body.collection,session.wallet);
    const {json,sha256}=buildMetadata(body.name,body.description,body.attributes,
      asset.media_ipfs_cid,asset.media_kind);
    const record=await inTransaction(async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",
        [session.wallet+":"+contract+":"+tokenId]);
      const latest=await db.query<{v:number}>(
        `SELECT coalesce(max(version),0)::int v FROM nft_media_metadata_versions
          WHERE owner_wallet=$1 AND chain_id=18881 AND collection_address=$2
            AND token_id=$3::numeric`,
        [session.wallet,contract,tokenId]
      );
      const version=latest.rows[0].v+1;
      if(version>100)throw new ApiError(429,"Metadata version limit reached");
      const id=randomUUID();
      await db.query(
        `INSERT INTO nft_media_metadata_versions(
            id,owner_wallet,collection_address,token_standard,token_id,
            version,asset_id,metadata,metadata_sha256
          ) VALUES($1,$2,$3,$4,$5::numeric,$6,$7,$8::jsonb,$9)`,
        [id,session.wallet,contract,standard,tokenId,version,body.assetId,
          JSON.stringify(json),sha256]
      );
      return {id,collection:contract,tokenStandard:standard,tokenId,version,
        state:"draft",metadata:json,sha256};
    });
    return noStore({record,proof:"approved-media-CID-only; not pinned metadata or minted NFT"},201);
  }catch(e){return apiFailure(e);}
}
