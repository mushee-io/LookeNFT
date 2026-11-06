import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {SignJWT} from "jose";
import {keccak256,type Address,type Hex} from "viem";
import {
 verifySocialAssertion,strictSocialHandle,trustedSocialDeepLink,
 type SocialTrust
} from "../lib/m10/claims";
import {
 avatarInput,externalRPC,proveNFTAvatar,type ProofReader,type BlockWitness,
} from "../lib/m10/ownership";
import {m10Gate} from "../lib/m10/bridge";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const trust:SocialTrust={issuer:"https://operator.looke.test.example",
 publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString(),
 expectedSourceCommit:"a".repeat(40),mediaHosts:["media.looke.test.example"]};
const owner=("0x"+"1".repeat(40)) as Address;
const contract=("0x"+"2".repeat(40)) as Address;
const digest=("0x"+"3".repeat(64)) as Hex;
const code=("0x60006000") as Hex;
const now=Math.floor(Date.now()/1000);
const payload=(change:Record<string,unknown>={})=>({
 chainId:18881,source:"looke-social-postgres",version:1,
 sourceCommit:trust.expectedSourceCommit,wallet:owner,profileId:owner,
 profile:{address:owner,handle:"creator_123",displayName:"Real source-only creator",
  bio:"Test-only signed profile",publicApproved:true,suspended:false},
 posts:[{id:"123e4567-e89b-42d3-a456-426614174000",author:owner,
  body:"A fixture that must never appear in production",hidden:false,
  deleted:false,moderationApproved:true,mediaKind:null,mediaUrl:null,
  createdAt:new Date(Date.now()-5000).toISOString()}],
 ...change
});
async function sign(claims:Record<string,unknown>=payload(),opt:{issuer?:string;audience?:string;jti?:string;iat?:number;exp?:number}={}){
 return new SignJWT(claims)
  .setProtectedHeader({alg:"EdDSA",typ:"JWT"})
  .setIssuer(opt.issuer??trust.issuer).setAudience(opt.audience??"lookenft-social-proof")
  .setSubject(owner).setJti(opt.jti??"m10-test-jti-1234567")
  .setIssuedAt(opt.iat??now-2).setExpirationTime(opt.exp??now+200)
  .sign(privateKey);
}
test("M10 signed-source JWT requires pinned EdDSA, issuer, exact wallet/chain, approved moderation and replay id",async()=>{
 const jwt=await sign(),v=await verifySocialAssertion(jwt,trust);
 assert.equal(v.wallet,owner);
 assert.equal(v.profileId,owner);
 assert.equal(v.posts.length,1);
 assert.equal(v.publicApproved,true);
 assert.equal(v.posts[0].body,"A fixture that must never appear in production");
 assert.match(v.assertionSha256,/^[a-f0-9]{64}$/);
 await assert.rejects(verifySocialAssertion(jwt+"garbage",trust),/signature|JWT/);
 await assert.rejects(verifySocialAssertion(jwt,{...trust,issuer:"https://another.looke.test.example"}),/signature|JWT/);
 await assert.rejects(verifySocialAssertion(await sign(payload({chainId:19991})),trust),/source|chain/);
 await assert.rejects(verifySocialAssertion(await sign(payload({wallet:contract})),trust),/wallet|identity/);
 await assert.rejects(verifySocialAssertion(await sign(payload({sourceCommit:"b".repeat(40)})),trust),/source|chain/);
 await assert.rejects(verifySocialAssertion(await sign(payload({profile:{...payload().profile,suspended:true}})),trust),/suspended/);
 await assert.rejects(verifySocialAssertion(await sign(payload({profile:{...payload().profile,publicApproved:false}})),trust),/unapproved/);
 await assert.rejects(verifySocialAssertion(await sign(payload({posts:[{...payload().posts[0],hidden:true}]})),trust),/moderation/);
 await assert.rejects(verifySocialAssertion(await sign(payload({posts:[{...payload().posts[0],author:contract}]})),trust),/author/);
 await assert.rejects(verifySocialAssertion(await sign(payload({posts:[{...payload().posts[0],mediaUrl:"https://evil.example/x.png",mediaKind:"image"}]})),trust),/moderator-approved|operator-approved/);
 await assert.rejects(verifySocialAssertion(await sign(payload(),{audience:"other-product"}),trust),/JWT/);
 await assert.rejects(verifySocialAssertion(await sign(payload(),{iat:now-900,exp:now-700}),trust),/JWT/);
});
test("M10 profile URLs are non-forgeable deep links; plain handles and avatar input are not proof",()=>{
 assert.equal(strictSocialHandle("creator_123"),"creator_123");
 assert.throws(()=>strictSocialHandle("../../admin"),/handle/);
 assert.equal(trustedSocialDeepLink("https://looke.example/","creator_123",contract),"https://looke.example/social");
 assert.throws(()=>trustedSocialDeepLink("http://looke.example/","creator_123",contract),/Approved/);
 assert.throws(()=>trustedSocialDeepLink("https://looke.example/evil","creator_123",contract),/Approved/);
 assert.throws(()=>avatarInput({wallet:owner,collection:contract,tokenId:"-1",standard:"erc721"}),/Invalid/);
 assert.throws(()=>avatarInput({wallet:owner,collection:contract,tokenId:"01",standard:"erc721"}),/Invalid/);
 assert.throws(()=>avatarInput({wallet:owner,collection:contract,tokenId:(1n<<256n).toString(),standard:"erc721"}),/Invalid/);
 assert.throws(()=>externalRPC("http://localhost:8545"),/approved public HTTPS|Separate/);
 assert.throws(()=>externalRPC("https://127.0.0.1:8545"),/approved public HTTPS|Separate/);
 assert.throws(()=>m10Gate("social"),/disabled/);
});
function witness():{reader:ProofReader;set:(key:"chain"|"block"|"code"|"standard"|"owner"|"balance"|"explorer",value:unknown)=>void}{
 let chain:[number,number]=[18881,18881],blockOk=true,codeOk=true,standardOk=true,owned=true,balance=3n,explorer=true;
 const hash=digest,codeHash=code;
 const r:ProofReader={
  primaryUrl:"https://primary.test.example",independentUrl:"https://independent.test.example",
  explorerUrl:"https://blockscout.test.example",
  chainIds:async()=>chain,heads:async()=>[200n,200n],
  block:async(number,which)=>({number,hash:which==="independent"&&!blockOk?("0x"+"4".repeat(64)) as Hex:hash,
    parentHash:("0x"+"2".repeat(64)) as Hex}),
  code:async(_address,_height,which)=>which==="independent"&&!codeOk?"0x60016000":codeHash,
  supports:async()=>standardOk,
  owner:async(_address,_id,_height,which)=>which==="independent"&&!owned?contract:owner,
  balance:async(_address,_wallet,_id,_height,which)=>which==="independent"&&balance===3n?2n:balance,
  explorerAgrees:async()=>explorer,
 };
 return {reader:r,set:(key,value)=>{
  if(key==="chain")chain=value as [number,number];
  if(key==="block")blockOk=Boolean(value);
  if(key==="code")codeOk=Boolean(value);
  if(key==="standard")standardOk=Boolean(value);
  if(key==="owner")owned=Boolean(value);
  if(key==="balance")balance=BigInt(value as number);
  if(key==="explorer")explorer=Boolean(value);
 }};
}
const options={
 lastIndexedBlock:186n,indexedHash:digest,deploymentBlock:100n,
 registryCodeHash:keccak256(code),sourceVerified:true,confirmations:12
};
test("M10 NFT avatar ERC721 requires two source-backed matching code, block, explorer, owner and 12 confirmations",async()=>{
 const req={wallet:owner,collection:contract,tokenId:"7",standard:"erc721" as const};
 const w=witness();
 const ok=await proveNFTAvatar(w.reader,req,options);
 assert.equal(ok.balance,"1");assert.equal(ok.blockNumber,"186");assert.equal(ok.codeHash,keccak256(code));
 w.set("block",false);await assert.rejects(proveNFTAvatar(w.reader,req,options),/block differs/);
 w.set("block",true);w.set("code",false);
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/code/);
 w.set("code",true);w.set("standard",false);
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/ERC165/);
 w.set("standard",true);w.set("explorer",false);
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/Blockscout/);
 w.set("explorer",true);w.set("owner",false);
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/owner equals/);
 w.set("owner",true);w.set("chain",[18881,19991]);
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/network mismatch/);
 await assert.rejects(proveNFTAvatar(witness().reader,req,{...options,sourceVerified:false}),/approved/);
 await assert.rejects(proveNFTAvatar(witness().reader,req,{...options,lastIndexedBlock:130n}),/recent/);
 await assert.rejects(proveNFTAvatar(witness().reader,req,{...options,confirmations:3}),/twelve/);
});
test("M10 ERC1155 requires positive independently matching balance, not screenshot or ownership assertion",async()=>{
 const req={wallet:owner,collection:contract,tokenId:"45",standard:"erc1155" as const};
 const w=witness();
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/balances must agree/);
 w.set("balance",0);
 await assert.rejects(proveNFTAvatar(w.reader,req,options),/balances must agree/);
 w.set("balance",2);
 const accepted=await proveNFTAvatar(w.reader,req,options);
 assert.equal(accepted.balance,"2");
});
