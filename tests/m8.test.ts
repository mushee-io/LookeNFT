import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {privateKeyToAccount} from "viem/accounts";
import {
 offerAbi,offerTypes,offerDomain,offerHash,verifyOfferEOA,
 parseOffer,offerJson,offerFromJSON,m8Gate,uosWei,type OfferDraft
} from "../lib/m8/offers";
const buyer=privateKeyToAccount(("0x"+"1".repeat(64)) as `0x${string}`);
const vault="0x000000000000000000000000000000000000beef" as const;
const now=1750000000n;
const draft:OfferDraft={
 collection:"0x000000000000000000000000000000000000dead",
 tokenId:"1",quantity:"1",totalPriceUOS:"1.25",nonce:"12",
 deadline:(now+86400n).toString(),allowedSeller:"",
 minSellerProceedsUOS:"1",maxFeeBps:"200",maxRoyaltyBps:"1000",standard:"erc721"
};
const edit=(values:Partial<OfferDraft>)=>({...draft,...values});
test("M8 buyer EIP712 signature binds exact chain, vault, UOS, NFT and nonce",async()=>{
 const offer=parseOffer(draft,buyer.address,now);
 assert.equal(offer.totalPriceWei,1250000000000000000n);
 const signature=await buyer.signTypedData({
  domain:offerDomain(vault),types:offerTypes,primaryType:"Offer",message:offer
 });
 assert.equal(await verifyOfferEOA(offer,vault,signature),true);
 assert.equal(await verifyOfferEOA({...offer,totalPriceWei:offer.totalPriceWei+1n},vault,signature),false);
 assert.equal(await verifyOfferEOA({...offer,nonce:offer.nonce+1n},vault,signature),false);
 assert.equal(await verifyOfferEOA(offer,"0x000000000000000000000000000000000000babe",signature),false);
 assert.match(offerHash(offer,vault),/^0x[0-9a-f]{64}$/);
 assert.deepEqual(offerFromJSON(offerJson(offer)),offer);
});
test("M8 strict native UOS and NFT bounds reject overfunding, invalid address and replay-shaped inputs",()=>{
 assert.throws(()=>parseOffer(edit({quantity:"2"}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({quantity:"1001",standard:"erc1155"}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({totalPriceUOS:"1000.000000000000000001"}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({totalPriceUOS:"0"}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({totalPriceUOS:"0.1234567890123456789"}),buyer.address,now),/canonical UOS/);
 assert.throws(()=>parseOffer(edit({nonce:"-1"}),buyer.address,now),/unsigned decimal/);
 assert.throws(()=>parseOffer(edit({nonce:"01"}),buyer.address,now),/unsigned decimal/);
 assert.throws(()=>parseOffer(edit({deadline:(now-1n).toString()}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({deadline:(now+91n*86400n).toString()}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({maxFeeBps:"199"}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({maxRoyaltyBps:"1001"}),buyer.address,now),/bounds/);
 assert.throws(()=>parseOffer(edit({allowedSeller:"javascript:alert(1)"}),buyer.address,now),/EVM address/);
 assert.throws(()=>parseOffer(edit({collection:"0xnotanaddress"}),buyer.address,now),/EVM addresses/);
 assert.equal(uosWei("0.000000000000000001","tiny"),1n);
});
test("M8 escrow has explicit fund/accept/refund actions and no operator sweep",async()=>{
 const names:string[]=offerAbi.filter(x=>x.type==="function").map(x=>x.name);
 for(const name of ["fund","offerHash","accept","refundTo","refundExpired","cancelNonce"])
  assert.ok(names.includes(name),name);
 for(const forbidden of ["sweep","withdrawAll","adminDeposit","approveNFT"])
  assert.ok(!names.includes(forbidden),forbidden);
 const contract=await readFile(new URL("../contracts/LookeFundedOffers.sol",import.meta.url),"utf8");
 assert.match(contract,/SignatureChecker.isValidSignatureNow/);
 assert.match(contract,/nonReentrant/);
 assert.match(contract,/totalLockedWei -= o.totalPriceWei/);
 assert.match(contract,/offerState\[digest\] = 2/);
 assert.match(contract,/offerState\[digest\] = 3/);
});
test("M8 all buyer, seller, refund and recording gates default OFF",async()=>{
 const env=await readFile(new URL("../.env.example",import.meta.url),"utf8");
 const provider=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
 for(const flag of ["NEXT_PUBLIC_M8_ENABLE_OFFERS","NEXT_PUBLIC_M8_ENABLE_FUNDING",
  "NEXT_PUBLIC_M8_ENABLE_ACCEPTANCE","NEXT_PUBLIC_M8_ENABLE_REFUNDS",
  "M8_OFFER_RECORDING_ENABLED"])
  assert.match(env,new RegExp(flag+"=false"));
 assert.ok(m8Gate("fund"));assert.ok(m8Gate("accept"));assert.ok(m8Gate("refund"));
 for(const method of ["signBuyerOffer","fundBuyerOffer","acceptBuyerOffer","refundBuyerOffer"])
  assert.match(provider,new RegExp("async function "+method));
 assert.match(provider,/eth_signTypedData_v4/);assert.match(provider,/simulateContract/);
});
