import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("self-serve free mint availability comes from live chain phases, not operator DB flags",async()=>{
 const c=await readFile(new URL("../lib/server/curation.ts",import.meta.url),"utf8");
 assert.match(c,/functionName:"phaseCount"/);
 assert.match(c,/functionName:"mintPhases"/);
 assert.match(c,/mintAvailable=!?(?:false|true)|mintAvailable=true/);
 assert.match(c,/block.timestamp>=start&&block.timestamp<=end/);
 assert.doesNotMatch(c,/if\(block&&x\.mint_enabled&&x\.status==="published"\)/);
 assert.match(c,/phaseId=String\(id\)/);
});
test("direct mint route requires on-chain free phase but not platform approval",async()=>{
 const mint=await readFile(new URL("../app/mint/page.tsx",import.meta.url),"utf8");
 const collection=await readFile(new URL("../app/collection/[address]/page.tsx",import.meta.url),"utf8");
 const server=await readFile(new URL("../app/api/creator/collections/[address]/route.ts",import.meta.url),"utf8");
 assert.match(mint,/curatedCollections\(false,address\.toLowerCase\(\)\)/);
 assert.match(mint,/LookeNFT admin approval is not required/);
 assert.match(collection,/Mint NFTs/);
 assert.doesNotMatch(collection,/Not currently active on-chain/);
 assert.match(server,/mintActive:valid&&block.timestamp>=start/);
 assert.doesNotMatch(server,/valid&&user\.status==="published"/);
});
