import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateCollectionDraft, M4_CHAIN_ID, MAX_COLLECTION_SUPPLY, MAX_ROYALTY_BPS, type CollectionDraft } from "../lib/m4/factory";

const owner = "0x000000000000000000000000000000000000dEaD";
const salt = "0x" + "2".repeat(64);
const draft: CollectionDraft = {
  standard:"erc721",name:"Looke",symbol:"LKO",uri:"ipfs://bafyabc/metadata/",
  totalCap:"1000",perIdCap:"10",royaltyBps:"500",royaltyReceiver:owner,salt
};
const change = (part: Partial<CollectionDraft>) => ({...draft,...part});

test("M4 is Ultra EVM Testnet scoped with exact total and royalty caps",()=>{
  assert.equal(M4_CHAIN_ID,18881);
  assert.equal(MAX_COLLECTION_SUPPLY,1000000n);
  assert.equal(MAX_ROYALTY_BPS,1000n);
  assert.equal(validateCollectionDraft(draft).totalCap,1000n);
});

test("M4 ERC721 and ERC1155 creator form validates supply and metadata",()=>{
  assert.equal(validateCollectionDraft(change({standard:"erc721"})).perIdCap,1n);
  const edition=validateCollectionDraft(change({standard:"erc1155",uri:"ipfs://bafyabc/{id}.json",perIdCap:"3"}));
  assert.equal(edition.standard,"erc1155");
  assert.equal(edition.perIdCap,3n);
  assert.throws(()=>validateCollectionDraft(change({standard:"erc1155",uri:"ipfs://bafyabc/0.json"})),/must contain \{id\}/);
});

test("M4 draft rejects unbounded cap, invalid royalty and wallet address",()=>{
  assert.throws(()=>validateCollectionDraft(change({totalCap:"1000001"})),/Supply/);
  assert.throws(()=>validateCollectionDraft(change({totalCap:"0"})),/Supply/);
  assert.throws(()=>validateCollectionDraft(change({perIdCap:"9999",standard:"erc1155",uri:"ipfs://bafyabc/{id}"})),/Per-token/);
  assert.throws(()=>validateCollectionDraft(change({royaltyBps:"1001"})),/Royalty/);
  assert.throws(()=>validateCollectionDraft(change({royaltyReceiver:"0xabc"})),/EVM royalty/);
  assert.throws(()=>validateCollectionDraft(change({salt:"0x"+"0".repeat(64)})),/nonzero/);
});

test("M4 rejects script URIs, credentials and oversized names",()=>{
  assert.throws(()=>validateCollectionDraft(change({uri:"javascript:alert(1)"})),/HTTPS or IPFS/);
  assert.throws(()=>validateCollectionDraft(change({uri:"http://example.com/a"})),/HTTPS or IPFS/);
  assert.throws(()=>validateCollectionDraft(change({uri:"https://user:pass@example.org/a"})),/credentials/);
  assert.throws(()=>validateCollectionDraft(change({uri:"https://localhost:3000/a"})),/local hosts/);
  assert.throws(()=>validateCollectionDraft(change({name:"x".repeat(81)})),/name/);
});

test("M4 deployment is explicitly opt-in, local hardhat has no funded remote wallet",async()=>{
  const config=await readFile(new URL("../hardhat.config.js",import.meta.url),"utf8");
  const provider=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
  const env=await readFile(new URL("../.env.example",import.meta.url),"utf8");
  assert.match(config,/chainId: 18881/);
  assert.doesNotMatch(config,/privateKey|mnemonic|accounts:.*process\.env/);
  assert.match(provider,/NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT !== "true"/);
  assert.match(provider,/eth_sendTransaction/);
  assert.match(env,/NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT=false/);
  assert.match(env,/NEXT_PUBLIC_M4_CANCUN_VERIFIED=false/);
  assert.match(config,/hardfork: "cancun"/);
  assert.match(env,/NEXT_PUBLIC_M4_FACTORY_ADDRESS=/);
});
