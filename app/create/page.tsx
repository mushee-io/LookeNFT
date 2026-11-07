"use client";
import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { createPublicClient, encodeDeployData, encodeFunctionData, getAddress, http, isAddress, parseAbi, parseEther, toHex, type Hex } from "viem";
import { useWalletSession } from "@/components/WalletSessionProvider";
import { ULTRA_TESTNET } from "@/lib/network";
import { previewMetadata } from "@/lib/m4/preview";
import {validateCollectionDraft,type CollectionDraft} from "@/lib/m4/factory";
import {isSuccessfulDirectCreation} from "@/lib/testnet/direct-creation";

type Standard="erc721"|"erc1155";
type Form={
 standard:Standard;name:string;symbol:string;description:string;coverUrl:string;
 metadataUri:string;totalCap:string;perIdCap:string;mintPriceUos:string;traits:string;
 perWalletCap:string;royaltyPercent:string;
};
const defaults:Form={
 standard:"erc721",name:"",symbol:"",description:"",coverUrl:"",
 metadataUri:"",totalCap:"10",perIdCap:"1",mintPriceUos:"0",traits:"",
 perWalletCap:"3",royaltyPercent:"0"
};
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
const erc721Constructor=parseAbi(["constructor(string name_,string symbol_,string baseURI_,uint256 maxSupply_,address creator_,address royaltyReceiver_,uint96 royaltyBps_)"]);
const erc1155Constructor=parseAbi(["constructor(string uriTemplate_,uint256 totalCap_,uint256 perIdCap_,address creator_,address royaltyReceiver_,uint96 royaltyBps_)"]);
const nftOwnershipAbi=parseAbi(["function owner() view returns (address)","function supportsInterface(bytes4) view returns (bool)"]);
const erc721DetailsAbi=parseAbi(["function name() view returns (string)","function symbol() view returns (string)","function baseTokenURI() view returns (string)","function maxSupply() view returns (uint256)"]);
const mint721Abi=parseAbi(["function mintReserved(address recipient) returns (uint256)","function ownerOf(uint256) view returns (address)"]);
const mint1155Abi=parseAbi(["function mintReserved(address recipient,uint256 tokenId,uint256 quantity)","function balanceOf(address,uint256) view returns (uint256)"]);

function inspect(form:Form,wallet:string|null,salt:string){
 if(!wallet||!isAddress(wallet,{strict:false}))throw Error("Connect and sign in with an Ultra EVM Testnet wallet.");
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
 const [form,setForm]=useState<Form>(defaults);
 const [salt,setSalt]=useState("");
 const [stage,setStage]=useState<"edit"|"preview">("edit");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [txHash,setTxHash]=useState<Hex|null>(null);
 const [recoverHash,setRecoverHash]=useState("");
 const [confirmedAddress,setConfirmedAddress]=useState("");
 const [published,setPublished]=useState(false);
 const [mintedTxHash,setMintedTxHash]=useState<Hex|null>(null);
 const [localArtwork,setLocalArtwork]=useState<string|null>(null);
 const [selectedFile,setSelectedFile]=useState(false);
 const [artworkCount,setArtworkCount]=useState(0);

 useEffect(()=>{
  const random=new Uint8Array(32);window.crypto.getRandomValues(random);setSalt(toHex(random));
 },[]);
 useEffect(()=>()=>{if(localArtwork)URL.revokeObjectURL(localArtwork);},[localArtwork]);
 useEffect(()=>{
  const supplied=new URLSearchParams(window.location.search).get("recover");
  if(supplied&&/^0x[0-9a-fA-F]{64}$/.test(supplied))setRecoverHash(supplied);
 },[]);
 const eligible=wallet.chainId===18881 && !!wallet.address;
 const canList=eligible && wallet.authenticated;

 const put=(key:keyof Form,value:string)=>{
  setForm(old=>({...old,[key]:value,...(key==="totalCap"&&old.standard==="erc1155"?{perIdCap:value}:{})}));
  // Description and cover artwork are off-chain catalogue metadata: editing
  // them must NOT erase the already-confirmed NFT contract or its tx hash.
  const changesImmutableContract=["standard","name","symbol","metadataUri","totalCap","perIdCap","royaltyPercent"].includes(key);
  if(changesImmutableContract){
   setConfirmedAddress("");setTxHash(null);setPublished(false);setMintedTxHash(null);
  }
  setError("");setNotice("");
 };
 function preview(event:FormEvent){
  event.preventDefault();setError("");setNotice("");
  try{previewMetadata(form,Boolean(localArtwork));setStage("preview");window.scrollTo({top:0,behavior:"smooth"});}
  catch(e){setError(e instanceof Error?e.message:"Invalid collection settings.");}
 }
 async function verifyExistingDeployment(hash:Hex){
  const [chain,receipt,transaction]=await Promise.all([
    rpc.getChainId(),
    rpc.getTransactionReceipt({hash}),
    rpc.getTransaction({hash})
  ]);
  if(chain!==18881)throw Error("Only Ultra EVM Testnet deployments can be recovered.");
  // Ultra's receipt.to is the ZERO ADDRESS for valid contract creations.
  // transaction.to is null and receipt.contractAddress holds the real contract.
  if(!isSuccessfulDirectCreation(transaction,receipt))
    throw Error(receipt.status==="reverted"
      ?"This deployment failed on-chain. No NFT contract was created."
      :"The transaction is not a successful direct NFT contract deployment.");
  if(!wallet.address||transaction.from.toLowerCase()!==wallet.address.toLowerCase()||
     receipt.from.toLowerCase()!==wallet.address.toLowerCase())
    throw Error("Connect the wallet that signed this NFT deployment: "+transaction.from);
  const address=receipt.contractAddress!;
  const [code,owner,is721,is1155]=await Promise.all([
    rpc.getCode({address}),
    rpc.readContract({address,abi:nftOwnershipAbi,functionName:"owner"}),
    rpc.readContract({address,abi:nftOwnershipAbi,functionName:"supportsInterface",args:["0x80ac58cd"]}),
    rpc.readContract({address,abi:nftOwnershipAbi,functionName:"supportsInterface",args:["0xd9b67a26"]})
  ]);
  if(!code||code==="0x"||owner.toLowerCase()!==wallet.address.toLowerCase()||(!is721&&!is1155))
    throw Error("The transaction succeeded, but deployed NFT bytecode, ownership or interface could not be verified.");
  const standard:Standard=is721?"erc721":"erc1155";
  // Populate the original immutable ERC-721 collection details directly from
  // the contract. This lets the creator recover, add a cover/description and
  // list without signing or paying for another deployment.
  if(is721){
   try{
    const [name,symbol,baseURI,maxSupply]=await Promise.all([
     rpc.readContract({address,abi:erc721DetailsAbi,functionName:"name"}),
     rpc.readContract({address,abi:erc721DetailsAbi,functionName:"symbol"}),
     rpc.readContract({address,abi:erc721DetailsAbi,functionName:"baseTokenURI"}),
     rpc.readContract({address,abi:erc721DetailsAbi,functionName:"maxSupply"})
    ]);
    setForm(old=>({...old,standard,name,symbol,metadataUri:baseURI,totalCap:maxSupply.toString(),
      perWalletCap:String(Math.max(1,Math.min(Number(maxSupply),Number(old.perWalletCap)||1)))}));
   }catch{setForm(old=>({...old,standard}));}
  }else setForm(old=>({...old,standard}));
  setConfirmedAddress(address);
  setTxHash(hash);
  setRecoverHash(hash);
  setNotice("Your existing "+standard.toUpperCase()+" contract is confirmed on Ultra EVM Testnet. Do not redeploy it. You can mint NFT #1 with your wallet.");
  return address;
 }
 async function recoverDeployment(){
  if(!eligible){setError("Connect the original Ultra EVM Testnet creator wallet first.");return;}
  if(!/^0x[0-9a-fA-F]{64}$/.test(recoverHash)){
    setError("Enter the 66-character transaction hash from your original deployment.");return;
  }
  setBusy(true);setError("");setNotice("");
  try{await verifyExistingDeployment(recoverHash as Hex);}
  catch(e){setError(e instanceof Error?e.message:"Existing deployment verification failed.");}
  finally{setBusy(false);}
 }
 async function deploy(){
  if(!eligible){setError("Connect your wallet to Ultra EVM Testnet to create an NFT.");return;}
  setError("");setNotice("");setBusy(true);
  try{
   const {validated}=inspect(form,wallet.address,salt);
   // A versioned path and no-store are essential: the previous force-cache
   // could return Cancun bytecode from an older deployment after an update.
   const filename=validated.standard==="erc721"?"create-erc721-paris-v1.json":"create-erc1155-paris-v1.json";
   const response=await fetch("/contracts/"+filename,{cache:"no-store"});
   if(!response.ok)throw Error("NFT contract artifact unavailable (HTTP "+response.status+"). Reload LookeNFT and try again.");
   const artifact=await response.json() as {standard?:string;chainId?:number;evmVersion?:string;bytecode?:string};
   if(artifact.chainId!==18881)throw Error("NFT bytecode chain mismatch: expected Ultra Testnet 18881, got "+String(artifact.chainId));
   if(artifact.standard!==validated.standard)throw Error("NFT bytecode standard mismatch: expected "+validated.standard+", got "+String(artifact.standard));
   if(artifact.evmVersion!=="paris")throw Error("Stale NFT bytecode: expected Paris, got "+String(artifact.evmVersion)+". Refresh the page.");
   if(!/^0x[0-9a-fA-F]{200,500000}$/.test(artifact.bytecode||""))
     throw Error("Invalid NFT contract bytecode: expected complete deployment hex data.");
   const owner=getAddress(wallet.address!);
   const bytecode=artifact.bytecode as Hex;
   const calldata=validated.standard==="erc721"
    ?encodeDeployData({abi:erc721Constructor,bytecode,args:[validated.name,validated.symbol,validated.uri,validated.totalCap,owner,owner,BigInt(validated.royaltyBps)]})
    :encodeDeployData({abi:erc1155Constructor,bytecode,args:[validated.uri,validated.totalCap,validated.perIdCap,owner,owner,BigInt(validated.royaltyBps)]});
   const tx=await wallet.submitDirectNFTDeployment(calldata);
   setTxHash(tx);
   setRecoverHash(tx);
   setNotice("Creation submitted from your wallet. Confirming your NFT contract on Ultra EVM Testnet.");
   await rpc.waitForTransactionReceipt({hash:tx,confirmations:1,timeout:120000});
   await verifyExistingDeployment(tx);
  }catch(e){setError(e instanceof Error?e.message:"Unable to deploy Testnet NFT.");}
  finally{setBusy(false);}
 }
 async function mintFirstNFT(){
  if(!eligible||!confirmedAddress){setError("Connect your Testnet wallet and deploy a collection first.");return;}
  setError("");setBusy(true);
  try{
   const creator=getAddress(wallet.address!);
   const contract=getAddress(confirmedAddress);
   const owner=await rpc.readContract({address:contract,abi:nftOwnershipAbi,functionName:"owner"});
   if(owner.toLowerCase()!==creator.toLowerCase())throw Error("Only the owner can mint from their new collection.");
   const calldata=form.standard==="erc721"
    ?encodeFunctionData({abi:mint721Abi,functionName:"mintReserved",args:[creator]})
    :encodeFunctionData({abi:mint1155Abi,functionName:"mintReserved",args:[creator,1n,1n]});
   const tx=await wallet.submitCreatorReserveMint(contract,calldata);
   const receipt=await rpc.waitForTransactionReceipt({hash:tx,confirmations:1,timeout:120000});
   if(receipt.status!=="success")throw Error("The NFT mint transaction was unsuccessful.");
   if(form.standard==="erc721"){
    const tokenOwner=await rpc.readContract({address:contract,abi:mint721Abi,functionName:"ownerOf",args:[1n]});
    if(tokenOwner.toLowerCase()!==creator.toLowerCase())throw Error("Mint confirmed, but NFT #1 ownership is unverified.");
   }else{
    const balance=await rpc.readContract({address:contract,abi:mint1155Abi,functionName:"balanceOf",args:[creator,1n]});
    if(balance<1n)throw Error("Mint confirmed, but NFT #1 balance is unverified.");
   }
   setMintedTxHash(tx);
   setNotice("NFT #1 has been minted to your wallet on Ultra EVM Testnet. No platform fee was charged.");
  }catch(e){setError(e instanceof Error?e.message:"Unable to mint NFT.");}
  finally{setBusy(false);}
 }
 async function publishCollection(){
  if(!canList){setError("Sign in with your connected Testnet wallet to list the collection.");return;}
  setError("");setNotice("");setBusy(true);
  try {
   inspect(form,wallet.address,salt);
   if(!confirmedAddress||!txHash)throw Error("Deploy this collection with your own wallet first.");
   if(selectedFile&&!form.coverUrl.trim())throw Error("Upload your cover artwork to HTTPS storage and enter its URL before listing.");
   const response=await fetch("/api/creator/collections",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({address:confirmedAddress,txHash,standard:form.standard,
      title:form.name.trim(),description:form.description.trim(),coverUrl:form.coverUrl.trim()})
   });
   await readAdmin(response);
   setPublished(true);
   setNotice("Your creator-owned Ultra Testnet collection is listed. Public minting remains disabled.");
  }catch(e){setError(e instanceof Error?e.message:"Unable to register collection.");}
  finally{setBusy(false);}
 }
 const design=stage==="preview"?previewMetadata(form,Boolean(localArtwork)):null;
 return <section className="operator-page operator-create-page">
  <Link className="curated-back" href="/explore">← NFT collections</Link>
  <p className="curated-overline">COMMUNITY NFT STUDIO · ULTRA EVM TESTNET</p>
  <h1>Create an NFT collection</h1>
  <div className="gen-studio-link">
    <div><strong>Want 10,000 different characters?</strong><p>Upload transparent face, hair, eyes and accessory layers; choose rarity weights; generate unique NFT artwork and metadata.</p></div>
    <Link className="gen-studio-open" href="/create/generative">Open Generative Art Studio ↗</Link>
  </div>
  <p>Anyone can deploy an NFT directly from their wallet on Ultra EVM Testnet. No LookeNFT admin key or creation fee. Only ordinary Testnet gas is needed; every transaction requires your wallet approval.</p>
  {!eligible&&<p className="operator-note"><strong>Connect any wallet to Ultra EVM Testnet to deploy.</strong> Sign in only if you want to list the collection in LookeNFT.</p>}
  <div className="creator-publish-panel">
   <h2>Already deployed? Recover your NFT contract</h2>
   <p>If Ultra confirmed your transaction but LookeNFT showed an error, verify your existing contract here. This is read-only and costs no gas. Do not redeploy.</p>
   <label>Existing deployment transaction hash
    <input value={recoverHash} onChange={e=>setRecoverHash(e.target.value.trim())}
     placeholder="0x… your original NFT deployment transaction" spellCheck={false} />
   </label>
   <button type="button" disabled={busy||!eligible||!/^0x[0-9a-fA-F]{64}$/.test(recoverHash)}
    onClick={()=>void recoverDeployment()}>{busy?"Checking existing transaction…":"Recover existing deployment (no gas)"}</button>
   {!eligible&&<p className="operator-note">Connect the same Ultra EVM Testnet wallet used for the original deployment.</p>}
   {confirmedAddress&&<p className="creator-break">Verified existing NFT contract: <strong>{confirmedAddress}</strong></p>}
   {confirmedAddress&&<button type="button" disabled={busy||!!mintedTxHash}
    onClick={()=>void mintFirstNFT()}>{mintedTxHash?"NFT #1 minted ✓":"Mint NFT #1 to my wallet (wallet approval)"}</button>}
  </div>
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
    <label>Upload artwork for local preview<input type="file" accept="image/png,image/jpeg,image/webp" multiple
      onChange={e=>{
       const files=Array.from(e.target.files||[]);
        if(!files.length){setLocalArtwork(null);setSelectedFile(false);setArtworkCount(0);return;}
        if(files.length>20||files.some(file=>!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>10*1024*1024)){
          setError("Choose up to 20 PNG, JPEG or WebP images, each under 10 MB.");e.target.value="";return;
        }
        setLocalArtwork(URL.createObjectURL(files[0]));setSelectedFile(true);setArtworkCount(files.length);setError("");
      }}/></label>
    {artworkCount>0&&<p className="creator-wide operator-note">{artworkCount} artwork file{artworkCount===1?"":"s"} selected for local preview. Nothing has been uploaded to NFT storage.</p>}
     <label>Approved cover image URL<input value={form.coverUrl} onChange={e=>put("coverUrl",e.target.value)} placeholder="https://approved-host.example/cover.png"/></label>
    <label className="creator-wide">Metadata URI (optional for preview; required before deployment) {form.standard==="erc1155"?"(must contain {id})":"(base URI for your token metadata)"}
      <input value={form.metadataUri} onChange={e=>put("metadataUri",e.target.value)}
       placeholder={form.standard==="erc721"?"ipfs://your-cid/":"ipfs://your-cid/{id}.json"}/></label>
    <label className="creator-wide">Description<textarea rows={4} maxLength={1200} value={form.description} onChange={e=>put("description",e.target.value)} placeholder="Tell collectors about this drop…"/></label>
     <label className="creator-wide">Traits (optional, one Name: Value per line)<textarea rows={4} value={form.traits} onChange={e=>put("traits",e.target.value)} placeholder="Background: Pink"/></label>
   </div>
   <p className="operator-note"><strong>Preview is not a deployment.</strong> Choose ERC-721 for unique art or ERC-1155 for editions. Images selected here are only local previews. Hosted metadata and explicit wallet approval are required for a real Testnet transaction.</p>
   <button type="submit">Preview collection →</button>
  </form>:<>
   <div className="creator-preview">
    <div className="creator-preview-image">{(localArtwork||form.coverUrl)?<img src={localArtwork||form.coverUrl} alt="Draft collection cover"/>:<span>◇<small>Cover image not set</small></span>}</div>
    <div className="creator-preview-info"><p className="curated-overline">UNPUBLISHED DRAFT · PREVIEW ONLY</p>
     <h2>{form.name}</h2><p>{form.description||"No description yet."}</p>
     <div className="creator-preview-stats"><span>Network<strong>Ultra EVM Testnet</strong></span><span>Standard<strong>{form.standard.toUpperCase()}</strong></span><span>Planned supply<strong>{Number(form.totalCap).toLocaleString()}</strong></span><span>Planned mint price<strong>{form.mintPriceUos} UOS</strong></span><span>Per wallet (planned)<strong>{form.perWalletCap}</strong></span><span>Royalty<strong>{form.royaltyPercent}%</strong></span><span>Rarity<strong>{design?.rarity}</strong></span></div>
    </div>
   </div>
   <div className="creator-publish-panel"><h2>Automatically prepared NFT metadata</h2>
     <p>An illustrative metadata record generated from your artwork and attributes. It is not a hosted token, minted inventory or verified rarity ranking.</p>
     <pre className="creator-json">{JSON.stringify(design?.metadata,null,2)}</pre>
     <button type="button" className="creator-secondary" onClick={()=>{void navigator.clipboard.writeText(JSON.stringify(design?.metadata,null,2));}}>Copy example metadata JSON</button>
    </div>
    <div className="creator-review-actions"><button type="button" className="creator-secondary" disabled={busy} onClick={()=>setStage("edit")}>← Edit details</button></div>
   <div className="creator-publish-panel">
    <h2>Create your NFT on Ultra EVM Testnet</h2>
    <p>Open to every Testnet wallet. Deploy your own ERC-721 or ERC-1155 contract without a factory, an admin key, or a LookeNFT creation fee.</p>
    <button type="button" disabled={busy||!eligible||!!confirmedAddress||!!txHash} onClick={()=>void deploy()}>{busy?"Processing…":confirmedAddress?"Deployment verified ✓":"Deploy collection (wallet approval)"}</button>
    {!eligible&&<p className="operator-note">Connect any wallet on Ultra EVM Testnet to create an NFT.</p>}
    {txHash&&!confirmedAddress&&<p className="operator-note">A deployment transaction was already submitted. Recover and verify it above before considering any new deployment; do not pay Testnet gas twice.</p>}
    {txHash&&<p className="creator-break">Transaction: <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+txHash} target="_blank" rel="noopener noreferrer">{txHash}</a></p>}
    {confirmedAddress&&<p className="creator-break">Your NFT contract: <strong>{confirmedAddress}</strong></p>}
    {confirmedAddress&&<button type="button" disabled={busy||!!mintedTxHash} onClick={()=>void mintFirstNFT()}>
      {mintedTxHash?"NFT #1 minted ✓":"Mint NFT #1 to my wallet (free)"}
    </button>}
    {mintedTxHash&&<p className="creator-break">Mint transaction: <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+mintedTxHash} target="_blank" rel="noopener noreferrer">{mintedTxHash}</a></p>}
   </div>
   <div className="creator-publish-panel">
    <h2>List your verified Testnet collection</h2>
    <p>Sign in with the wallet that deployed the contract to list it on LookeNFT. The site checks the confirmed transaction, NFT ownership and standard. Public paid minting remains disabled.</p>
    <button type="button" disabled={busy||published||!canList||!txHash||!confirmedAddress} onClick={()=>void publishCollection()}>{published?"Listed ✓":busy?"Checking…":"List Testnet collection"}</button>
    {published&&<p><Link className="inline-link" href={"/collection/"+encodeURIComponent(confirmedAddress)}>Open collection preview ↗</Link></p>}
    {!canList&&<p className="operator-note">Use the connected wallet's Sign in action to list your collection. No admin approval is needed.</p>}
    <p className="operator-note">Creator NFT minting is free except Testnet gas. Trading, public paid minting and mainnet remain off.</p>
   </div>
  </>}
  {notice&&<p role="status" className="operator-note">{notice}</p>}
  {error&&<p role="alert" className="operator-error">{error}</p>}
 </section>;
}
