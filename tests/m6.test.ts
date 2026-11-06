import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import {
 sniffMedia,validateMedia,MAX_IMAGE_BYTES,MAX_VIDEO_BYTES,
 guardMultipart,readMultipart,cloudinaryReady,mediaOperationEnabled,trustedGateway
} from "../lib/m6/security";
import { canonicalJSON,buildMetadata,parseAttributes,parseTokenId } from "../lib/m6/metadata";
import { pinningReady,scanWithClamAV } from "../lib/m6/providers";
import { moderatorAuthorised } from "../app/api/media/moderation/route";

const png=()=>{
 const b=Buffer.alloc(64);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
 b.writeUInt32BE(13,8);b.write("IHDR",12);b.writeUInt32BE(16,16);b.writeUInt32BE(16,20);
 return b;
};
const jpg=()=>{const b=Buffer.alloc(64);b[0]=255;b[1]=216;b[2]=255;b[3]=224;b[62]=255;b[63]=217;return b;};
const webp=()=>{const b=Buffer.alloc(40);b.write("RIFF",0);b.writeUInt32LE(32,4);b.write("WEBP",8);b.write("VP8X",12);return b;};
const mp4=()=>{const b=Buffer.alloc(64);b.writeUInt32BE(24,0);b.write("ftyp",4);b.write("isom",8);return b;};
const webm=()=>{const b=Buffer.alloc(64);Buffer.from([26,69,223,163]).copy(b);b.write("webm",16);return b;};
const cid="Qm"+"a".repeat(44);

test("media signatures reject SVG, PDF, ZIP and unknown bytes",()=>{
 assert.equal(sniffMedia(png()),"image/png");
 assert.equal(sniffMedia(jpg()),"image/jpeg");
 assert.equal(sniffMedia(webp()),"image/webp");
 assert.equal(sniffMedia(mp4()),"video/mp4");
 assert.equal(sniffMedia(webm()),"video/webm");
 for(const s of ["<svg><script>bad</script></svg>","%PDF-1.7","PKZIP"])
  assert.equal(sniffMedia(Buffer.from(s+" ".repeat(64))),null);
});

test("strict MIME signature, extension, size and identity hash checks",()=>{
 assert.equal(validateMedia(png(),"image/png","art.png").kind,"image");
 assert.equal(validateMedia(jpg(),"image/jpeg","portrait.jpeg").sha256,
  createHash("sha256").update(jpg()).digest("hex"));
 assert.equal(validateMedia(mp4(),"video/mp4","film.mp4").kind,"video");
 assert.throws(()=>validateMedia(png(),"image/jpeg","art.png"),/content type differs/);
 assert.throws(()=>validateMedia(png(),"image/png","script.php"),/Filename extension/);
 assert.throws(()=>validateMedia(png(),"image/png","..\\evil.png"),/Invalid upload filename/);
 assert.throws(()=>validateMedia(Buffer.alloc(64),"image/png","art.png"),/signature/);
 const large=Buffer.alloc(MAX_IMAGE_BYTES+1);png().copy(large);
 assert.throws(()=>validateMedia(large,"image/png","art.png"),/size limit/);
 assert.equal(MAX_VIDEO_BYTES,10485760);
});

test("M6 bounded multipart parsing checks same-origin, format and declared size",async()=>{
 process.env.APP_ORIGIN="http://localhost:3000";
 const form=new FormData();
 form.append("file",new File([new Uint8Array(png())],"asset.png",{type:"image/png"}));
 const r=new NextRequest("http://localhost:3000/api/media/assets",{
  method:"POST",headers:{origin:"http://localhost:3000"},body:form
 });
 guardMultipart(r);
 const parsed=await readMultipart(r);
 const f=parsed.get("file");
 assert.ok(f instanceof File);
 assert.equal((await f.arrayBuffer()).byteLength,64);
 const evil=new NextRequest("http://localhost:3000/api/media/assets",{
  method:"POST",headers:{origin:"https://evil.example","content-type":"application/json"},body:"{}"
 });
 assert.throws(()=>guardMultipart(evil),/Origin not allowed/);
 const large=new NextRequest("http://localhost:3000/api/media/assets",{
  method:"POST",headers:{origin:"http://localhost:3000",
   "content-type":"multipart/form-data; boundary=hi","content-length":String(20000000)},
  body:"testing"
 });
 assert.throws(()=>guardMultipart(large),/content length/);
});

test("metadata canonicalisation and trait validation reject executable or spoofed metadata",()=>{
 const a={description:"Hello",name:"Art",attributes:[{value:"Blue",trait_type:"Colour"}]};
 const b={attributes:[{trait_type:"Colour",value:"Blue"}],name:"Art",description:"Hello"};
 assert.equal(canonicalJSON(a),canonicalJSON(b));
 const m=buildMetadata("Art","Description",[{trait_type:"Colour",value:"Blue"}],cid,"image");
 assert.equal(m.json.image,"ipfs://"+cid);
 assert.equal(m.sha256,createHash("sha256").update(canonicalJSON(m.json)).digest("hex"));
 assert.equal(buildMetadata("Film","",[],cid,"video").json.animation_url,"ipfs://"+cid);
 assert.throws(()=>buildMetadata("<script>bad</script>","",[],cid,"image"),/Invalid metadata name/);
 assert.throws(()=>buildMetadata("Art","",[], "javascript:alert(1)","image"),/CID/);
 assert.throws(()=>parseAttributes([{trait_type:"nested",value:{danger:true}}]),/simple string/);
 assert.throws(()=>parseAttributes(Array(21).fill({trait_type:"x",value:"a"})),/20/);
 assert.equal(parseTokenId("0"),"0");
 assert.throws(()=>parseTokenId("01"),/canonical/);
 assert.throws(()=>parseTokenId("-1"),/canonical/);
});

test("operator integrations fail closed and human moderator access is explicit",async()=>{
 delete process.env.M6_MEDIA_UPLOADS_ENABLED;
 delete process.env.M6_CLOUDINARY_CLOUD_NAME;
 delete process.env.M6_MODERATOR_WALLETS;
 delete process.env.M6_IPFS_PINNING_ENABLED;
 delete process.env.M6_CLAMAV_HOST;
 assert.equal(mediaOperationEnabled(),false);
 assert.equal(cloudinaryReady(),false);
 assert.equal(pinningReady(),false);
 assert.equal(moderatorAuthorised("0x"+"a".repeat(40)),false);
 process.env.M6_MODERATOR_WALLETS="0x"+"b".repeat(40);
 assert.equal(moderatorAuthorised("0x"+"b".repeat(40)),true);
 assert.equal(moderatorAuthorised("0x"+"a".repeat(40)),false);
 delete process.env.M6_MODERATOR_WALLETS;
 assert.throws(()=>trustedGateway("http://localhost/"),/Unsafe/);
 assert.throws(()=>trustedGateway("https://127.0.0.1/"),/Unsafe/);
 assert.equal(trustedGateway("https://gateway.example.org"),"https://gateway.example.org");
 await assert.rejects(scanWithClamAV(png()),/scanner is not configured/);
});
