import {test} from "node:test";
import assert from "node:assert/strict";
import {previewMetadata,parsePreviewTraits,type PreviewForm} from "../lib/m4/preview";
const edition:PreviewForm={
 standard:"erc1155",name:"Ultra Punks",symbol:"UP",
 description:"Test preview on Ultra EVM",
 totalCap:"10000",perIdCap:"10000",mintPriceUos:"0.25",
 perWalletCap:"3",royaltyPercent:"2.5",
 coverUrl:"",traits:"Background: Pink\nSeries: Genesis"
};
test("10,000 editions create a truthful offline draft, not 10,000 minted assets",()=>{
 const v=previewMetadata(edition,true);
 assert.equal(v.supply,10000);
 assert.equal(v.isLocalOnly,true);
 assert.equal(v.metadata.image,"LOCAL_PREVIEW_IMAGE_NOT_HOSTED");
 assert.equal(v.metadata.attributes.length,2);
 assert.match(v.rarity,/no distinct rarity/i);
});
test("without hosted or local image the preview refuses to pretend artwork exists",()=>{
 assert.throws(()=>previewMetadata(edition,false),/Upload a cover image/);
});
test("unique ERC-721 draft does not fabricate rarity scores",()=>{
 const v=previewMetadata({...edition,standard:"erc721"},true);
 assert.match(v.rarity,/requires real generated/);
});
test("prices, supply, duplicate and malformed traits are validated",()=>{
 for(const variant of [{totalCap:"1000001"},{mintPriceUos:"1001"},
   {mintPriceUos:"-1"},{perWalletCap:"0"},{royaltyPercent:"11"},
   {traits:"Color: Blue\ncolor: Red"}]){
   assert.throws(()=>previewMetadata({...edition,...variant},true));
 }
 assert.deepEqual(parsePreviewTraits("Hair: Blue"),[{trait_type:"Hair",value:"Blue"}]);
 assert.throws(()=>parsePreviewTraits("Hair only"));
});
