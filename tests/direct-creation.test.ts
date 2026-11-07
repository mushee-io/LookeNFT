import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {isSuccessfulDirectCreation} from "../lib/testnet/direct-creation";

const ADDRESS="0x7762591e96429108d961f5740f99d863e8ad354a";
const ZERO="0x0000000000000000000000000000000000000000";

test("Ultra's successful CREATE receipt uses zero-address to but contractAddress is real",()=>{
 const transaction={to:null};
 const receipt={to:ZERO,status:"success",contractAddress:ADDRESS};
 assert.equal(isSuccessfulDirectCreation(transaction,receipt),true);
});
test("Ethereum-style null receipt to is also accepted",()=>{
 assert.equal(isSuccessfulDirectCreation({to:null},{to:null,status:"success",contractAddress:ADDRESS}),true);
});
test("reject revert, ordinary transfers, zero contract address and bogus addresses",()=>{
 const ok={to:ZERO,status:"success",contractAddress:ADDRESS};
 assert.equal(isSuccessfulDirectCreation({to:null},{...ok,status:"reverted"}),false);
 assert.equal(isSuccessfulDirectCreation({to:ADDRESS},ok),false);
 assert.equal(isSuccessfulDirectCreation({to:null},{...ok,contractAddress:ZERO}),false);
 assert.equal(isSuccessfulDirectCreation({to:null},{...ok,contractAddress:null}),false);
 assert.equal(isSuccessfulDirectCreation({to:null},{...ok,to:ADDRESS}),false);
 assert.equal(isSuccessfulDirectCreation({to:null},{...ok,contractAddress:"invalid"}),false);
});
test("creator UI recovers existing signed deployment without sending another creation transaction",async()=>{
 const page=await readFile(new URL("../app/create/page.tsx",import.meta.url),"utf8");
 const registry=await readFile(new URL("../app/api/creator/collections/route.ts",import.meta.url),"utf8");
 assert.match(page,/async function verifyExistingDeployment/);
 assert.match(page,/async function recoverDeployment/);
 assert.match(page,/getTransactionReceipt\(\{hash\}\)/);
 assert.match(page,/getTransaction\(\{hash\}\)/);
 assert.match(page,/isSuccessfulDirectCreation\(transaction,receipt\)/);
 assert.match(page,/Recover existing deployment \(no gas\)/);
 assert.match(page,/new URLSearchParams\(window\.location\.search\)\.get\("recover"\)/);
 assert.doesNotMatch(page,/receipt\.to!==null/);
 assert.match(registry,/isSuccessfulDirectCreation\(transaction,receipt\)/);
 assert.doesNotMatch(registry,/receipt\.to!==null/);
});

test("recovery restores on-chain ERC721 name, symbol, supply and base metadata URI",async()=>{
 const page=await readFile(new URL("../app/create/page.tsx",import.meta.url),"utf8");
 assert.match(page,/functionName:"baseTokenURI"/);
 assert.match(page,/functionName:"maxSupply"/);
 assert.match(page,/functionName:"name"/);
 assert.match(page,/functionName:"symbol"/);
 assert.match(page,/const changesImmutableContract=/);
 assert.match(page,/if\(changesImmutableContract\)/);
 assert.match(page,/setConfirmedAddress\(address\)/);
 assert.match(page,/Mint NFT #1 to my wallet \(wallet approval\)/);
 assert.match(page,/disabled=\{busy\|\|!eligible\|\|!!confirmedAddress\|\|!!txHash\}/);
});
