"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { generatePlan, tokenMetadata, type TraitLayer, type GenerationPlan } from "@/lib/generative/engine";
import { utf8, zipStore, type ArchiveEntry } from "@/lib/generative/zip";

type ArtworkVariant = { id:string; name:string;weight:number;src:string;file:File };
type ArtworkLayer = { id:string;name:string;variants:ArtworkVariant[] };
type PreviewCard = { tokenId:number;url:string;rank:number;traits:string[] };
const MAX_LAYERS=12, MAX_FILES=200, MAX_PREVIEW=8;
const SIZE=512;

function uid():string {
 return window.crypto.randomUUID();
}
function cleanName(filename:string):string {
 return filename.replace(/\.png$/i,"").replace(/[_-]+/g," ").trim().slice(0,64)||"Untitled trait";
}
function labelError(e:unknown):string {
 return e instanceof Error?e.message:"Unable to prepare generated artwork.";
}
function download(blob:Blob,name:string) {
 const url=URL.createObjectURL(blob),link=document.createElement("a");
 link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function jsonBytes(obj:unknown):Uint8Array {
 return utf8(JSON.stringify(obj,null,2)+"\n");
}
function padded(n:number):string{return String(n).padStart(5,"0");}
function readImage(url:string,cache:Map<string,Promise<HTMLImageElement>>):Promise<HTMLImageElement> {
 const cached=cache.get(url);if(cached)return cached;
 const value=new Promise<HTMLImageElement>((resolve,reject)=>{
  const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error("Could not decode one of your PNG layer images."));image.src=url;
 });
 cache.set(url,value);return value;
}
async function paint(layers:ArtworkLayer[],plan:GenerationPlan,index:number,cache:Map<string,Promise<HTMLImageElement>>):Promise<HTMLCanvasElement>{
 const canvas=document.createElement("canvas");canvas.width=SIZE;canvas.height=SIZE;
 const ctx=canvas.getContext("2d",{alpha:true});
 if(!ctx)throw Error("Your browser does not support 2D canvas generation.");
 ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,SIZE,SIZE);
 const token=plan.tokens[index];
 for(let i=0;i<layers.length;i++){
  const variant=layers[i].variants[token.picks[i]];
  const image=await readImage(variant.src,cache);
  ctx.drawImage(image,0,0,SIZE,SIZE);
 }
 return canvas;
}
async function pngBytes(canvas:HTMLCanvasElement):Promise<Uint8Array>{
 const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
 if(!blob)throw Error("Unable to encode PNG artwork.");
 return new Uint8Array(await blob.arrayBuffer());
}
function manifest(layers:ArtworkLayer[],plan:GenerationPlan,name:string,description:string){
 return {
  collection:name,description,format:"LookeNFT generative offline preview",
  standard:"ERC-721 (proposed)",network:"Ultra EVM (not deployed)",
  supply:plan.supply,seed:plan.seed,possibleCombinations:plan.capacity,
  exportImageSize:SIZE,
  generatedOnChain:false,hostedOnIPFS:false,
  rarityRanking:"Observed-trait statistical rarity for this generated sample, not an official marketplace rank.",
  layers:layers.map((layer,i)=>({
   name:layer.name,variants:layer.variants.map((v,j)=>({
    name:v.name,weight:v.weight,generatedCount:plan.counts[i][j],
    frequencyPercent:Math.round(plan.counts[i][j]/plan.supply*10000)/100
   }))
  }))
 };
}
const help = "Local-only creation. No wallet signatures, network uploads, deployment or NFT minting occur here.";

export default function GenerativeArtPage() {
 const [name,setName]=useState("Ultra Punks");
 const [description,setDescription]=useState("A 10,000-character collection on Ultra EVM");
 const [supply,setSupply]=useState(10000);
 const [seed,setSeed]=useState("looke-punks-genesis-2026");
 const [layers,setLayers]=useState<ArtworkLayer[]>([]);
 const [plan,setPlan]=useState<GenerationPlan|null>(null);
 const [previews,setPreviews]=useState<PreviewCard[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [cursor,setCursor]=useState(0);
 const [batchSize,setBatchSize]=useState(50);
 const [processed,setProcessed]=useState(0);
 const cache=useRef(new Map<string,Promise<HTMLImageElement>>());
 const layersRef=useRef<ArtworkLayer[]>([]);
 const busyRef=useRef(false);
 useEffect(()=>{layersRef.current=layers;},[layers]);
 useEffect(()=>()=>{for(const layer of layersRef.current)for(const asset of layer.variants)URL.revokeObjectURL(asset.src);},[]);
 function invalidate() {
  setPlan(null);setPreviews([]);setCursor(0);setProcessed(0);setError("");setMessage("");
 }
 function revise(next:ArtworkLayer[]) {if(busyRef.current)return;setLayers(next);invalidate();}
 function addLayer(title?:string) {
  if(layers.length>=MAX_LAYERS)return;
  revise([...layers,{id:uid(),name:title||"Layer "+(layers.length+1),variants:[]}]);
 }
 function starterLayers(){
  if(layers.length)return;
  revise(["Background","Face","Eyes","Headwear"].map(name=>({id:uid(),name,variants:[]})));
 }
 function removeLayer(id:string){
  const which=layers.find(x=>x.id===id);
  if(which)for(const v of which.variants){URL.revokeObjectURL(v.src);cache.current.delete(v.src);}
  revise(layers.filter(x=>x.id!==id));
 }
 function moveLayer(id:string,step:number){
  const i=layers.findIndex(x=>x.id===id),next=[...layers];
  const dest=i+step;if(i<0||dest<0||dest>=layers.length)return;
  [next[i],next[dest]]=[next[dest],next[i]];revise(next);
 }
 function updateLayer(id:string,value:string){
  revise(layers.map(x=>x.id===id?{...x,name:value.slice(0,48)}:x));
 }
 function addImages(id:string,event:ChangeEvent<HTMLInputElement>){
  const incoming=Array.from(event.target.files||[]);
  event.target.value="";
  if(!incoming.length)return;
  const totalFiles=layers.reduce((acc,l)=>acc+l.variants.length,0);
  const target=layers.find(x=>x.id===id);
  if(!target)return;
  if(incoming.length+target.variants.length>60 || totalFiles+incoming.length>MAX_FILES){
   setError("Maximum 60 PNG variations per layer and 200 images total.");return;
  }
  if(incoming.some(file=>file.type!=="image/png"||file.size>8*1024*1024||!file.size)){
   setError("Upload transparent PNG images, up to 8 MB each. Other formats cannot be layered.");return;
  }
  const taken=new Set(target.variants.map(x=>x.name.toLowerCase()));
  const additional:ArtworkVariant[]=incoming.map(file=>{
   let label=cleanName(file.name),candidate=label,index=2;
   while(taken.has(candidate.toLowerCase())){
    candidate=(label.slice(0,54)+" "+index++).slice(0,64);
   }
   taken.add(candidate.toLowerCase());
   return{id:uid(),name:candidate,weight:10,src:URL.createObjectURL(file),file};
  });
  revise(layers.map(x=>x.id===id?{...x,variants:[...x.variants,...additional]}:x));
 }
 function updateVariant(layerId:string,variantId:string,key:"name"|"weight",value:string){
  revise(layers.map(layer=>layer.id===layerId?{...layer,variants:layer.variants.map(v=>
   v.id===variantId?{...v,[key]:key==="weight"?(value===""?0:Number(value)):value.slice(0,64)}:v
  )}:layer));
 }
 function removeVariant(layerId:string,variantId:string){
  const variant=layers.find(l=>l.id===layerId)?.variants.find(v=>v.id===variantId);
  if(variant){URL.revokeObjectURL(variant.src);cache.current.delete(variant.src);}
  revise(layers.map(l=>l.id===layerId?{...l,variants:l.variants.filter(v=>v.id!==variantId)}:l));
 }
 async function prepare(){
  if(busyRef.current)return;
  busyRef.current=true;setBusy(true);setError("");setMessage("");setProcessed(0);
  try{
   if(name.trim().length<2||name.length>80)throw Error("Enter a collection name (2–80 characters).");
   if(description.length>1200)throw Error("Description cannot exceed 1,200 characters.");
   const next=generatePlan(layers as TraitLayer[],supply,seed);
   const samples:PreviewCard[]=[];
   const imageCache=cache.current;
   for(let i=0;i<Math.min(MAX_PREVIEW,next.tokens.length);i++){
    const canvas=await paint(layers,next,i,imageCache);
    samples.push({
     tokenId:next.tokens[i].tokenId,url:canvas.toDataURL("image/png"),
     rank:next.ranks[i],traits:layers.map((layer,j)=>layer.variants[next.tokens[i].picks[j]].name)
    });
   }
   setPlan(next);setPreviews(samples);
   setMessage("Generated "+next.tokens.length.toLocaleString()+" reproducible, unique trait combinations. Artwork for the first eight NFTs is previewed; export produces the actual remaining PNGs in batches.");
  }catch(e){setError(labelError(e));setPlan(null);}
  finally{busyRef.current=false;setBusy(false);}
 }
 async function exportBatch(){
  if(busyRef.current||!plan||cursor>=plan.supply)return;
  busyRef.current=true;setBusy(true);setError("");setMessage("");setProcessed(0);
  try{
   const end=Math.min(cursor+batchSize,plan.supply);
   const entries:ArchiveEntry[]=[
    {name:"README.txt",bytes:utf8(
     "LookeNFT OFFLINE GENERATIVE ART EXPORT\n"+
     "Tokens "+(cursor+1)+" through "+end+" of "+plan.supply+".\n"+
     "Artwork and metadata have not been published or minted on any chain.\n"+
     "Upload the images to your trusted NFT asset storage provider. Replace "+
     "REPLACE_WITH_REAL_IMAGES_CID in every metadata image URI with the real "+
     "pinned images CID, then pin the metadata directory. The existing Ultra ERC-721 contract uses base URI + numeric token ID, so each metadata filename has NO extension (for example metadata/1). Verify all mappings "+
     "before using the metadata base URI in a wallet-approved NFT deployment.\n"+
     "Trait rank and price are NOT on-chain, and no financial operation occurred.\n"
    )},
    {name:"manifest.json",bytes:jsonBytes(manifest(layers,plan,name,description))}
   ];
   for(let i=cursor;i<end;i++){
    const filename=padded(plan.tokens[i].tokenId);
    const canvas=await paint(layers,plan,i,cache.current);
    entries.push({name:"images/"+filename+".png",bytes:await pngBytes(canvas)});
    entries.push({name:"metadata/"+String(plan.tokens[i].tokenId),bytes:jsonBytes(tokenMetadata(name,description,layers,plan,i))});
    setProcessed(i-cursor+1);
    if((i-cursor+1)%8===0)await new Promise<void>(resolve=>window.setTimeout(resolve,0));
   }
   const archive=zipStore(entries);
   download(archive,"lookenft-"+padded(cursor+1)+"-"+padded(end)+".zip");
   setCursor(end);
   setMessage("Downloaded image/metadata ZIP for tokens "+(cursor+1)+"–"+end+". Continue with the next batch; the original collection seed stays unchanged.");
  }catch(e){setError(labelError(e));}
  finally{busyRef.current=false;setBusy(false);}
 }
 function exportAllMetadata(){
  if(!plan||busyRef.current)return;
  try{
   const entries:ArchiveEntry[]=[{name:"manifest.json",bytes:jsonBytes(manifest(layers,plan,name,description))}];
   for(let i=0;i<plan.supply;i++){
    entries.push({name:"metadata/"+String(i+1),bytes:jsonBytes(tokenMetadata(name,description,layers,plan,i))});
   }
   download(zipStore(entries),"lookenft-all-"+plan.supply+"-metadata.zip");
   setMessage("Metadata ZIP downloaded. Its image URLs still contain placeholders until you host the real generated images.");
  }catch(e){setError(labelError(e));}
 }
 function resetExport(){if(!busyRef.current){setCursor(0);setProcessed(0);setMessage("Export progress reset; regenerate identical image ZIP batches using the saved seed.");}}
 return <section className="operator-page gen-page">
  <Link className="curated-back" href="/create">← Back to Create studio</Link>
  <p className="curated-overline">GENERATIVE ART LAB · OFFLINE PREVIEW</p>
  <h1>Generate your own <span>10,000 Punks.</span></h1>
  <p>Upload PNG layers, choose how common each trait should be, and generate genuinely distinct character combinations. Preview rarity, then download the artwork and NFT metadata. Everything runs locally in your browser.</p>
  <p className="operator-note">{help} Publishing still requires the designated LookeNFT operator, verified metadata and a separately authorised Ultra deployment.</p>

  <section className="gen-panel" aria-label="Collection setup">
   <div className="gen-section-head"><div><span className="gen-step">01</span><h2>Collection settings</h2></div><span className="gen-hint">ERC-721 · Unique artwork</span></div>
   <div className="gen-fields">
    <label>Collection name<input value={name} maxLength={80} onChange={e=>{setName(e.target.value);invalidate();}} placeholder="Ultra Punks" disabled={busy}/></label>
    <label>Total unique NFTs<input type="number" min={1} max={10000} step={1} value={supply} disabled={busy}
      onChange={e=>{setSupply(Number(e.target.value));invalidate();}}/></label>
    <label>Reproducible generation seed<input value={seed} maxLength={128} disabled={busy} onChange={e=>{setSeed(e.target.value);invalidate();}}/></label>
    <label>Artwork export size<input value="512 × 512 PNG" readOnly/></label>
    <label className="gen-wide">Description<textarea value={description} rows={2} maxLength={1200} disabled={busy}
      onChange={e=>{setDescription(e.target.value);invalidate();}}/></label>
   </div>
  </section>
  <section className="gen-panel" aria-label="Trait layers">
   <div className="gen-section-head"><div><span className="gen-step">02</span><h2>Upload artwork layers</h2></div>
    <button className="gen-small-action" disabled={busy||layers.length>=MAX_LAYERS} onClick={()=>addLayer()}>+ Add layer</button>
   </div>
   <p>Each layer represents a character feature, such as a face, eyes, hair or hat. Upload PNG variations with transparent backgrounds. Each image should use the same canvas size and alignment. Layer order controls which artwork appears on top.</p>
   {layers.length===0?<div className="gen-empty">
    <span className="gen-empty-mark">◇</span>
    <h3>No artwork layers yet</h3><p>Add layers, then upload PNG variations. No sample artwork or fake Punks will be generated.</p>
    <button onClick={starterLayers} disabled={busy}>Add Background, Face, Eyes & Headwear slots</button>
   </div>:<div className="gen-layer-stack">{layers.map((layer,i)=><div className="gen-layer" key={layer.id}>
     <div className="gen-layer-header">
      <span className="gen-layer-num">{String(i+1).padStart(2,"0")}</span>
      <input aria-label={"Layer "+(i+1)+" name"} value={layer.name} maxLength={48} disabled={busy} onChange={e=>updateLayer(layer.id,e.target.value)}/>
      <span className="gen-layer-count">{layer.variants.length} assets</span>
      <button aria-label={"Move "+layer.name+" up"} disabled={busy||i===0} onClick={()=>moveLayer(layer.id,-1)}>↑</button>
      <button aria-label={"Move "+layer.name+" down"} disabled={busy||i===layers.length-1} onClick={()=>moveLayer(layer.id,1)}>↓</button>
      <button aria-label={"Remove "+layer.name} className="gen-danger" disabled={busy} onClick={()=>removeLayer(layer.id)}>×</button>
     </div>
     <label className="gen-file-chooser">
      <span>+ Upload transparent PNG variations</span>
      <input aria-label={"Upload PNG variations for "+layer.name} type="file" accept="image/png,.png" multiple disabled={busy}
       onChange={e=>addImages(layer.id,e)}/>
     </label>
     {layer.variants.length>0&&<div className="gen-variants">{layer.variants.map(variant=><div className="gen-variant" key={variant.id}>
      <img alt={variant.name+" artwork layer"} src={variant.src}/>
      <label>Trait name<input value={variant.name} disabled={busy} maxLength={64} onChange={e=>updateVariant(layer.id,variant.id,"name",e.target.value)}/></label>
      <label>Rarity weight<input type="number" min={0} max={1000} step={1} value={variant.weight} disabled={busy}
       onChange={e=>updateVariant(layer.id,variant.id,"weight",e.target.value)}/></label>
      <button disabled={busy} aria-label={"Remove "+variant.name} onClick={()=>removeVariant(layer.id,variant.id)}>×</button>
     </div>)}</div>}
    </div>)}</div>}
   <p className="gen-tip">Weights are relative: 10 appears approximately ten times as often as 1 while combinations remain available. Use 0 to disable a trait. Actual frequencies are computed from the finished generation; rare combinations may have higher estimated ranks.</p>
  </section>
  <section className="gen-panel" aria-label="Generate NFT artwork">
   <div className="gen-section-head"><div><span className="gen-step">03</span><h2>Generate & preview</h2></div>
     <span className="gen-hint">No blockchain transaction</span>
   </div>
   <p>Click Generate to plan up to 10,000 unique combinations from your uploaded artwork. If there aren't enough possible combinations, the generator will tell you what to add.</p>
   <button className="gen-primary" disabled={busy} onClick={()=>void prepare()}>{busy?"Working…":"Generate "+(Number.isFinite(supply)?supply.toLocaleString():"")+" unique Punks"}</button>
   {message&&<p className="gen-good" role="status">{message}</p>}
   {error&&<p className="operator-error" role="alert">{error}</p>}
   {plan&&<><div className="gen-stats">
    <div><span>Planned NFTs</span><strong>{plan.supply.toLocaleString()}</strong></div>
    <div><span>Distinct combinations available</span><strong>{BigInt(plan.capacity).toLocaleString()}</strong></div>
    <div><span>Unique generated</span><strong>{plan.tokens.length.toLocaleString()}</strong></div>
    <div><span>Duplicate combinations</span><strong>0</strong></div>
   </div>
   <h3>Artwork preview</h3>
   <div className="gen-preview-grid">{previews.map(card=><article className="gen-preview-card" key={card.tokenId}>
     <img src={card.url} alt={"Generated "+name+" #"+card.tokenId}/>
     <div><strong>#{padded(card.tokenId)}</strong><span>Rarity rank {card.rank.toLocaleString()} / {plan.supply.toLocaleString()}</span></div>
     <p>{card.traits.join(" · ")}</p>
   </article>)}</div>
   <p className="gen-tip">Ranks are based on trait frequencies in this generated set. The images are real canvas composites of your PNG layers. Only the first eight render for this quick preview; export will render the rest.</p>
   <h3>Observed trait frequencies</h3>
   <div className="gen-rarity-grid">{layers.map((layer,i)=><div className="gen-rarity-layer" key={layer.id}>
    <strong>{layer.name}</strong>
    {layer.variants.map((v,j)=><div className="gen-rarity-row" key={v.id}>
     <span>{v.name}</span><span>{plan.counts[i][j].toLocaleString()} · {(plan.counts[i][j]/plan.supply*100).toFixed(1)}%</span>
    </div>)}
   </div>)}</div>
   </>}
  </section>
  {plan&&<section className="gen-panel" aria-label="Export generated NFT images">
   <div className="gen-section-head"><div><span className="gen-step">04</span><h2>Download images & metadata</h2></div><span className="gen-hint">Offline ZIP files</span></div>
   <p>The artwork is generated and exported in manageable ZIP batches because 10,000 PNGs can be large. Every ZIP includes real rendered PNGs and matching token JSON metadata, named by token ID without an extension to match the existing ERC-721 contract. No files are uploaded automatically.</p>
   <div className="gen-fields">
    <label>Images per ZIP batch<select disabled={busy} value={batchSize} onChange={e=>setBatchSize(Number(e.target.value))}>
     <option value={25}>25 files</option><option value={50}>50 files</option><option value={100}>100 files</option><option value={200}>200 files</option>
    </select></label>
    <label>Next token to export<input readOnly value={cursor>=plan.supply?"Complete":String(cursor+1)+" / "+plan.supply}/></label>
   </div>
   <div className="gen-export-actions">
    <button className="gen-primary" disabled={busy||cursor>=plan.supply} onClick={()=>void exportBatch()}>
      {busy?"Rendering "+processed+" artwork files…":cursor>=plan.supply?"All batches exported ✓":"Download next image ZIP"}
    </button>
    <button className="gen-secondary" disabled={busy} onClick={exportAllMetadata}>Download all {plan.supply.toLocaleString()} metadata JSONs</button>
    {cursor>0&&<button className="gen-small-action" disabled={busy} onClick={resetExport}>Restart batch export</button>}
   </div>
   <p className="gen-tip">The metadata references a <code>REPLACE_WITH_REAL_IMAGES_CID</code> placeholder. Pin all exported images, substitute the genuine CID, then pin metadata files using unpadded token ID filenames (metadata/1 through metadata/10000). The current ERC-721 contract appends the numeric token ID to its base URI. The normal operator deployment flow must verify that storage and the collection contract before opening any mint.</p>
  </section>}
  <p className="gen-footer"><Link href="/create">← Return to collection publishing studio</Link> · <Link href="/explore">Official NFT gallery</Link></p>
 </section>;
}
