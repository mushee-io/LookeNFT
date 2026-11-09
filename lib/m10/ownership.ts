import {createPublicClient,http,isAddress,keccak256,parseAbi,type Address,type Hex} from "viem";
import {ULTRA_TESTNET} from "../network";
import {getDb,inTransaction} from "../server/db";
import {ApiError} from "../server/http";
import {m10Gate} from "./bridge";

export type NFTStandard="erc721"|"erc1155";
export type BlockWitness={number:bigint;hash:Hex;parentHash:Hex};
export type ProofReader={
 primaryUrl:string;independentUrl:string;explorerUrl:string;
 chainIds():Promise<[number,number]>;
 heads():Promise<[bigint,bigint]>;
 block(height:bigint,which:"primary"|"independent"):Promise<BlockWitness>;
 code(address:Address,height:bigint,which:"primary"|"independent"):Promise<Hex|undefined>;
 supports(address:Address,standard:NFTStandard,height:bigint,which:"primary"|"independent"):Promise<boolean>;
 owner(address:Address,tokenId:bigint,height:bigint,which:"primary"|"independent"):Promise<Address>;
 balance(address:Address,wallet:Address,tokenId:bigint,height:bigint,which:"primary"|"independent"):Promise<bigint>;
 explorerAgrees(height:bigint,hash:Hex):Promise<boolean>;
};
export type AvatarRequest={wallet:string;collection:string;tokenId:string;standard:NFTStandard};
export type AvatarEvidence={
 wallet:string;collection:string;tokenId:string;standard:NFTStandard;balance:string;
 blockNumber:string;blockHash:string;codeHash:string;primaryRpc:string;
 independentRpc:string;explorerBlockUrl:string;
};
const uint=/^(0|[1-9][0-9]{0,76})$/;
export function avatarInput(x:AvatarRequest){
 if(!x||!isAddress(x.wallet,{strict:false})||
    !isAddress(x.collection,{strict:false})||
    x.wallet.toLowerCase()==="0x"+"0".repeat(40)||
    !uint.test(x.tokenId)||BigInt(x.tokenId)>=(1n<<256n)||
    !["erc721","erc1155"].includes(x.standard))
  throw new ApiError(400,"Invalid wallet, ERC721/1155 collection or token ID");
 return {wallet:x.wallet.toLowerCase() as Address,
  collection:x.collection.toLowerCase() as Address,
  tokenId:BigInt(x.tokenId),standard:x.standard};
}
export function externalRPC(raw:string):string{
 let u:URL;
 try{u=new URL(raw);}catch{throw new ApiError(503,"Independent NFT RPC not configured");}
 if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||
   u.hostname===new URL(ULTRA_TESTNET.rpcUrl).hostname||
   /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1|.*\.local$)/i.test(u.hostname))
  throw new ApiError(503,"Separate, approved public HTTPS Testnet RPC required");
 return u.toString();
}
const erc165=parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const erc721=parseAbi(["function ownerOf(uint256 id) view returns (address)"]);
const erc1155=parseAbi(["function balanceOf(address owner,uint256 id) view returns (uint256)"]);
export function createProofReader(independent:string):ProofReader{
 const url=externalRPC(independent);
 const primary=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
 const secondary=createPublicClient({transport:http(url,{timeout:12000,retryCount:1})});
 const client=(which:"primary"|"independent")=>which==="primary"?primary:secondary;
 return {
  primaryUrl:ULTRA_TESTNET.rpcUrl,independentUrl:url,explorerUrl:ULTRA_TESTNET.explorerUrl,
  chainIds:()=>Promise.all([primary.getChainId(),secondary.getChainId()]),
  heads:()=>Promise.all([primary.getBlockNumber(),secondary.getBlockNumber()]),
  block:async(height,which)=>{
   const b=await client(which).getBlock({blockNumber:height});
   return {number:b.number,hash:b.hash,parentHash:b.parentHash};
  },
  code:(address,height,which)=>client(which).getCode({address,blockNumber:height}),
  supports:(address,standard,height,which)=>client(which).readContract({
   address,abi:erc165,functionName:"supportsInterface",
   args:[standard==="erc721"?"0x80ac58cd":"0xd9b67a26"],blockNumber:height
  }),
  owner:(address,tokenId,height,which)=>client(which).readContract({
   address,abi:erc721,functionName:"ownerOf",args:[tokenId],blockNumber:height
  }),
  balance:(address,wallet,tokenId,height,which)=>client(which).readContract({
   address,abi:erc1155,functionName:"balanceOf",args:[wallet,tokenId],blockNumber:height
  }),
  explorerAgrees:async(height,hash)=>{
   const response=await fetch(ULTRA_TESTNET.explorerUrl+"/api/v2/blocks/"+height,{
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(12000)
   });
   if(!response.ok)throw new ApiError(503,"Blockscout independent NFT block check HTTP "+response.status);
   const result=await response.json() as {hash?:string;height?:number};
   return result.hash?.toLowerCase()===hash.toLowerCase()&&
    (result.height===undefined||result.height===Number(height));
  }
 };
}
export async function proveNFTAvatar(
 reader:ProofReader,request:AvatarRequest,options:{
  lastIndexedBlock:bigint;indexedHash:Hex;deploymentBlock:bigint;
  registryCodeHash:Hex;sourceVerified:boolean;confirmations?:number
 }
):Promise<AvatarEvidence>{
 const input=avatarInput(request);
 if(!options.sourceVerified)throw new ApiError(409,"Collection is not in approved independently sourced M3 registry");
 const confirmations=options.confirmations??12;
 if(!Number.isSafeInteger(confirmations)||confirmations<12||confirmations>128)
  throw new ApiError(400,"At least twelve Testnet confirmations are required");
 const ids=await reader.chainIds();
 if(ids[0]!==18881||ids[1]!==18881)
  throw new ApiError(409,"NFT ownership witness network mismatch: Testnet 18881 only");
 const heads=await reader.heads();
 const finalHead=[heads[0],heads[1]].reduce((x,y)=>x<y?x:y)-BigInt(confirmations);
 const at=options.lastIndexedBlock;
 if(at<options.deploymentBlock||at<1n||at>finalHead||finalHead-at>25n)
  throw new ApiError(409,"M3 NFT indexer proof must be recent and independently finalised");
 const [primaryBlock,independentBlock,codeA,codeB,standardA,standardB]=await Promise.all([
  reader.block(at,"primary"),reader.block(at,"independent"),
  reader.code(input.collection,at,"primary"),reader.code(input.collection,at,"independent"),
  reader.supports(input.collection,input.standard,at,"primary"),
  reader.supports(input.collection,input.standard,at,"independent"),
 ]);
 if(primaryBlock.number!==at||independentBlock.number!==at||
  primaryBlock.hash.toLowerCase()!==options.indexedHash.toLowerCase()||
  independentBlock.hash.toLowerCase()!==options.indexedHash.toLowerCase()||
  primaryBlock.parentHash.toLowerCase()!==independentBlock.parentHash.toLowerCase()||
  !codeA||codeA==="0x"||codeA.toLowerCase()!==codeB?.toLowerCase()||
  keccak256(codeA).toLowerCase()!==options.registryCodeHash.toLowerCase()||
  !standardA||!standardB)
  throw new ApiError(409,"NFT contract code, ERC165 standard or canonical block differs from independent M3 witnesses");
 if(!await reader.explorerAgrees(at,primaryBlock.hash))
  throw new ApiError(409,"Independent Blockscout ownership block hash differs");
 let balance:bigint;
 if(input.standard==="erc721"){
  const [ownerA,ownerB]=await Promise.all([
   reader.owner(input.collection,input.tokenId,at,"primary"),
   reader.owner(input.collection,input.tokenId,at,"independent")
  ]);
  if(ownerA.toLowerCase()!==input.wallet||ownerB.toLowerCase()!==input.wallet)
   throw new ApiError(403,"Both RPCs must prove NFT owner equals authenticated wallet");
  balance=1n;
 }else{
  const [a,b]=await Promise.all([
   reader.balance(input.collection,input.wallet,input.tokenId,at,"primary"),
   reader.balance(input.collection,input.wallet,input.tokenId,at,"independent")
  ]);
  if(a<1n||a!==b)throw new ApiError(403,"Independent ERC1155 balances must agree and be positive");
  balance=a;
 }
 return {
  wallet:input.wallet,collection:input.collection,tokenId:input.tokenId.toString(),
  standard:input.standard,balance:balance.toString(),blockNumber:at.toString(),
  blockHash:primaryBlock.hash.toLowerCase(),codeHash:keccak256(codeA).toLowerCase(),
  primaryRpc:reader.primaryUrl,independentRpc:reader.independentUrl,
  explorerBlockUrl:reader.explorerUrl+"/block/"+at.toString()
 };
}
/** No pending transaction, token approval, NFT transfer or account delegation. */
export async function verifyAndSaveAvatar(wallet:string,request:AvatarRequest,
 reader?:ProofReader):Promise<AvatarEvidence>{
 m10Gate("social");m10Gate("avatar");
 const input=avatarInput(request);
 if(input.wallet!==wallet.toLowerCase())throw new ApiError(403,"Cannot configure another wallet's NFT profile picture");
 const source=reader||createProofReader(process.env.M10_INDEPENDENT_RPC_URL||"");
 const database=getDb();
 const [profile,registered,coverage]=await Promise.all([
  database.query(`SELECT wallet_address FROM nft_m10_social_profiles
   WHERE wallet_address=$1 AND expires_at>now() AND public_approved=true AND suspended=false`,
   [input.wallet]),
  database.query<{token_standard:string;code_hash:string;deployment_block:string}>(
   `SELECT token_standard,code_hash,deployment_block::text FROM nft_collections
    WHERE chain_id=18881 AND contract_address=$1 AND source_verified=true`,
   [input.collection]),
  database.query<{last_block:string;last_hash:string}>(
   "SELECT last_block::text,last_hash FROM nft_indexer_state WHERE chain_id=18881"
  )
 ]);
 if(profile.rowCount!==1||registered.rowCount!==1||coverage.rowCount!==1||
    registered.rows[0].token_standard!==input.standard)
  throw new ApiError(409,"Genuine linked profile, M3 approved NFT contract or canonical indexer missing");
 const at=BigInt(coverage.rows[0].last_block);
 const indexed=await database.query<{block_hash:string}>(
  "SELECT block_hash FROM nft_indexer_blocks WHERE chain_id=18881 AND block_number=$1",
  [at.toString()]);
 if(indexed.rowCount!==1||indexed.rows[0].block_hash!==coverage.rows[0].last_hash)
  throw new ApiError(409,"M3 canonical indexer block is incomplete");
 const evidence=await proveNFTAvatar(source,request,{
  lastIndexedBlock:at,indexedHash:coverage.rows[0].last_hash as Hex,
  deploymentBlock:BigInt(registered.rows[0].deployment_block),
  registryCodeHash:registered.rows[0].code_hash as Hex,sourceVerified:true
 });
 await inTransaction(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[input.wallet]);
  const current=await db.query<{profile_id:string}>(
   `SELECT s.profile_id FROM nft_m10_social_profiles s
    JOIN nft_profile_links l ON l.wallet_address=s.wallet_address
     AND l.profile_id=s.profile_id
    WHERE s.wallet_address=$1 AND s.expires_at>now() AND s.public_approved=true
     AND s.suspended=false FOR UPDATE OF s`,[input.wallet]);
  if(current.rowCount!==1)throw new ApiError(403,"Looke Social profile or wallet authorisation changed");
  const match=await db.query<{last_hash:string}>(
   `SELECT x.last_hash FROM nft_indexer_state x JOIN nft_indexer_blocks b
    ON b.chain_id=x.chain_id AND b.block_number=x.last_block AND b.block_hash=x.last_hash
    WHERE x.chain_id=18881 AND x.last_block=$1 AND x.last_hash=$2`,
   [evidence.blockNumber,evidence.blockHash]
  );
  if(match.rowCount!==1)throw new ApiError(409,"Canonical M3 indexer changed during NFT ownership check");
  await db.query(`INSERT INTO nft_m10_verified_nft_avatars(
   owner_wallet,collection_address,token_standard,token_id,verified_balance,
   block_number,block_hash,contract_code_hash,primary_rpc,independent_rpc,
   explorer_block_url,verified_at,expires_at)
   VALUES($1,$2,$3,$4::numeric,$5::numeric,$6,$7,$8,$9,$10,$11,now(),now()+interval '5 minutes')
   ON CONFLICT(owner_wallet) DO UPDATE SET
    collection_address=excluded.collection_address,token_standard=excluded.token_standard,
    token_id=excluded.token_id,verified_balance=excluded.verified_balance,
    block_number=excluded.block_number,block_hash=excluded.block_hash,
    contract_code_hash=excluded.contract_code_hash,primary_rpc=excluded.primary_rpc,
    independent_rpc=excluded.independent_rpc,explorer_block_url=excluded.explorer_block_url,
    verified_at=excluded.verified_at,expires_at=excluded.expires_at`,
   [evidence.wallet,evidence.collection,evidence.standard,evidence.tokenId,
    evidence.balance,evidence.blockNumber,evidence.blockHash,evidence.codeHash,
    evidence.primaryRpc,evidence.independentRpc,evidence.explorerBlockUrl]
  );
  await db.query("DELETE FROM nft_m10_holder_collection_links WHERE wallet_address=$1",
   [evidence.wallet]);
  await db.query(`INSERT INTO nft_m10_holder_collection_links(
   wallet_address,collection_address,token_id) VALUES($1,$2,$3::numeric)`,
   [evidence.wallet,evidence.collection,evidence.tokenId]);
 });
 return evidence;
}
export async function unsetAvatar(wallet:string){
 await inTransaction(async db=>{
  await db.query("DELETE FROM nft_m10_holder_collection_links WHERE wallet_address=$1",
   [wallet.toLowerCase()]);
  await db.query("DELETE FROM nft_m10_verified_nft_avatars WHERE owner_wallet=$1",
   [wallet.toLowerCase()]);
 });
}
