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
test("any connected Ultra EVM Testnet wallet can directly deploy ERC721 or ERC1155 without an admin or factory gate",async()=>{
 const route=await readFile(new URL("../app/api/creator/collections/route.ts",import.meta.url),"utf8");
 const page=await readFile(new URL("../app/create/page.tsx",import.meta.url),"utf8");
 const wallet=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
 const exportScript=await readFile(new URL("../scripts/export-direct-nft-artifacts.cjs",import.meta.url),"utf8");
 assert.match(route,/requireSession\(request\)/); // listing requires signed ownership
 assert.match(route,/session\.chainId !== 18881/);
 assert.match(route,/receipt\.from\.toLowerCase\(\)!==creator/);
 assert.match(route,/isSuccessfulDirectCreation\(transaction,receipt\)/);
 assert.match(route,/receipt\.contractAddress\.toLowerCase\(\)!==address/);
 assert.match(route,/owner\.toLowerCase\(\)!==creator/);
 assert.match(route,/mint_enabled,published_at/);
 assert.match(route,/FALSE,now\(\)/);
 assert.match(page,/wallet\.chainId===18881 && !!wallet\.address/);
 assert.match(page,/encodeDeployData/);
 assert.match(page,/submitDirectNFTDeployment\(calldata\)/);
 assert.match(page,/submitCreatorReserveMint\(contract,calldata\)/);
 assert.match(page,/\/api\/creator\/collections/);
 assert.doesNotMatch(page,/\/api\/admin\/collections/);
 assert.doesNotMatch(page,/M4_FACTORY_ADDRESS|M4_CANCUN_VERIFIED|M4_DEPLOY_ENABLED|deployAllowed/);
 assert.match(wallet,/submitDirectNFTDeployment/);
 assert.match(wallet,/submitCreatorReserveMint/);
 assert.equal((exportScript.match(/evmVersion:"paris"/g)||[]).length,2,"compiler target and emitted JSON artifact EVM version must agree");
 assert.match(exportScript,/Looke721Collection/);
 assert.match(exportScript,/Looke1155Collection/);
 assert.match(exportScript,/@looke/);
 assert.match(exportScript,/oz-paris/);
});

test("creator deploy cannot reuse a stale Cancun artifact from browser cache",async()=>{
 const page=await readFile(new URL("../app/create/page.tsx",import.meta.url),"utf8");
 const exporter=await readFile(new URL("../scripts/export-direct-nft-artifacts.cjs",import.meta.url),"utf8");
 assert.match(page,/create-erc721-paris-v1\.json/);
 assert.match(page,/create-erc1155-paris-v1\.json/);
 assert.match(page,/cache:"no-store"/);
 assert.doesNotMatch(page,/cache:"force-cache"/);
 assert.match(page,/Stale NFT bytecode: expected Paris/);
 assert.match(exporter,/filename\.replace\("\.json","-paris-v1\.json"\)/);
 assert.match(exporter,/fs\.writeFileSync\(path\.join\(dest,versioned\),artifact\)/);
});
