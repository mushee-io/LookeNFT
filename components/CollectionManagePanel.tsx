"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {createPublicClient,encodeFunctionData,http,parseAbi,type Address,type Hex} from "viem";
import {useWalletSession} from "@/components/WalletSessionProvider";
import {ULTRA_TESTNET} from "@/lib/network";

type Drop={
 address:string;standard:"erc721"|"erc1155";title:string;description:string;
 coverUrl:string|null;avatarUrl:string|null;status:"draft"|"published";
 phaseId:string;mintAvailable:boolean;mintEnabled:boolean;
};
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const abi=parseAbi([
 "function owner() view returns (address)",
 "function paused() view returns (bool)",
 "function metadataFrozen() view returns (bool)",
 "function baseTokenURI() view returns (string)",
 "function uri(uint256) view returns (string)",
 "function maxSupply() view returns (uint256)",
 "function maxTotalMinted() view returns (uint256)",
 "function totalMinted() view returns (uint256)",
 "function phaseCount() view returns (uint256)",
 "function mintPhases(uint256) view returns (uint64 start,uint64 end,uint96 unitPrice,uint32 walletCap,uint32 phaseCap,uint32 minted,bytes32 merkleRoot,bool cancelled)",
 "function scheduleMintPhase(uint64 start,uint64 end,uint96 unitPrice,uint32 walletCap,uint32 phaseCap,bytes32 merkleRoot) returns (uint256)",
 "function pauseMinting()",
 "function unpauseMinting()",
 "function setBaseURI(string nextURI)",
 "function setURI(string nextURI)"
]);
type Live={
 owner:string;paused:boolean;metadataFrozen:boolean;phaseCount:number;activePhase:number;
 totalMinted:bigint;maxSupply:bigint;baseURI:string;phaseStart:bigint;phaseEnd:bigint;
};
function errText(e:unknown){return e instanceof Error?e.message.slice(0,450):"Unable to verify request";}
async function json<T>(res:Response):Promise<T>{
 const result=await res.json() as {error?:string};
 if(!res.ok)throw Error(result.error||"The collection request was not accepted");
 return result as T;
}
export default function CollectionManagePanel({collection,onChanged}:{
 collection:Drop;onChanged:(patch:Partial<Drop>)=>void;
}){
 const wallet=useWalletSession();
 const [live,setLive]=useState<Live|null>(null);
 const [ownerOk,setOwnerOk]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [title,setTitle]=useState(collection.title);
 const [description,setDescription]=useState(collection.description);
 const [cover,setCover]=useState(collection.coverUrl||"");
 const [avatar,setAvatar]=useState(collection.avatarUrl||"");
 const [metadata,setMetadata]=useState("");
 const [walletCap,setWalletCap]=useState("3");
 const [show,setShow]=useState(false);
 async function inspect(){
  const address=collection.address as Address;
  const [chain,owner,paused,frozen,total,max,base,count,block]=await Promise.all([
   rpc.getChainId(),rpc.readContract({address,abi,functionName:"owner"}),
   rpc.readContract({address,abi,functionName:"paused"}),
   rpc.readContract({address,abi,functionName:"metadataFrozen"}),
   rpc.readContract({address,abi,functionName:"totalMinted"}),
   rpc.readContract({address,abi,functionName:collection.standard==="erc721"?"maxSupply":"maxTotalMinted"}),
   collection.standard==="erc721"?
    rpc.readContract({address,abi,functionName:"baseTokenURI"}):
    rpc.readContract({address,abi,functionName:"uri",args:[1n]}),
   rpc.readContract({address,abi,functionName:"phaseCount"}),rpc.getBlock()
  ]);
  if(chain!==18881)throw Error("Wrong Ultra EVM Testnet RPC chain");
  let activePhase=0,phaseStart=0n,phaseEnd=0n;
  for(let id=Number(count);id>0&&id>Number(count)-5;id--){
    const [start,end,price,cap,limit,minted,root,cancelled]=await rpc.readContract({
      address,abi,functionName:"mintPhases",args:[BigInt(id)]});
    if(!cancelled&&price===0n&&root==="0x"+"0".repeat(64)&&
      end>block.timestamp&&limit>minted&&cap>0){
      activePhase=id;phaseStart=start;phaseEnd=end;break;
    }
  }
  const info={owner:owner.toLowerCase(),paused,metadataFrozen:frozen,
   phaseCount:Number(count),activePhase,totalMinted:total,maxSupply:max,
   baseURI:base,phaseStart,phaseEnd};
  setLive(info);setMetadata(base);
  setOwnerOk(Boolean(wallet.address&&wallet.chainId===18881&&wallet.address.toLowerCase()===owner.toLowerCase()));
  return info;
 }
 useEffect(()=>{
   let closed=false;
   setLive(null);setOwnerOk(false);setError("");
   if(!wallet.address||wallet.chainId!==18881)return;
   void inspect().catch(e=>{if(!closed)setError(errText(e));});
   return()=>{closed=true;};
 // Re-check when the wallet changes; transactions revalidate ownership in provider.
 },[collection.address,collection.standard,wallet.address,wallet.chainId]);
 if(!wallet.address||wallet.chainId!==18881)return <p className="operator-note">Connect an Ultra EVM Testnet wallet to manage a collection you own.</p>;
 if(!live||!ownerOk)return <p className="operator-note">Collection editing is only available to the wallet that currently owns the NFT contract.{error?" "+error:""}</p>;
 async function run(fn:()=>Promise<void>){
  setBusy(true);setError("");setNotice("");
  try{await fn();}catch(e){setError(errText(e));}finally{setBusy(false);}
 }
 async function saveAppearance(){
  await run(async()=>{
   if(!wallet.authenticated)throw Error("Click Sign in in your wallet header before changing the collection page.");
   const result=await json<{collection:{title:string;description:string;cover_url:string|null;avatar_url:string|null;status:Drop["status"]}}>(
    await fetch("/api/creator/collections/"+collection.address,{method:"PATCH",
      headers:{"Content-Type":"application/json"},credentials:"same-origin",
      body:JSON.stringify({title,description,coverUrl:cover.trim(),avatarUrl:avatar.trim()})}));
   onChanged({title:result.collection.title,description:result.collection.description,
    coverUrl:result.collection.cover_url,avatarUrl:result.collection.avatar_url});
   setNotice("Collection banner, profile picture and description saved. Artwork images must be publicly accessible at these URLs.");
  });
 }
 async function setVisibility(status:Drop["status"]){
  await run(async()=>{
   if(!wallet.authenticated)throw Error("Sign in with the collection owner wallet first.");
   await json(await fetch("/api/creator/collections/"+collection.address,{method:"PATCH",
      credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}));
   onChanged({status,mintAvailable:status==="published"&&collection.mintAvailable});
   setNotice(status==="published"?"Your collection is listed on Explore.":"Collection hidden from public Explore. NFT ownership is unchanged.");
  });
 }
 async function action(data:Hex,message:string){
  const hash=await wallet.submitCollectionControl(collection.address,data);
  setNotice("Wallet transaction sent: "+hash+". Waiting for on-chain confirmation.");
  const receipt=await rpc.waitForTransactionReceipt({hash,confirmations:1,timeout:120000});
  if(receipt.status!=="success")throw Error("The owner transaction reverted. No setting was changed.");
  setNotice(message+" Transaction: "+hash);
  return hash;
 }
 async function updateMetadata(){
  await run(async()=>{
   if(!live||live.metadataFrozen)throw Error("Metadata is unavailable or frozen; token images cannot be changed.");
   const uri=metadata.trim();
   if(!uri.startsWith("ipfs://")||!uri.endsWith("/"))
    throw Error("Enter the NEW Pinata metadata folder URI, for example ipfs://NEW_CID/. Not the image ZIP URL.");
   await action(encodeFunctionData({abi,functionName:collection.standard==="erc721"?"setBaseURI":"setURI",args:[uri]}),
     "NFT metadata URI changed on-chain. Refresh the gallery to load the newly hosted images.");
   await inspect();
  });
 }
 async function syncMint(phase:number){
  if(!wallet.authenticated)throw Error("Sign in with your owner wallet to sync the public mint setting.");
  const r=await json<{mintActive:boolean;mintScheduled:boolean;phaseId:string}>(await fetch(
   "/api/creator/collections/"+collection.address,{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"sync-free-mint",phaseId:String(phase)})}));
  onChanged({phaseId:r.phaseId,mintEnabled:r.mintScheduled,mintAvailable:r.mintActive});
 }
 async function enableMint(){
  await run(async()=>{
   const info=await inspect();
   if(!wallet.authenticated)throw Error("Sign in with the collection owner wallet first.");
   if(info.paused){
    await action(encodeFunctionData({abi,functionName:"unpauseMinting"}),
      "Minting is unpaused at the smart contract.");
   }
   if(info.activePhase){
    await syncMint(info.activePhase);
    setNotice("Existing free public mint phase enabled. No second phase was created.");
    await inspect();
    return;
   }
   const remaining=info.maxSupply-info.totalMinted;
   const cap=Number(walletCap);
   if(remaining<1n)throw Error("All NFTs have been minted already.");
   if(!Number.isInteger(cap)||cap<1||cap>1000||BigInt(cap)>remaining)
    throw Error("Per-wallet limit must be between 1 and the remaining supply.");
   const block=await rpc.getBlock({blockTag:"latest"});
   const start=block.timestamp+45n,end=start+7n*86400n;
   const phaseId=info.phaseCount+1;
   await action(encodeFunctionData({abi,functionName:"scheduleMintPhase",
    args:[start,end,0n,cap,Number(remaining),"0x"+ "0".repeat(64) as `0x${string}`]}),
    "A seven-day free public mint phase was scheduled on-chain.");
   await syncMint(phaseId);
   await inspect();
   setNotice("Free public mint phase #"+phaseId+" scheduled. It opens shortly after the confirmed transaction. Wallet signatures are required from each collector.");
  });
 }
 async function pauseMint(){
  await run(async()=>{
   await action(encodeFunctionData({abi,functionName:"pauseMinting"}),
     "Minting paused at the collection contract.");
   const info=await inspect();
   if(info.activePhase)await syncMint(info.activePhase);
   onChanged({mintAvailable:false,mintEnabled:false});
  });
 }
 return <section className="creator-publish-panel" style={{marginTop:28}}>
  <button type="button" className="creator-secondary" onClick={()=>setShow(s=>!s)}>
   {show?"Close Manage Collection":"Manage Collection · Owner"}
  </button>
  {show&&<div style={{display:"grid",gap:18,marginTop:20}}>
   <h2>Collection owner controls</h2>
   {!wallet.authenticated&&<button type="button" disabled={busy||wallet.pending} onClick={()=>void wallet.signIn()}>Sign in with owner wallet to edit</button>}
   <p>Connected wallet: {wallet.address}. You own this Ultra EVM Testnet NFT contract. Changes to this page require wallet sign-in; on-chain changes require separate transaction approval.</p>
   <div style={{display:"grid",gap:10}}>
    <label>Collection name<input value={title} maxLength={90} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Description<textarea rows={4} value={description} maxLength={1200} onChange={e=>setDescription(e.target.value)}/></label>
    <label>Banner / cover image URL<input value={cover} onChange={e=>setCover(e.target.value)}
      placeholder="https://your-public-pinata-gateway/ipfs/CID/banner.png" /></label>
    <label>Profile picture URL<input value={avatar} onChange={e=>setAvatar(e.target.value)}
      placeholder="https://your-public-pinata-gateway/ipfs/CID/avatar.png" /></label>
    <p className="operator-note">Upload images to Pinata first. Open each image URL in a private window to confirm it works before saving. IPFS ZIP archives are not direct image URLs.</p>
    <button type="button" disabled={busy||!wallet.authenticated} onClick={()=>void saveAppearance()}>Save pictures and description</button>
   </div>
   <div style={{display:"grid",gap:10}}>
    <h3>Collection listing</h3>
    <p>Publishing lists this collection on Explore. It is separate from listing a specific NFT for sale.</p>
    <button type="button" disabled={busy||!wallet.authenticated}
     onClick={()=>void setVisibility(collection.status==="published"?"draft":"published")}>
     {collection.status==="published"?"Unlist collection from Explore":"List collection on Explore"}
    </button>
    <Link href={"/market?collection="+encodeURIComponent(collection.address)+"#seller-listing"}>
     List an individual NFT for sale ↗
    </Link>
    <small>Token resale needs a verified marketplace contract and NFT transfer approval. If unavailable, the market explains why; no fake listing is created.</small>
   </div>
   <div style={{display:"grid",gap:10}}>
    <h3>Enable free public minting</h3>
    <p>On-chain mint status: {live.paused?"Paused":live.activePhase?"Free phase #"+live.activePhase+" scheduled":"No current public free phase"}.
     {" "}Minted {live.totalMinted.toString()} of {live.maxSupply.toString()} NFTs.</p>
    <label>Max mint per wallet (new free phase)<input inputMode="numeric" value={walletCap} onChange={e=>setWalletCap(e.target.value)}/></label>
    <button type="button" disabled={busy||!wallet.authenticated||collection.status!=="published"}
     onClick={()=>void enableMint()}>{busy?"Checking Testnet…":"Enable free mint (wallet approval)"}</button>
    <button type="button" className="creator-secondary" disabled={busy||live.paused} onClick={()=>void pauseMint()}>
     Pause minting (wallet approval)
    </button>
    <p className="operator-note">Free mint means 0 UOS price plus Testnet gas. Opening or pausing minting changes the smart contract, not just this page. Paid minting remains unavailable.</p>
   </div>
   <div style={{display:"grid",gap:10}}>
    <h3>Update individual NFT pictures via metadata</h3>
    <p>To replace images of already-minted NFTs, host a new metadata folder with working image links and update the contract's base URI. Previous IPFS content does not change. {live.metadataFrozen?"This collection has permanently frozen token metadata.":""}</p>
    <label>On-chain metadata base URI<input value={metadata} onChange={e=>setMetadata(e.target.value)}
     placeholder="ipfs://NEW_METADATA_CID/" /></label>
    <button type="button" disabled={busy||live.metadataFrozen} onClick={()=>void updateMetadata()}>
     Update NFT metadata on-chain (wallet approval)
    </button>
   </div>
   {error&&<p role="alert" className="operator-error">{error}</p>}
   {notice&&<p role="status" className="operator-note">{notice}</p>}
  </div>}
 </section>;
}
