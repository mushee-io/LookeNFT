import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mintGate, parseMintDraft, requiredPayment, type MintDraft } from "../lib/m5/mint";

const address="0x000000000000000000000000000000000000dEaD";
const proof="0x"+"a".repeat(64);
const input:MintDraft={
 collection:address,phaseId:"1",tokenId:"0",quantity:"2",allowance:"0",proof:""
};
const update=(value:Partial<MintDraft>)=>({...input,...value});

test("M5 mint quote parses explicit wallet payment units and transaction bounds",()=>{
 const parsed=parseMintDraft(input);
 assert.equal(parsed.phaseId,1n);
 assert.equal(parsed.tokenId,0n);
 assert.equal(parsed.quantity,2n);
 assert.equal(parsed.allowance,0n);
 assert.deepEqual(parsed.proof,[]);
 assert.equal(requiredPayment(1n*10n**18n,2n),2n*10n**18n);
 assert.equal(requiredPayment(0n,1000n),0n);
 assert.throws(()=>requiredPayment(-1n,1n),/Invalid/);
 assert.throws(()=>requiredPayment(10n**30n,1n),/Invalid/);
});

test("M5 rejects malformed addresses, phase, quantity, negative IDs and unsafe proof payloads",()=>{
 assert.throws(()=>parseMintDraft(update({collection:"x"})),/Collection address/);
 assert.throws(()=>parseMintDraft(update({phaseId:"0"})),/Phase must be positive/);
 assert.throws(()=>parseMintDraft(update({tokenId:"-1"})),/unsigned decimal/);
 assert.throws(()=>parseMintDraft(update({quantity:"1001"})),/Phase must be positive/);
 assert.throws(()=>parseMintDraft(update({quantity:"1.5"})),/unsigned decimal/);
 assert.throws(()=>parseMintDraft(update({allowance:"-1"})),/unsigned decimal/);
 assert.throws(()=>parseMintDraft(update({proof:"not json"})),/JSON array/);
 assert.throws(()=>parseMintDraft(update({proof:'["0xbad"]'})),/Invalid 32-byte/);
 assert.throws(()=>parseMintDraft(update({proof:JSON.stringify(Array(65).fill(proof))})),/Invalid 32-byte/);
 assert.deepEqual(parseMintDraft(update({proof:JSON.stringify([proof])})).proof,[proof]);
});

test("M5 on-chain payment is disabled by default and both independent security gates are present",async()=>{
 const env=await readFile(new URL("../.env.example",import.meta.url),"utf8");
 const provider=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
 const ui=await readFile(new URL("../components/CuratedMintFlow.tsx",import.meta.url),"utf8");
 const wrapper=await readFile(new URL("../app/mint/page.tsx",import.meta.url),"utf8");
 const solidity=await readFile(new URL("../contracts/LookeMintPhases.sol",import.meta.url),"utf8");
 assert.match(env,/NEXT_PUBLIC_M5_ENABLE_MINTING=false/);
 assert.match(env,/NEXT_PUBLIC_M4_CANCUN_VERIFIED=false/);
 assert.match(provider,/NEXT_PUBLIC_M5_ENABLE_MINTING !== "true"/);
 assert.match(provider,/NEXT_PUBLIC_M4_CANCUN_VERIFIED !== "true"/);
 assert.match(provider,/eth_sendTransaction/);
 assert.match(provider,/mintNonces/);
 assert.match(ui,/simulateContract/);
 assert.match(ui,/primary-rpc-only/);
 assert.match(wrapper,/curatedCollections/);
 assert.match(wrapper,/mintAvailable/);
 assert.match(solidity,/MerkleProof\.verifyCalldata/);
 assert.match(solidity,/nonReentrant/);
 assert.match(solidity,/accruedProceeds/);
 if(!process.env.NEXT_PUBLIC_M5_ENABLE_MINTING)assert.match(mintGate()||"",/disabled|Cancun/);
});
