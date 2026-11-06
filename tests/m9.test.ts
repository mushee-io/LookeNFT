import test from "node:test";
import assert from "node:assert/strict";
import {Interface} from "ethers";
import {decodeMarketLog,equalWitnessLogs,hasAncestorContinuity,weiSplit,
 rawLogFingerprint,marketReadOnly,validateMarketAddresses,type RawMarketLog} from "../lib/m9/market";
import type {Address,Hex} from "viem";
const listing="0x000000000000000000000000000000000000cafe" as const;
const vault="0x000000000000000000000000000000000000beef" as const;
const seller="0x0000000000000000000000000000000000000abc" as const;
const buyer="0x0000000000000000000000000000000000000bcd" as const;
const nft="0x0000000000000000000000000000000000000abc" as const;
const digest=("0x"+"2".repeat(64)) as Hex;
const blockHash=("0x"+"3".repeat(64)) as Hex;
const txHash=("0x"+"4".repeat(64)) as Hex;
function makeEvent(abi:string,name:string,args:unknown[],from:Address=listing):RawMarketLog{
 const encoded=new Interface([abi]).encodeEventLog(name,args);
 return {address:from,blockNumber:120n,blockHash,transactionHash:txHash,
  logIndex:0,data:encoded.data as Hex,topics:encoded.topics as Hex[]};
}
const filled=makeEvent("event ListingFilled(bytes32 indexed orderHash,address indexed seller,address indexed buyer,address collection,uint256 tokenId,uint256 quantity,uint256 priceWei,uint256 feeWei,address royaltyRecipient,uint256 royaltyWei,uint256 sellerProceedsWei,uint256 nonce,uint8 standard)",
 "ListingFilled",[digest,seller,buyer,nft,5n,1n,100000n,2000n,seller,5000n,93000n,9n,1]);
test("M9 synthetic ABI fixture decodes genuine contract-shaped listing sale, never labels fixture real",()=>{
 const e=decodeMarketLog(filled,listing,vault);
 assert.equal(e?.kind,"listing_filled");
 assert.equal(e?.orderHash,digest);
 assert.equal(e?.actor,seller);
 assert.equal(e?.counterparty,buyer);
 assert.equal(e?.totalPriceWei,"100000");
 assert.equal(e?.nonce,"9");
 assert.equal(e?.collection,nft);
 assert.equal(e?.quantity,"1");
});
test("M9 offer-funded, accepted, refunded, cancelled and floor events decode only expected market",()=>{
 const funded=makeEvent(
  "event OfferFunded(bytes32 indexed offerHash,address indexed buyer,address indexed collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline)",
  "OfferFunded",[digest,buyer,nft,3n,2n,200000n,11n,1900000000n],vault);
 const paid=makeEvent(
  "event OfferAccepted(bytes32 indexed offerHash,address indexed buyer,address indexed seller,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 feeWei,address royaltyRecipient,uint256 royaltyWei,uint256 sellerProceedsWei,uint256 nonce,uint8 standard)",
  "OfferAccepted",[digest,buyer,seller,nft,3n,2n,200000n,4000n,seller,10000n,186000n,11n,2],vault);
 const refund=makeEvent(
  "event OfferRefunded(bytes32 indexed offerHash,address indexed buyer,address indexed recipient,uint256 amountWei,uint256 nonce)",
  "OfferRefunded",[digest,buyer,buyer,200000n,11n],vault);
 const cancel=makeEvent("event OfferNonceCancelled(address indexed buyer,uint256 indexed nonce)",
  "OfferNonceCancelled",[buyer,11n],vault);
 const floor=makeEvent("event MinimumOfferNonceIncreased(address indexed buyer,uint256 previous,uint256 current)",
  "MinimumOfferNonceIncreased",[buyer,10n,20n],vault);
 assert.equal(decodeMarketLog(funded,listing,vault)?.kind,"offer_funded");
 assert.equal(decodeMarketLog(paid,listing,vault)?.kind,"offer_accepted");
 assert.equal(decodeMarketLog(refund,listing,vault)?.totalPriceWei,"200000");
 assert.equal(decodeMarketLog(cancel,listing,vault)?.nonce,"11");
 assert.equal(decodeMarketLog(floor,listing,vault)?.nonce,"20");
 assert.equal(decodeMarketLog({...paid,address:"0x0000000000000000000000000000000000000001"},listing,vault),null);
});
test("M9 two-witness event fingerprint detects changed topics, changed block hash, omissions and reorder",()=>{
 const a=[filled,{...filled,transactionHash:("0x"+"5".repeat(64)) as Hex,logIndex:1}];
 assert.equal(equalWitnessLogs(a,[...a].reverse()),true);
 assert.equal(equalWitnessLogs(a,[filled]),false);
 assert.equal(equalWitnessLogs(a,[{...filled,blockHash:("0x"+"6".repeat(64)) as Hex},a[1]]),false);
 assert.equal(equalWitnessLogs(a,[{...filled,topics:[("0x"+"0".repeat(64)) as Hex,...filled.topics.slice(1)]},a[1]]),false);
 assert.notEqual(rawLogFingerprint(a[0]),rawLogFingerprint(a[1]));
});
test("M9 block parent linkage and pricing invariants fail closed",()=>{
 const one={number:101n,hash:blockHash,parentHash:("0x"+"2".repeat(64)) as Hex};
 const next={number:102n,hash:("0x"+"5".repeat(64)) as Hex,parentHash:blockHash};
 assert.equal(hasAncestorContinuity(one,next),true);
 assert.equal(hasAncestorContinuity(one,{...next,parentHash:("0x"+"6".repeat(64)) as Hex}),false);
 assert.equal(hasAncestorContinuity(one,{...next,number:103n}),false);
 assert.equal(weiSplit(100000n,2000n,5000n,93000n),true);
 assert.equal(weiSplit(100000n,1000n,5000n,94000n),false);
 assert.equal(weiSplit(100000n,2000n,11000n,87000n),false);
 assert.equal(weiSplit(0n,0n,0n,0n),false);
});
test("M9 read-only network and operator constraints never imply trade authorisation",()=>{
 assert.deepEqual(marketReadOnly(),{enabled:false,chainId:18881,realExecutionAllowed:false});
 assert.throws(()=>validateMarketAddresses(listing,listing),/distinct/);
 assert.throws(()=>validateMarketAddresses("0xinvalid",vault),/distinct/);
 assert.throws(()=>decodeMarketLog({...filled,transactionHash:"0xnotreally" as Hex},listing,vault),
   /Malformed RPC event identity/);
});
