import assert from "node:assert/strict";
import {test} from "node:test";
import {isOperatorWallet,operatorAddress,releaseMintEnabled,validateCoverUrl} from "../lib/server/curation";
function withEnv(name:string,value:string|undefined,fn:()=>void){
 const previous=process.env[name];
 try{if(value===undefined)delete process.env[name];else process.env[name]=value;fn();}
 finally{if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
}
test("no operator configured is fail-closed",()=>{
 withEnv("LOOKE_NFT_OPERATOR_WALLET",undefined,()=>{
  assert.equal(operatorAddress(),null);
  assert.equal(isOperatorWallet("0x1111111111111111111111111111111111111111"),false);
 });
});
test("only an exact configured address matches, case insensitively",()=>{
 const addr="0x1111111111111111111111111111111111111111";
 withEnv("LOOKE_NFT_OPERATOR_WALLET",addr,()=>{
  assert.equal(isOperatorWallet(addr.toUpperCase().replace("0X","0x")),true);
  assert.equal(isOperatorWallet("0x2222222222222222222222222222222222222222"),false);
 });
});
test("covers require explicitly permitted HTTPS hosts",()=>{
 withEnv("LOOKE_NFT_COVER_HOSTS","images.example.org",()=>{
  assert.equal(validateCoverUrl("https://images.example.org/art.png"),"https://images.example.org/art.png");
  assert.throws(()=>validateCoverUrl("http://images.example.org/art.png"));
  assert.throws(()=>validateCoverUrl("https://unknown.example.org/art.png"));
  assert.throws(()=>validateCoverUrl("javascript:alert(1)"));
 });
});
test("public mint fails closed when M12 release gates are disabled",()=>{
 withEnv("M12_FINAL_PUBLIC_BETA_ENABLED","false",()=>{
  assert.equal(releaseMintEnabled(),false);
 });
});
