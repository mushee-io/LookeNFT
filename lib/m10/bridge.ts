import {getDb,inTransaction} from "../server/db";
import {ApiError} from "../server/http";
import {verifySocialAssertion,socialTrustFromEnvironment,type SocialSnapshot} from "./claims";

export function m10Gate(kind:"social"|"avatar"|"directory"):void{
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")
  throw new ApiError(503,"LookeNFT M10 is Ultra EVM Testnet only");
 const flags={
  social:"M10_SOCIAL_SYNC_ENABLED",
  avatar:"M10_OWNERSHIP_VERIFY_ENABLED",
  directory:"M10_PUBLIC_DISCOVERY_ENABLED"
 } as const;
 if(process.env[flags[kind]]!=="true")
  throw new ApiError(503,"M10 "+kind+" is disabled without operator/source approval");
 if(kind==="social"||kind==="directory")socialTrustFromEnvironment();
 if(kind==="directory"&&process.env.M10_SOCIAL_BLOCK_POLICY_ATTESTED!=="true")
  throw new ApiError(503,"Creator directory disabled until real Looke Social viewer-specific block and mute policy is attested");
}
export async function saveSocialSnapshot(
 authenticatedWallet:string,raw:unknown,
 config?:Parameters<typeof verifySocialAssertion>[1]
):Promise<SocialSnapshot>{
 if(!config)m10Gate("social");
 const trust=config||socialTrustFromEnvironment();
 const proof=await verifySocialAssertion(raw,trust);
 if(proof.wallet!==authenticatedWallet.toLowerCase())
  throw new ApiError(403,"Looke identity assertion belongs to a different authenticated wallet");
 await inTransaction(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[proof.wallet]);
  const active=await db.query<{profile_id:string}>(
   "SELECT profile_id FROM nft_profile_links WHERE wallet_address=$1 FOR UPDATE",[proof.wallet]);
  if(active.rowCount!==1||active.rows[0].profile_id!==proof.profileId)
   throw new ApiError(403,"Signed Looke profile must be linked with the existing M2 wallet-identity flow");
  const revoked=await db.query(
   "SELECT 1 FROM nft_m11_social_revocations WHERE wallet_address=$1",
   [proof.wallet]);
  if(revoked.rowCount)throw new ApiError(403,"Looke Social account revoked by signed source; manual recovery required");
  const previous=await db.query<{issued_at:Date}>(
   "SELECT issued_at FROM nft_m10_social_profiles WHERE wallet_address=$1 FOR UPDATE",
   [proof.wallet]
  );
  if(previous.rowCount&&previous.rows[0].issued_at.getTime()>=proof.issuedAt.getTime())
   throw new ApiError(409,"Stale or replayed Looke Social source snapshot");
  // Unique jti serialises cross-wallet/independent issuer replay; raw JWT is never stored.
  const claimed=await db.query(
   `INSERT INTO nft_m10_assertion_jtis(source_issuer,jti,wallet_address)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING jti`,
   [proof.issuer,proof.jti,proof.wallet]
  );
  if(claimed.rowCount!==1)throw new ApiError(409,"Looke Social assertion was already consumed");
  await db.query(`INSERT INTO nft_m10_social_profiles(
   chain_id,wallet_address,profile_id,handle,display_name,bio,source_commit_sha,
   source_issuer,assertion_sha256,source_jti,issued_at,expires_at,public_approved,suspended)
   VALUES(18881,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)
   ON CONFLICT(wallet_address) DO UPDATE SET
    profile_id=excluded.profile_id,handle=excluded.handle,
    display_name=excluded.display_name,bio=excluded.bio,
    source_commit_sha=excluded.source_commit_sha,source_issuer=excluded.source_issuer,
    assertion_sha256=excluded.assertion_sha256,source_jti=excluded.source_jti,
    issued_at=excluded.issued_at,expires_at=excluded.expires_at,
    public_approved=excluded.public_approved,suspended=false,source_checked_at=now()`,
   [proof.wallet,proof.profileId,proof.handle,proof.displayName,proof.bio,
    proof.sourceCommit,proof.issuer,proof.assertionSha256,proof.jti,
    proof.issuedAt,proof.expiresAt,proof.publicApproved]
  );
  await db.query("DELETE FROM nft_m10_visible_posts WHERE wallet_address=$1",[proof.wallet]);
  for(const post of proof.posts){
   await db.query(`INSERT INTO nft_m10_visible_posts(
    post_id,wallet_address,body,created_at,source_jti,media_kind,approved_media_url)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [post.id,proof.wallet,post.body,post.createdAt,proof.jti,post.mediaKind,post.mediaUrl]);
  }
 });
 return proof;
}
export async function profileForWallet(wallet:string){
 m10Gate("social");
 const result=await getDb().query<{
  wallet_address:string;profile_id:string;handle:string;display_name:string;bio:string;
  source_commit_sha:string;source_checked_at:Date;expires_at:Date
 }>(`SELECT s.wallet_address,s.profile_id,s.handle,s.display_name,s.bio,
    s.source_commit_sha,s.source_checked_at,s.expires_at
   FROM nft_m10_social_profiles s
   JOIN nft_profile_links p ON p.wallet_address=s.wallet_address AND p.profile_id=s.profile_id
   WHERE s.wallet_address=$1 AND s.chain_id=18881 AND s.suspended=false
     AND s.public_approved=true AND s.expires_at>now()
     AND NOT EXISTS(SELECT 1 FROM nft_m11_social_revocations r WHERE r.wallet_address=s.wallet_address)`,[wallet.toLowerCase()]);
 const row=result.rows[0];
 if(!row)return null;
 const posts=await getDb().query<{post_id:string;body:string;created_at:Date;media_kind:string|null;approved_media_url:string|null}>(
  `SELECT post_id,body,created_at,media_kind,approved_media_url FROM nft_m10_visible_posts
    WHERE wallet_address=$1 ORDER BY created_at DESC,post_id DESC LIMIT 12`,[wallet.toLowerCase()]);
 const avatar=await getDb().query<{collection_address:string;token_standard:string;token_id:string;verified_balance:string;block_number:string;block_hash:string;expires_at:Date}>(
  `SELECT a.collection_address,a.token_standard,a.token_id::text,
    a.verified_balance::text,a.block_number::text,a.block_hash,a.expires_at
    FROM nft_m10_verified_nft_avatars a
    JOIN nft_collections k ON k.chain_id=a.chain_id AND k.contract_address=a.collection_address
      AND k.source_verified=true
    JOIN nft_indexer_blocks b ON b.chain_id=a.chain_id AND b.block_number=a.block_number
      AND b.block_hash=a.block_hash
    WHERE a.owner_wallet=$1 AND a.chain_id=18881 AND a.expires_at>now()`,
  [wallet.toLowerCase()]);
 const media=avatar.rowCount?await getDb().query<{media_ipfs_cid:string}>(
  `SELECT a.media_ipfs_cid
   FROM nft_media_metadata_versions m
   JOIN nft_media_assets a ON a.id=m.asset_id AND a.owner_wallet=m.owner_wallet
   WHERE m.owner_wallet=$1 AND m.collection_address=$2 AND m.token_id=$3::numeric
    AND m.chain_id=18881 AND m.state='chain_matched'
    AND a.state='approved' AND a.media_kind='image' AND a.scan_result='clean'
    AND a.pin_state='verified' AND a.ipfs_verified_at IS NOT NULL
   ORDER BY m.version DESC LIMIT 1`,
  [wallet.toLowerCase(),avatar.rows[0].collection_address,avatar.rows[0].token_id]
 ):null;
 const approvedCid=media?.rows[0]?.media_ipfs_cid??null;
 const gateway=process.env.M10_APPROVED_IPFS_GATEWAY||"";
 const imageUrl=approvedCid&&/^https:\/\/[a-z0-9.-]+\/$/.test(gateway)&&
  /^[a-zA-Z0-9]{40,100}$/.test(approvedCid)?gateway+"ipfs/"+approvedCid:null;
 return {
  wallet:row.wallet_address,profileId:row.profile_id,handle:row.handle,
  displayName:row.display_name,bio:row.bio,sourceCommit:row.source_commit_sha,
  lastSignedAt:row.source_checked_at,proofExpiresAt:row.expires_at,
  avatar:avatar.rows[0]??null,approvedImageUrl:imageUrl,
  posts:posts.rows,
  warning:"Real moderated, signed Looke Social snapshot. NFT ownership is proven only at the displayed historical Testnet block and can change after verification."
 };
}
/**
 * M11 security gate: a PUBLIC cursor over all creators is unsafe while the
 * Looke Social signed viewer-specific block/mute policy issuer is absent.
 * Only explicit one-subject signed visibility proofs may reveal content.
 */
export async function publicCreatorDirectory(_search:string,_limit=20):Promise<{profiles:unknown[];source:string;blockedRelationshipReviewRequired:boolean}>{
 throw new ApiError(503,"Public directory disabled: require one-use viewer-bound Looke Social block/mute proof per creator");
}
export async function limitSocialWallet(wallet:string,action:"read"|"sync"|"avatar"|"directory",limit=30){
 const window=new Date(Math.floor(Date.now()/60000)*60000);
 const row=await getDb().query(
  `INSERT INTO nft_m10_request_buckets(chain_id,wallet_address,action,bucket_start,hits)
   VALUES(18881,$1,$2,$3,1)
   ON CONFLICT(chain_id,wallet_address,action,bucket_start)
   DO UPDATE SET hits=nft_m10_request_buckets.hits+1
    WHERE nft_m10_request_buckets.hits<$4 RETURNING hits`,
  [wallet.toLowerCase(),action,window,limit]
 );
 if(row.rowCount!==1)throw new ApiError(429,"Too many Looke Social/NFT requests");
}
