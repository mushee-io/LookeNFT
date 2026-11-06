/**
 * Local-only creator preview validation and metadata sample.
 * These previews neither write a collection nor imply an on-chain mint.
 */
export type PreviewForm={
 standard:"erc721"|"erc1155";
 name:string;symbol:string;description:string;
 totalCap:string;perIdCap:string;mintPriceUos:string;
 perWalletCap:string;royaltyPercent:string;
 coverUrl:string;traits:string;
};
export type PreviewTrait={trait_type:string;value:string};

function integer(raw:string,min:number,max:number,label:string):number{
 if(!/^[1-9]\d*$/.test(raw))throw Error(label+" must be a positive whole number.");
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(label+" must be "+min+"–"+max+".");
 return n;
}
export function parsePreviewTraits(input:string):PreviewTrait[]{
 const lines=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(lines.length>20)throw Error("Use 20 traits or fewer in the preview.");
 const names=new Set<string>();
 return lines.map((line)=>{
  const mark=line.indexOf(":");
  if(mark<1)throw Error("Enter traits as Name: Value (one per line).");
  const trait_type=line.slice(0,mark).trim(),value=line.slice(mark+1).trim();
  if(!trait_type||!value||trait_type.length>45||value.length>100)
   throw Error("Each trait requires a name and value (45 / 100 characters maximum).");
  const key=trait_type.toLowerCase();
  if(names.has(key))throw Error("Duplicate trait name: "+trait_type);
  names.add(key);
  return{trait_type,value};
 });
}
export function previewMetadata(form:PreviewForm,hasArtwork:boolean){
 const name=form.name.trim(),description=form.description.trim(),symbol=form.symbol.trim();
 if(name.length<2||name.length>80)throw Error("Collection name must be 2–80 characters.");
 if(form.standard!=="erc721"&&form.standard!=="erc1155")
  throw Error("Choose an NFT standard.");
 if(form.standard==="erc721"&&(!symbol||symbol.length>15))
  throw Error("Unique ERC-721 collections need a token symbol (1–15 characters).");
 if(description.length>1200)throw Error("Description cannot exceed 1200 characters.");
 const supply=integer(form.totalCap,1,1000000,"Supply");
 if(form.standard==="erc1155")integer(form.perIdCap,1,supply,"Copies per token ID");
 const walletCap=integer(form.perWalletCap,1,1000,"Per-wallet limit");
 if(walletCap>supply)throw Error("The per-wallet limit cannot exceed total supply.");
 if(!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,18})?$/.test(form.mintPriceUos)
    ||Number(form.mintPriceUos)>1000)
  throw Error("Price must be between 0 and 1000 UOS (at most 18 decimal places).");
 if(!/^(?:0|[1-9]|10)(?:\.\d{1,2})?$/.test(form.royaltyPercent)
    ||Number(form.royaltyPercent)>10)
  throw Error("Royalty must be 0–10%, up to two decimal places.");
 if(form.coverUrl){
  let u:URL;
  try{u=new URL(form.coverUrl)}catch{throw Error("Cover URL must be HTTPS.");}
  if(u.protocol!=="https:"||u.username||u.password||u.hash)
   throw Error("Cover URL must be HTTPS with no credentials or fragment.");
 }
 if(!hasArtwork&&!form.coverUrl.trim())throw Error("Upload a cover image or enter a hosted HTTPS cover URL.");
 const attributes=parsePreviewTraits(form.traits);
 // A local file has no usable remote token URI; do NOT imply it's uploaded.
 const previewUri=form.coverUrl.trim() || "LOCAL_PREVIEW_IMAGE_NOT_HOSTED";
 return{
  standard:form.standard,supply,walletCap,
  rarity:form.standard==="erc1155"
   ? "Same artwork across editions; no distinct rarity ranking"
   : "Distinct rarity requires real generated token artwork and trait weights",
  metadata:{
   name:form.standard==="erc721"?name+" #1":name+" — edition",
   description,
   image:previewUri,
   attributes
  },
  isLocalOnly:!form.coverUrl.trim()
 };
}
