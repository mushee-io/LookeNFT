import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validateCommunityCoverUrl} from "../lib/server/community-cover";

test("community covers accept public Pinata image URLs, no operator secret",()=>{
 const cover="https://amethyst-wrong-sparrow-956.mypinata.cloud/ipfs/bafybeiea/00001.png";
 assert.equal(validateCommunityCoverUrl(cover),cover);
 assert.equal(validateCommunityCoverUrl(""),null);
 assert.equal(validateCommunityCoverUrl(null),null);
});
test("community cover validation blocks scripts, credential URLs, local and insecure hosts",()=>{
 for(const url of [
  "javascript:alert(1)","http://gateway.pinata.cloud/ipfs/bafy/art.png",
  "https://user:pass@gateway.pinata.cloud/ipfs/x",
  "https://localhost/metadata.png","https://evil.mypinata.cloud.attacker.example/x",
  "https://gateway.pinata.cloud:8443/x","https://gateway.pinata.cloud/x#fragment"
 ])assert.throws(()=>validateCommunityCoverUrl(url),url);
});
test("public creator registration requires wallet-signature on Testnet, v2 factory and confirmed ownership",async()=>{
 const route=await readFile(new URL("../app/api/creator/collections/route.ts",import.meta.url),"utf8");
 const page=await readFile(new URL("../app/create/page.tsx",import.meta.url),"utf8");
 assert.match(route,/requireSession\(request\)/);
 assert.match(route,/session\.chainId !== 18881/);
 assert.match(route,/receipt\.from\.toLowerCase\(\)!==creator/);
 assert.match(route,/receipt\.to\?\.toLowerCase\(\)!==factory\.toLowerCase\(\)/);
 assert.match(route,/receipt\.blockNumber\+12n/);
 assert.match(route,/version!==2n/);
 assert.match(route,/owner\.toLowerCase\(\)!==creator/);
 assert.match(route,/mint_enabled,published_at/);
 assert.match(route,/FALSE,now\(\)/);
 assert.match(page,/wallet\.authenticated && wallet\.chainId===18881/);
 assert.match(page,/version!==2n/);
 assert.match(page,/submitFactoryDeployment\(factory,calldata\)/);
 assert.match(page,/\/api\/creator\/collections/);
 assert.doesNotMatch(page,/\/api\/admin\/collections/);
 assert.doesNotMatch(page,/Publishing requires the LookeNFT admin wallet/);
});
