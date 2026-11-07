import { createPublicClient, getAddress, http, isAddress, parseAbi, type Address } from "viem";
import type { NextRequest } from "next/server";
import { ULTRA_TESTNET } from "@/lib/network";
import { requireSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http";

export type CuratedCollection = {
  address: string;
  standard: "erc721" | "erc1155";
  title: string;
  description: string;
  coverUrl: string | null;
  avatarUrl: string | null;
  creatorWallet: string;
  phaseId: string;
  status: "draft" | "published";
  mintEnabled: boolean;
  mintAvailable: boolean;
  publishedAt: string | null;
  archived: boolean;
};
const ownerAbi = parseAbi(["function owner() view returns (address)", "function supportsInterface(bytes4) view returns (bool)"]);
const factoryAbi = parseAbi(["function isCollection(address) view returns (bool)","function VERSION() view returns (uint256)","function owner() view returns (address)"]);
const rpc = createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});

export function operatorAddress(): Address | null {
  const raw = process.env.LOOKE_NFT_OPERATOR_WALLET || "";
  return isAddress(raw, {strict:false}) ? getAddress(raw) : null;
}
export function isOperatorWallet(wallet: string | null | undefined): boolean {
  const owner = operatorAddress();
  return !!owner && !!wallet && wallet.toLowerCase() === owner.toLowerCase();
}
export async function requireOperator(request: NextRequest): Promise<string> {
  const session=await requireSession(request);
  if(session.chainId!==18881 || !isOperatorWallet(session.wallet))
    throw new ApiError(403,"Only the configured LookeNFT operator wallet may manage collections");
  return session.wallet.toLowerCase();
}
export function releaseMintEnabled(): boolean {
  // An individual publication toggle is never sufficient to unlock a financial action.
  return process.env.NEXT_PUBLIC_M5_ENABLE_MINTING==="true" &&
    process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED==="true" &&
    process.env.M12_FINAL_FINANCIAL_EXECUTION_ENABLED==="true" &&
    process.env.M12_FINAL_PUBLIC_BETA_ENABLED==="true";
}
export function validateCoverUrl(value: unknown): string | null {
  if(value==null || value==="") return null;
  if(typeof value!=="string" || value.length>2048)throw new ApiError(400,"Invalid cover URL");
  let url: URL;
  try {url=new URL(value);} catch {throw new ApiError(400,"Cover must be a valid HTTPS URL");}
  if(url.protocol!=="https:" || url.username || url.password || url.hash)
    throw new ApiError(400,"Cover must be a public HTTPS image URL");
  const allowed=(process.env.LOOKE_NFT_COVER_HOSTS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!allowed.includes(url.hostname.toLowerCase()))
    throw new ApiError(403,"Cover hostname is not explicitly approved by operator");
  return url.toString();
}
export async function verifyOperatorCollection(addressRaw:string,operator:string):Promise<{address:string;standard:"erc721"|"erc1155"}>{
  if(!isAddress(addressRaw,{strict:false}))throw new ApiError(400,"Valid EVM collection address required");
  const address=getAddress(addressRaw);
  const registry=await getDb().query<{token_standard:"erc721"|"erc1155"}>(
    "SELECT token_standard FROM nft_collections WHERE chain_id=18881 AND contract_address=$1",
    [address.toLowerCase()]
  );
  if(registry.rowCount!==1)throw new ApiError(409,"Collection must first pass the canonical indexer registration and checks");
  const factoryRaw=process.env.LOOKE_NFT_OWNER_FACTORY_ADDRESS || "";
  if(!isAddress(factoryRaw,{strict:false}))throw new ApiError(503,"Verified operator factory is not configured");
  const factory=getAddress(factoryRaw);
  const [chainId,code,owner,registered,supports,version,factoryOwner]=await Promise.all([
    rpc.getChainId(),
    rpc.getCode({address}),
    rpc.readContract({address,abi:ownerAbi,functionName:"owner"}),
    rpc.readContract({address:factory,abi:factoryAbi,functionName:"isCollection",args:[address]}),
    rpc.readContract({address,abi:ownerAbi,functionName:"supportsInterface",
      args:[registry.rows[0].token_standard==="erc721"?"0x80ac58cd":"0xd9b67a26"]}),
    rpc.readContract({address:factory,abi:factoryAbi,functionName:"VERSION"}),
    rpc.readContract({address:factory,abi:factoryAbi,functionName:"owner"})
  ]).catch(()=>{throw new ApiError(503,"Unable to verify collection owner, factory and interface on Ultra Testnet");});
  if(chainId!==18881 || version!==3n || factoryOwner.toLowerCase()!==operator.toLowerCase() || !code || code==="0x" || !registered || !supports)
    throw new ApiError(409,"Collection does not pass live Testnet factory/interface checks");
  if(owner.toLowerCase()!==operator.toLowerCase())
    throw new ApiError(403,"Collection contract must be owned by the authorised operator wallet");
  return {address:address.toLowerCase(),standard:registry.rows[0].token_standard};
}
type Row={contract_address:string;token_standard:"erc721"|"erc1155";title:string;description:string;cover_url:string|null;avatar_url:string|null;operator_wallet:string;mint_phase_id:string;status:"draft"|"published";mint_enabled:boolean;published_at:Date|null;archived_at:Date|null};
export async function curatedCollections(publicOnly=true, address?:string): Promise<CuratedCollection[]> {
  const r=await getDb().query<Row>(
    `SELECT c.contract_address,n.token_standard,c.title,c.description,c.cover_url,
            c.mint_phase_id::text,c.status,c.mint_enabled,c.published_at,c.avatar_url,c.operator_wallet,c.archived_at
     FROM looke_curated_collections c
     INNER JOIN nft_collections n ON n.chain_id=c.chain_id AND n.contract_address=c.contract_address
     WHERE c.chain_id=18881 AND ($1::boolean=FALSE OR (c.status='published' AND c.archived_at IS NULL))
       AND ($2::text IS NULL OR c.contract_address=$2)
     ORDER BY c.published_at DESC NULLS LAST,c.created_at DESC LIMIT 100`,
    [publicOnly,address||null]
  );
  // Self-serve Ultra Testnet minting is governed by the creator-owned contract,
  // not by stale operator/database enable flags. Only zero-price public phases.
  const freeAbi=parseAbi([
    "function paused() view returns (bool)",
    "function phaseCount() view returns (uint256)",
    "function totalMinted() view returns (uint256)",
    "function maxSupply() view returns (uint256)",
    "function maxTotalMinted() view returns (uint256)",
    "function mintPhases(uint256) view returns (uint64 start,uint64 end,uint96 unitPrice,uint32 walletCap,uint32 phaseCap,uint32 minted,bytes32 merkleRoot,bool cancelled)"
  ]);
  const block=r.rows.length?await rpc.getBlock({blockTag:"latest"}).catch(()=>null):null;
  return Promise.all(r.rows.map(async x=>{
    let mintAvailable=false;
    let phaseId=x.mint_phase_id;
    if(block){
      try{
        const address=x.contract_address as Address;
        const [paused,count,total,max]=await Promise.all([
          rpc.readContract({address,abi:freeAbi,functionName:"paused",blockNumber:block.number}),
          rpc.readContract({address,abi:freeAbi,functionName:"phaseCount",blockNumber:block.number}),
          rpc.readContract({address,abi:freeAbi,functionName:"totalMinted",blockNumber:block.number}),
          rpc.readContract({address,abi:freeAbi,
            functionName:x.token_standard==="erc721"?"maxSupply":"maxTotalMinted",
            blockNumber:block.number})
        ]);
        if(!paused&&total<max){
          // Search recent phases first, then the indexed phase if it is older.
          const ids:number[]=[];
          for(let id=Number(count);id>0&&id>Number(count)-10;id--)ids.push(id);
          const saved=Number(x.mint_phase_id);
          if(saved>0&&saved<=Number(count)&&!ids.includes(saved))ids.push(saved);
          for(const id of ids){
            const [start,end,price,walletCap,cap,minted,root,cancelled]=await rpc.readContract({
              address,abi:freeAbi,functionName:"mintPhases",args:[BigInt(id)],blockNumber:block.number
            });
            if(!cancelled&&price===0n&&root==="0x"+"0".repeat(64)&&
              walletCap>0&&cap>minted&&block.timestamp>=start&&block.timestamp<=end){
              mintAvailable=true;phaseId=String(id);break;
            }
          }
        }
      }catch{mintAvailable=false;}
    }
    return {
      address:x.contract_address,standard:x.token_standard,title:x.title,
      description:x.description,coverUrl:x.cover_url,avatarUrl:x.avatar_url,
      creatorWallet:x.operator_wallet,phaseId,
      status:x.status,archived:x.archived_at!==null,mintEnabled:!x.archived_at&&mintAvailable,mintAvailable:!x.archived_at&&mintAvailable,
      publishedAt:x.published_at?.toISOString()||null
    };
  }));
}
