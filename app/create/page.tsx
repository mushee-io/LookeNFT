"use client";
import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, parseAbi, parseEther, toHex, type Address, type Hex } from "viem";
import { useWalletSession } from "@/components/WalletSessionProvider";
import { ULTRA_TESTNET } from "@/lib/network";
import { factoryAbi,validateCollectionDraft,M4_FACTORY_ADDRESS,M4_CANCUN_VERIFIED,M4_DEPLOY_ENABLED,type CollectionDraft } from "@/lib/m4/factory";

type Standard="erc721"|"erc1155";
type Form={
 standard:Standard;name:string;symbol:string;description:string;coverUrl:string;
 metadataUri:string;totalCap:string;perIdCap:string;mintPriceUos:string;
 perWalletCap:string;royaltyPercent:string;
};
const defaults:Form={
 standard:"erc721",name:"",symbol:"",description:"",coverUrl:"",
 metadataUri:"",totalCap:"1000",perIdCap:"1",mintPriceUos:"0",
 perWalletCap:"3",royaltyPercent:"0"
};
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const ownerAbi=parseAbi(["function owner() view returns (address)"]);
const deployAllowed=M4_CANCUN_VERIFIED&&M4_DEPLOY_ENABLED&&isAddress(M4_FACTORY_ADDRESS,{strict:false});

function inspect(form:Form,wallet:string|null,salt:string){
 if(!wallet||!isAddress(wallet,{strict:false}))throw Error("Connect the authorised Ultra Testnet wallet.");
 if(form.name.trim().length<2||form.name.trim().length>90)throw Error("Collection name must be 2–90 characters.");
 if(form.description.length>1200)throw Error("Description cannot exceed 1200 characters.");
 if(form.coverUrl){
  const cover=new URL(form.coverUrl);
  if(cover.protocol!=="https:"||cover.username||cover.password||cover.hash)throw Error("Cover artwork needs a public HTTPS URL without credentials.");
 }
 if(!/^(0|[1-9][0-9]{0,3})(?:\.[0-9]{1,18})?$/.test(form.mintPriceUos))throw Error("Mint price must be 0–1000 UOS with at most 18 decimals.");
 const price=parseEther(form.mintPriceUos);
 if(price>1000n*10n**18n)throw Error("Mint price cannot exceed 1000 UOS.");
 if(!/^[1-9][0-9]{0,3}$/.test(form.perWalletCap) || BigInt(form.perWalletCap)>1000n)
  throw Error("Per-wallet mint limit must be 1–1000.");
 if(BigInt(form.perWalletCap)>BigInt(form.totalCap||"0"))
  throw Error("Per-wallet mint limit cannot exceed the collection supply.");
 const percent=Number(form.royaltyPercent);
 if(!/^(?:0|[1-9]|10)(?:\.[0-9]{1,2})?$/.test(form.royaltyPercent)||!Number.isFinite(percent)||percent>10)
  throw Error("Royalty must be between 0 and 10 percent (up to two decimal places).");
 const draft:CollectionDraft={
  standard:form.standard,name:form.name,symbol:form.symbol,uri:form.metadataUri,
  totalCap:form.totalCap,perIdCap:form.perIdCap,
  royaltyBps:String(Math.round(percent*100)),royaltyReceiver:wallet,salt
 };
 return {validated:validateCollectionDraft(draft),price};
}
async function readAdmin(res:Response){
 const value=await res.json() as {error?:string;collections?:unknown[]};
 if(!res.ok)throw Error(value.error||"Admin request was rejected.");
 return value;
}

export default function CreateCollectionPage(){
 const wallet=useWalletSession();
 const [authorised,setAuthorised]=useState<boolean|null>(null);
 const [form,setForm]=useState<Form>(defaults);
 const [salt,setSalt]=useState("");
 const [stage,setStage]=useState<"edit"|"preview">("edit");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [txHash,setTxHash]=useState<Hex|null>(null);
 const [confirmedAddress,setConfirmedAddress]=useState("");
 const [manualAddress,setManualAddress]=useState("");
 const [published,setPublished]=useState(false);

 useEffect(()=>{
  const random=new Uint8Array(32);window.crypto.getRandomValues(random);setSalt(toHex(random));
 },[]);
 useEffect(()=>{
  setAuthorised(null);
  if(!wallet.authenticated||wallet.chainId!==18881){setAuthorised(false);return;}
  const abort=new AbortController();
  fetch("/api/admin/collections",{cache:"no-store",credentials:"same-origin",signal:abort.signal})
   .then(r=>{if(!abort.signal.aborted)setAuthorised(r.ok);})
   .catch(()=>{if(!abort.signal.aborted)setAuthorised(false);});
  return()=>abort.abort();
 },[wallet.authenticated,wallet.address,wallet.chainId]);
 const put=(key:keyof Form,value:string)=>{
  setForm(old=>({...old,[key]:value}));
  setConfirmedAddress("");setTxHash(null);setPublished(false);setError("");setNotice("");
 };
 function preview(event:FormEvent){
  event.preventDefault();setError("");setNotice("");
  try{inspect(form,wallet.address,salt);setStage("preview");window.scrollTo({top:0,behavior:"smooth"});}
  catch(e){setError(e instanceof Error?e.message:"Invalid collection settings.");}
 }
 async function deploy(){
  if(!authorised)return;
  setError("");setNotice("");setBusy(true);
  try{
   const {validated}=inspect(form,wallet.address,salt);
   if(!deployAllowed||!isAddress(M4_FACTORY_ADDRESS,{strict:false}))
    throw Error("Operator-only V3 factory deployment is not enabled. An independently verified factory and Testnet approval are required.");
   const factory=getAddress(M4_FACTORY_ADDRESS);
   const owner=getAddress(validated.royaltyReceiver);
   const [chainId,version,factoryOwner]=await Promise.all([
    rpc.getChainId(),
    rpc.readContract({address:factory,abi:factoryAbi,functionName:"VERSION"}),
    rpc.readContract({address:factory,abi:ownerAbi,functionName:"owner"})
   ]);
   if(chainId!==18881||version!==3n||factoryOwner.toLowerCase()!==owner.toLowerCase())
    throw Error("Configured factory is not the approved V3 contract controlled by this operator wallet.");
   const expected=validated.standard==="erc721"
    ? await rpc.readContract({address:factory,abi:factoryAbi,functionName:"predictERC721",
      args:[owner,validated.name,validated.symbol,validated.uri,validated.totalCap,owner,BigInt(validated.royaltyBps),validated.salt]})
    : await rpc.readContract({address:factory,abi:factoryAbi,functionName:"predictERC1155",
      args:[owner,validated.uri,validated.totalCap,validated.perIdCap,owner,BigInt(validated.royaltyBps),validated.salt]});
   const calldata=validated.standard==="erc721"
    ? encodeFunctionData({abi:factoryAbi,functionName:"createERC721",
      args:[validated.name,validated.symbol,validated.uri,validated.totalCap,owner,BigInt(validated.royaltyBps),validated.salt]})
    : encodeFunctionData({abi:factoryAbi,functionName:"createERC1155",
      args:[validated.uri,validated.totalCap,validated.perIdCap,owner,BigInt(validated.royaltyBps),validated.salt]});
   const tx=await wallet.submitFactoryDeployment(factory,calldata);
   setTxHash(tx);setNotice("Transaction submitted. Waiting for Ultra Testnet confirmation; collection is NOT yet published.");
   const receipt=await rpc.waitForTransactionReceipt({hash:tx,confirmations:1,timeout:120000});
   if(receipt.status!=="success")throw Error("Ultra Testnet rejected the deployment transaction.");
   const [code,registered]=await Promise.all([
    rpc.getCode({address:expected}),
    rpc.readContract({address:factory,abi:factoryAbi,functionName:"isCollection",args:[expected]})
   ]);
   if(!code||code==="0x"||!registered)throw Error("Deployment transaction confirmed, but the predicted collection was not verified at the V3 factory.");
   setConfirmedAddress(expected);
   setManualAddress(expected);
   setNotice("Collection deployment confirmed at "+expected+". Before publishing, register it with the approved NFT indexer after its confirmation window.");
  }catch(e){setError(e instanceof Error?e.message:"Unable to confirm Ultra Testnet deployment.");}
  finally{setBusy(false);}
 }
 async function publishCollection(){
  if(!authorised)return;
  setError("");setNotice("");setBusy(true);
  try{
   inspect(form,wallet.address,salt);
   const address=(confirmedAddress||manualAddress).trim();
   if(!isAddress(address,{strict:false}))throw Error("Deploy a collection or enter an already verified collection contract address first.");
   await readAdmin(await fetch("/api/admin/collections",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({address,title:form.name.trim(),description:form.description.trim(),
      coverUrl:form.coverUrl.trim(),phaseId:"1"})
   }));
   await readAdmin(await fetch("/api/admin/collections",{
    method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({address,action:"publish"})
   }));
   setPublished(true);setNotice("The official collection preview is published. Minting remains disabled until separate on-chain phase configuration and release approval.");
  }catch(e){setError(e instanceof Error?e.message:"Publication was blocked.");}
  finally{setBusy(false);}
 }
 if(!wallet.authenticated || authorised===false)return <section className="operator-page">
  <Link href="/explore" className="curated-back">← NFT collections</Link>
  <p className="curated-overline">PRIVATE CREATE STUDIO</p><h1>Operator access required</h1>
  <p className="operator-note">{!wallet.authenticated?
   "Connect your wallet and sign in on Ultra EVM Testnet. Only the LookeNFT operator can create or publish collections.":
   "This account cannot access collection creation. Only the verified LookeNFT operator wallet is authorised."}</p>
  <Link className="inline-link" href="/explore">Return to official collections</Link>
 </section>;
 if(authorised===null)return <section className="operator-page" role="status">Verifying operator access…</section>;
 return <section className="operator-page operator-create-page">
  <Link className="curated-back" href="/admin">← Collection control</Link>
  <p className="curated-overline">OFFICIAL NFT STUDIO · ULTRA EVM TESTNET</p>
  <h1>Create an NFT collection</h1>
  <p>Design a drop, preview its appearance, deploy it with your own wallet approval, then publish its verified collection to the LookeNFT market. Public users cannot create NFTs.</p>
  <div className="creator-steps" aria-label="Creation stages"><span className={stage==="edit"?"active":""}>1. Collection details</span><span className={stage==="preview"?"active":""}>2. Preview</span><span>3. Publish to market</span></div>
  {stage==="edit"?<form className="operator-create-form" onSubmit={preview}>
   <div className="creator-fields">
    <label>Collection name<input required maxLength={90} value={form.name} onChange={e=>put("name",e.target.value)} placeholder="Ultra Punks"/></label>
    <label>NFT standard<select value={form.standard} onChange={e=>put("standard",e.target.value)}>
      <option value="erc721">ERC-721 · unique NFTs</option><option value="erc1155">ERC-1155 · editions</option>
    </select></label>
    {form.standard==="erc721"&&<label>Symbol<input required maxLength={15} value={form.symbol} onChange={e=>put("symbol",e.target.value)} placeholder="PUNKS"/></label>}
    <label>Total supply<input required type="number" min={1} max={1000000} step={1} value={form.totalCap} onChange={e=>put("totalCap",e.target.value)}/></label>
    {form.standard==="erc1155"&&<label>Copies per token ID<input required type="number" min={1} max={1000000} step={1} value={form.perIdCap} onChange={e=>put("perIdCap",e.target.value)}/></label>}
    <label>Planned mint price (UOS)<input required inputMode="decimal" value={form.mintPriceUos} onChange={e=>put("mintPriceUos",e.target.value)} placeholder="0"/></label>
    <label>Planned limit per wallet<input required type="number" min={1} max={1000} step={1} value={form.perWalletCap} onChange={e=>put("perWalletCap",e.target.value)}/></label>
    <label>Creator royalty (%)<input required inputMode="decimal" value={form.royaltyPercent} onChange={e=>put("royaltyPercent",e.target.value)} placeholder="0"/></label>
    <label>Approved cover image URL<input value={form.coverUrl} onChange={e=>put("coverUrl",e.target.value)} placeholder="https://approved-host.example/cover.png"/></label>
    <label className="creator-wide">Metadata URI {form.standard==="erc1155"?"(must contain {id})":"(base URI for your token metadata)"}
      <input required value={form.metadataUri} onChange={e=>put("metadataUri",e.target.value)}
       placeholder={form.standard==="erc721"?"ipfs://your-cid/":"ipfs://your-cid/{id}.json"}/></label>
    <label className="creator-wide">Description<textarea rows={4} maxLength={1200} value={form.description} onChange={e=>put("description",e.target.value)} placeholder="Tell collectors about this drop…"/></label>
   </div>
   <p className="operator-note">The artwork and token metadata must be genuinely hosted before deployment. Mint price and per-wallet limits are plans only: a separately wallet-approved on-chain mint phase is required to make them enforceable. Previewing does not mint or charge anybody.</p>
   <button type="submit">Preview collection →</button>
  </form>:<>
   <div className="creator-preview">
    <div className="creator-preview-image">{form.coverUrl?<img src={form.coverUrl} alt="Draft collection cover"/>:<span>◇<small>Cover image not set</small></span>}</div>
    <div className="creator-preview-info"><p className="curated-overline">UNPUBLISHED DRAFT · PREVIEW ONLY</p>
     <h2>{form.name}</h2><p>{form.description||"No description yet."}</p>
     <div className="creator-preview-stats"><span>Network<strong>Ultra EVM Testnet</strong></span><span>Standard<strong>{form.standard.toUpperCase()}</strong></span><span>Supply<strong>{form.totalCap}</strong></span><span>Planned mint price<strong>{form.mintPriceUos} UOS</strong></span><span>Per wallet (planned)<strong>{form.perWalletCap}</strong></span><span>Royalty<strong>{form.royaltyPercent}%</strong></span></div>
    </div>
   </div>
   <div className="creator-review-actions"><button type="button" className="creator-secondary" disabled={busy} onClick={()=>setStage("edit")}>← Edit details</button></div>
   <div className="creator-publish-panel">
    <h2>Deploy to Ultra Testnet</h2>
    <p>Only your authorised wallet can approve a transaction from the owner-only V3 factory. NFT creation on Ultra is a separate blockchain transaction, not the same as publishing a catalogue card.</p>
    <button type="button" disabled={busy||!deployAllowed||!!confirmedAddress} onClick={()=>void deploy()}>{busy?"Processing…":confirmedAddress?"Deployment verified ✓":"Deploy collection (wallet approval)"}</button>
    {!deployAllowed&&<p className="operator-note">On-chain deployment is currently locked until the V3 factory is deployed and verified and the independent M4 security gates are enabled. The editor and preview remain available.</p>}
    {txHash&&<p className="creator-break">Transaction: <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+txHash} target="_blank" rel="noopener noreferrer">{txHash}</a></p>}
    {confirmedAddress&&<p className="creator-break">Verified collection address: <strong>{confirmedAddress}</strong></p>}
   </div>
   <div className="creator-publish-panel">
    <h2>Publish official preview to the market</h2>
    <p>After deployment, the collection must pass indexer registration, owner and V3 factory verification. Publishing makes its preview visible on the homepage gallery; it does not turn on minting.</p>
    <label>Verified collection contract address<input value={confirmedAddress||manualAddress} onChange={e=>{setManualAddress(e.target.value);setPublished(false);}} placeholder="0x…"/></label>
    <button type="button" disabled={busy||published||!(confirmedAddress||manualAddress)} onClick={()=>void publishCollection()}>{published?"Published ✓":busy?"Publishing…":"Publish to LookeNFT market"}</button>
    {published&&<p><Link className="inline-link" href={"/collection/"+encodeURIComponent((confirmedAddress||manualAddress).trim())}>Open public collection preview ↗</Link></p>}
    <p className="operator-note">Minting remains closed until a valid priced phase is scheduled on-chain and M5/M12 financial execution has been independently approved. The price above is not a live on-chain quote.</p>
   </div>
  </>}
  {notice&&<p role="status" className="operator-note">{notice}</p>}
  {error&&<p role="alert" className="operator-error">{error}</p>}
 </section>;
}
