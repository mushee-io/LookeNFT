import {createHash} from "node:crypto";
import {createPublicClient,http,parseAbi,type Hex,type Address} from "viem";
import {ULTRA_TESTNET} from "../network";
import {getDb,inTransaction} from "../server/db";
import {ApiError} from "../server/http";
import {createProofReader,externalRPC,proveNFTAvatar,type NFTStandard} from "../m10/ownership";

/** Source-backed NFT owner and media URI witness. Never mints, approves, or
 * transfers assets; if the original Blockscout 404 persists, fails closed. */
const erc721=parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);
const erc1155=parseAbi(["function uri(uint256 tokenId) view returns (string)"]);
const sha=(x:string)=>createHash("sha256").update(x).digest("hex");
const cidPattern=/^(bafy[a-z2-7]{40,100}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;
export function normalizedMetadataURI(uri:string,standard:NFTStandard,id:bigint):string{
 if(typeof uri!=="string"||uri.length>1024||
    !/^ipfs:\/\/(bafy[a-z2-7]{40,100}|Qm[1-9A-HJ-NP-Za-km-z]{44})(\/[A-Za-z0-9._~{}-]{1,100})?$/.test(uri))
  throw new ApiError(409,"Metadata must use a pinned IPFS CID with a safe relative path");
 if(standard==="erc721"&&uri.includes("{id}"))
  throw new ApiError(409,"ERC721 metadata must not contain ERC1155 token ID placeholders");
 if(standard==="erc1155"&&uri.includes("{id}"))
  return uri.replaceAll("{id}",id.toString(16).padStart(64,"0"));
 if(uri.includes("{")||uri.includes("}"))
  throw new ApiError(409,"Unexpected metadata placeholder");
 return uri;
}
export async function verifyPinnedMetadata(
 data:{standard:NFTStandard;tokenId:bigint;primaryUri:string;
  independentUri:string;storedUri:string;storedSha256:string;ipfsJson:string}
):Promise<{matched:true;sha256:string;uri:string}>{
 if(data.primaryUri!==data.independentUri||data.primaryUri!==data.storedUri)
  throw new ApiError(409,"Independent ERC721/1155 token metadata URI mismatch");
 const normalized=normalizedMetadataURI(data.primaryUri,data.standard,data.tokenId);
 let json:unknown;
 try{json=JSON.parse(data.ipfsJson);}catch{throw new ApiError(409,"Pinned metadata is not valid JSON");}
 if(!json||typeof json!=="object"||Array.isArray(json))
  throw new ApiError(409,"Pinned metadata must be an object");
 const actual=sha(data.ipfsJson);
 if(actual!==data.storedSha256.toLowerCase())
  throw new ApiError(409,"Pinned JSON bytes differ from approved M6 metadata sha256");
 return {matched:true,sha256:actual,uri:normalized};
}
function publicIpfsGateway(raw:string):string{
 const u=new URL(raw);
 if(u.protocol!=="https:"||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(u.hostname)||
  u.username||u.password||u.port||u.pathname!=="/"||u.search||u.hash)
  throw new ApiError(503,"Pinned public HTTPS IPFS gateway not independently approved");
 return u.toString();
}
export async function operatorRecheckAvatar(wallet:string){
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
  process.env.M11_NFT_WITNESS_RECHECK_ENABLED!=="true"||
  !process.env.M10_INDEPENDENT_RPC_URL||
  !process.env.M11_PINNED_METADATA_GATEWAY)
  throw new ApiError(503,"NFT/metadata witness checking OFF until approved real Testnet and IPFS sources");
 const db=getDb();
 const avatar=await db.query<{
  owner_wallet:string;collection_address:string;token_standard:NFTStandard;
  token_id:string;contract_code_hash:string
 }>(`SELECT a.owner_wallet,a.collection_address,a.token_standard,
  a.token_id::text,a.contract_code_hash
  FROM nft_m10_verified_nft_avatars a
  JOIN nft_m10_social_profiles s ON s.wallet_address=a.owner_wallet
    AND s.expires_at>now() AND s.public_approved=true AND s.suspended=false
  WHERE a.owner_wallet=$1 AND a.chain_id=18881 AND
   NOT EXISTS(SELECT 1 FROM nft_m11_social_revocations r WHERE r.wallet_address=a.owner_wallet)`,
  [wallet.toLowerCase()]);
 if(avatar.rowCount!==1)throw new ApiError(409,"Genuine unrevoked avatar selection unavailable");
 const a=avatar.rows[0];
 const registry=await db.query<{deployment_block:string;code_hash:string}>(
  "SELECT deployment_block::text,code_hash FROM nft_collections WHERE chain_id=18881 AND contract_address=$1 AND source_verified=true",
  [a.collection_address]);
 const index=await db.query<{last_block:string;last_hash:string}>(
  "SELECT last_block::text,last_hash FROM nft_indexer_state WHERE chain_id=18881");
 if(registry.rowCount!==1||index.rowCount!==1)
  throw new ApiError(409,"Approved M3 canonical source unavailable");
 const height=BigInt(index.rows[0].last_block),blockHash=index.rows[0].last_hash as Hex;
 const indexed=await db.query("SELECT 1 FROM nft_indexer_blocks WHERE chain_id=18881 AND block_number=$1 AND block_hash=$2",
  [height.toString(),blockHash]);
 if(indexed.rowCount!==1)throw new ApiError(409,"Canonical NFT indexer and block journal disagree");
 const reader=createProofReader(externalRPC(process.env.M10_INDEPENDENT_RPC_URL));
 const witness=await proveNFTAvatar(reader,{
  wallet:a.owner_wallet,collection:a.collection_address,
  tokenId:a.token_id,standard:a.token_standard
 },{
  lastIndexedBlock:height,indexedHash:blockHash,
  deploymentBlock:BigInt(registry.rows[0].deployment_block),
  registryCodeHash:registry.rows[0].code_hash as Hex,sourceVerified:true
 });
 if(witness.codeHash!==a.contract_code_hash)
  throw new ApiError(409,"Previously selected NFT contract runtime hash changed");
 const meta=await db.query<{
  chain_uri:string;metadata_sha256:string;ipfs_cid:string;
  media_ipfs_cid:string;scan_evidence_sha256:string;
 }>(`SELECT m.chain_uri,m.metadata_sha256,m.ipfs_cid,media.media_ipfs_cid,
    media.scan_evidence_sha256 FROM nft_media_metadata_versions m
    JOIN nft_media_assets media ON media.id=m.asset_id AND media.owner_wallet=m.owner_wallet
    JOIN nft_media_review_events review ON review.media_id=media.id
      AND review.reviewer_wallet=media.reviewer_wallet AND review.decision='approved'
    WHERE m.chain_id=18881 AND m.owner_wallet=$1
     AND m.collection_address=$2 AND m.token_id=$3::numeric
     AND m.token_standard=$4 AND m.state='chain_matched'
     AND media.state='approved' AND media.scan_result='clean'
     AND media.scan_evidence_sha256 IS NOT NULL
     AND media.pin_state='verified' AND media.ipfs_verified_at IS NOT NULL
    ORDER BY m.version DESC LIMIT 1`,
  [wallet.toLowerCase(),a.collection_address,a.token_id,a.token_standard]);
 if(meta.rowCount!==1||!meta.rows[0].chain_uri||
  !meta.rows[0].ipfs_cid||!cidPattern.test(meta.rows[0].ipfs_cid))
  throw new ApiError(409,"Cloudinary/ClamAV/Pinata/moderator evidence not complete");
 const m=meta.rows[0],independent=externalRPC(process.env.M10_INDEPENDENT_RPC_URL);
 const primary=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl)});
 const secondary=createPublicClient({transport:http(independent)});
 const abi=a.token_standard==="erc721"?erc721:erc1155;
 const name=a.token_standard==="erc721"?"tokenURI":"uri";
 const id=BigInt(a.token_id),address=a.collection_address as Address;
 const [u1,u2]=await Promise.all([
  primary.readContract({address,abi,functionName:name,args:[id],blockNumber:height}),
  secondary.readContract({address,abi,functionName:name,args:[id],blockNumber:height})
 ]);
 const gateway=publicIpfsGateway(process.env.M11_PINNED_METADATA_GATEWAY);
 const canonical=normalizedMetadataURI(u1,a.token_standard,id);
 // Only a strictly pinned known CID can be fetched, not user-selected SSRF URLs.
 if(!canonical.startsWith("ipfs://"+m.ipfs_cid))
  throw new ApiError(409,"URI on chain does not match approved Pinata metadata CID");
 const assetPath=canonical.slice("ipfs://".length);
 const response=await fetch(gateway+"ipfs/"+assetPath,{
  redirect:"error",cache:"no-store",signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw new ApiError(503,"Operator-pinned IPFS metadata gateway unavailable");
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength===0||bytes.byteLength>65536)
  throw new ApiError(409,"IPFS metadata response exceeded safe size");
 const checked=await verifyPinnedMetadata({standard:a.token_standard,tokenId:id,
  primaryUri:u1,independentUri:u2,storedUri:m.chain_uri,
  storedSha256:m.metadata_sha256,
  ipfsJson:new TextDecoder().decode(bytes)});
 await inTransaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[wallet.toLowerCase()]);
  const row=await client.query(
   "SELECT 1 FROM nft_m10_verified_nft_avatars WHERE owner_wallet=$1 AND collection_address=$2 AND token_id=$3::numeric FOR UPDATE",
   [wallet.toLowerCase(),a.collection_address,a.token_id]);
  if(row.rowCount!==1)throw new ApiError(409,"NFT avatar changed before independent checkpoint");
  // Store only the already verified owner proof; do not mark human audit passed.
  await client.query(`UPDATE nft_m10_verified_nft_avatars SET
    block_number=$2,block_hash=$3,verified_balance=$4::numeric,
    primary_rpc=$5,independent_rpc=$6,explorer_block_url=$7,
    verified_at=now(),expires_at=now()+interval '5 minutes'
    WHERE owner_wallet=$1`,
   [wallet.toLowerCase(),witness.blockNumber,witness.blockHash,witness.balance,
    witness.primaryRpc,witness.independentRpc,witness.explorerBlockUrl]);
 });
 return {owner:wallet.toLowerCase(),collection:a.collection_address,
  tokenId:a.token_id,blockNumber:height.toString(),metadataSha256:checked.sha256,
  verifiedAtOneCanonicalHistoricalBlock:true,externalModerationReviewPassed:false,
  operatorSecurityAuditApproved:false,noTransactions:true};
}
