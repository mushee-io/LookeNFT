import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  hashListing,verifyListingSignature,parseListingDraft,listingDomain,splitValue,m7Gate,
  marketAbi,marketTypes,M7_CHAIN_ID,M7_FEE_BPS,type ListingDraft
} from "../lib/m7/market";
import { readFile } from "node:fs/promises";

const seller=privateKeyToAccount(("0x"+"1".repeat(64)) as `0x${string}`);
const contract="0x000000000000000000000000000000000000dEaD";
const market="0x000000000000000000000000000000000000BEeF";
const now=1750000000n;
const base:ListingDraft={
  collection:contract,tokenId:"1",quantity:"1",unitPriceUOS:"1.5",
  nonce:"123",deadlineSeconds:(now+3600n).toString(),
  reservedBuyer:"",minSellerProceedsUOS:"1",maxFeeBps:"200",
  maxRoyaltyBps:"1000",standard:"erc721"
};
const edit=(partial:Partial<ListingDraft>)=>({...base,...partial});

test("M7 ERC721 EIP-712 seller order is domain-separated with exact hash",async()=>{
 const o=parseListingDraft(base,seller.address,now);
 assert.equal(o.unitPriceWei,1500000000000000000n);
 assert.equal(o.quantity,1n);assert.equal(o.nonce,123n);
 assert.equal(o.maxFeeBps,200);
 const signature=await seller.signTypedData({
  domain:listingDomain(market),types:marketTypes,primaryType:"Listing",message:o
 });
 assert.equal(await verifyListingSignature(o,market,signature),true);
 assert.equal(await verifyListingSignature({...o,unitPriceWei:o.unitPriceWei+1n},market,signature),false);
 const otherMarket="0x000000000000000000000000000000000000bAbe";
 assert.equal(await verifyListingSignature(o,otherMarket,signature),false);
 assert.match(hashListing(o,market),/^0x[0-9a-fA-F]{64}$/);
 assert.notEqual(hashListing(o,market),hashListing(o,otherMarket));
 assert.equal(M7_CHAIN_ID,18881);
 assert.equal(M7_FEE_BPS,200);
});

test("M7 rejects price, quantity, expiry, nonce and terms outside signed hard limits",()=>{
 assert.throws(()=>parseListingDraft(edit({standard:"erc721",quantity:"2"}),seller.address,now),/bounds/);
 assert.throws(()=>parseListingDraft(edit({standard:"erc1155",quantity:"1001"}),seller.address,now),/bounds/);
 assert.throws(()=>parseListingDraft(edit({unitPriceUOS:"1001"}),seller.address,now),/bounds/);
 assert.throws(()=>parseListingDraft(edit({unitPriceUOS:"0"}),seller.address,now),/bounds/);
 assert.throws(()=>parseListingDraft(edit({unitPriceUOS:"0.1234567890123456789"}),seller.address,now),/nonnegative UOS/);
 assert.throws(()=>parseListingDraft(edit({unitPriceUOS:"-5"}),seller.address,now),/nonnegative UOS/);
 assert.throws(()=>parseListingDraft(edit({nonce:"-1"}),seller.address,now),/unsigned decimal/);
 assert.throws(()=>parseListingDraft(edit({nonce:"01"}),seller.address,now),/unsigned decimal/);
 assert.throws(()=>parseListingDraft(edit({deadlineSeconds:(now-1n).toString()}),seller.address,now),/bounds/);
 assert.throws(()=>parseListingDraft(edit({deadlineSeconds:(now+91n*86400n).toString()}),seller.address,now),/bounds/);
 assert.throws(()=>parseListingDraft(edit({maxFeeBps:"199"}),seller.address,now),/Invalid signed/);
 assert.throws(()=>parseListingDraft(edit({maxRoyaltyBps:"1001"}),seller.address,now),/Invalid signed/);
 assert.throws(()=>parseListingDraft(edit({collection:"javascript:alert(1)"}),seller.address,now),/valid EVM/);
 assert.throws(()=>parseListingDraft(edit({reservedBuyer:"admin"}),seller.address,now),/EVM address/);
 assert.throws(()=>parseListingDraft(edit({minSellerProceedsUOS:"1.6"}),seller.address,now),/minimum proceeds/);
});

test("M7 UOS fee and royalty accounting is exact and bounded",()=>{
 const price=1500000000000000000n;
 const royalty=price*500n/10000n;
 const split=splitValue(price,royalty);
 assert.equal(split.fee,30000000000000000n);
 assert.equal(split.royalty,75000000000000000n);
 assert.equal(split.sellerProceeds,1395000000000000000n);
 assert.equal(split.price,split.fee+split.royalty+split.sellerProceeds);
 assert.throws(()=>splitValue(price,price),/Invalid UOS/);
 assert.throws(()=>splitValue(price,-1n),/Invalid UOS/);
 assert.throws(()=>splitValue(0n,0n),/Invalid UOS/);
});

test("M7 contract ABI exposes EIP712 listing, cancellation and atomic buy only",()=>{
 const names: string[]=marketAbi.filter(x=>x.type==="function").map(x=>x.name);
 for(const name of ["buy","quote","hashListing","cancelNonce","raiseMinimumNonce","isFillable"])
  assert.ok(names.includes(name),name+" missing");
 assert.ok(!names.includes("withdraw"));
});

test("M7 signing, buying, cancellation and all prior financial flags remain OFF by default",async()=>{
 const env=await readFile(new URL("../.env.example",import.meta.url),"utf8");
 const provider=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
 const source=await readFile(new URL("../contracts/LookeFixedPriceMarket.sol",import.meta.url),"utf8");
 assert.match(env,/NEXT_PUBLIC_M7_ENABLE_LISTINGS=false/);
 assert.match(env,/NEXT_PUBLIC_M7_ENABLE_SETTLEMENT=false/);
 assert.match(env,/NEXT_PUBLIC_M7_ENABLE_CANCELLATION=false/);
 assert.match(env,/M7_LISTINGS_ENABLED=false/);
 assert.match(env,/NEXT_PUBLIC_M4_CANCUN_VERIFIED=false/);
 assert.match(provider,/eth_signTypedData_v4/);
 assert.match(provider,/submitMarketBuy/);
 assert.match(provider,/simulateContract/);
 assert.match(provider,/NEXT_PUBLIC_M7_ENABLE_CANCELLATION/);
 assert.match(source,/SignatureChecker.isValidSignatureNow/);
 assert.match(source,/EIP712\("LookeNFT FixedPrice", "1"\)/);
 assert.match(source,/nonReentrant/);
 assert.match(source,/invalidNonces\[o.seller\]\[o.nonce\] = true/);
 assert.ok(m7Gate("buy"));
});
