import {decodeEventLog,isAddress,type Address,type Hex} from "viem";
import {marketAbi} from "../m7/market";
import {offerAbi} from "../m8/offers";

export const M9_CHAIN_ID=18881 as const;
export const M9_MIN_CONFIRMATIONS=12;
export const M9_MAX_SCAN_BLOCKS=25;
export const M9_MAX_REORG_DEPTH=100;
export const M9_SCAN_ENABLED=process.env.M9_READONLY_SYNC_ENABLED==="true";
export const M9_MARKET_ADDRESS=process.env.M9_LISTING_MARKET_ADDRESS||"";
export const M9_VAULT_ADDRESS=process.env.M9_OFFER_VAULT_ADDRESS||"";
export type MarketSource="m7"|"m8";
export type MarketKind=
 "listing_filled"|"offer_funded"|"offer_accepted"|"offer_refunded"|
 "listing_nonce_cancelled"|"listing_nonce_floor"|
 "offer_nonce_cancelled"|"offer_nonce_floor";
export type MarketHeader={number:bigint;hash:Hex;parentHash:Hex};
export type RawMarketLog={
 address:Address;blockNumber:bigint;blockHash:Hex;transactionHash:Hex;
 logIndex:number;data:Hex;topics:Hex[]
};
export type MarketEvent={
 chainId:18881;txHash:string;logIndex:number;blockNumber:string;blockHash:string;
 marketAddress:string;kind:MarketKind;orderHash:string|null;
 actor:string|null;counterparty:string|null;collection:string|null;
 tokenId:string|null;nonce:string|null;quantity:string|null;totalPriceWei:string|null
};
const hex64=/^0x[0-9a-fA-F]{64}$/;
const lc=(s:string)=>s.toLowerCase();
function asAddress(x:unknown):string|null{
 return typeof x==="string"&&isAddress(x,{strict:false})?lc(x):null;
}
function asHex(x:unknown):string|null{
 return typeof x==="string"&&hex64.test(x)?lc(x):null;
}
function asNum(x:unknown):string|null{
 return typeof x==="bigint"&&x>=0n?x.toString():null;
}
export function validateMarketAddresses(listing:string,vault:string):{listing:Address;vault:Address}{
 if(!isAddress(listing,{strict:false})||!isAddress(vault,{strict:false})||
  listing.toLowerCase()===vault.toLowerCase()||
  listing.toLowerCase()==="0x"+"0".repeat(40)||vault.toLowerCase()==="0x"+"0".repeat(40))
  throw Error("Two distinct real Testnet marketplace and offer-vault addresses required");
 return {listing:listing as Address,vault:vault as Address};
}

/** Decode only matching expected contract event ABIs; ignore unrelated logs.
 * Unrecognized topics cannot be converted into price or activity.
 */
export function decodeMarketLog(log:RawMarketLog,listing:Address,vault:Address):MarketEvent|null{
 if(!hex64.test(log.transactionHash)||!hex64.test(log.blockHash)||
    !Number.isSafeInteger(log.logIndex)||log.logIndex<0||log.topics.length<1)
  throw Error("Malformed RPC event identity");
 const source=lc(log.address)===lc(listing)?"m7":lc(log.address)===lc(vault)?"m8":null;
 if(!source)return null;
 let parsed;
 try{
  parsed=decodeEventLog({abi:source==="m7"?marketAbi:offerAbi,
    data:log.data,topics:log.topics as [Hex,...Hex[]],strict:true});
 }catch{return null;}
 const a=parsed.args as unknown as Record<string,unknown>;
 let kind:MarketKind,order:string|null=null,actor:string|null=null;
 let counterparty:string|null=null,collection:string|null=null;
 let tokenId:string|null=null,quantity:string|null=null,price:string|null=null;
 let nonce:string|null=null;
 switch(parsed.eventName){
  case "ListingFilled":
   if(source!=="m7")return null;kind="listing_filled";
   order=asHex(a.orderHash);actor=asAddress(a.seller);counterparty=asAddress(a.buyer);
   collection=asAddress(a.collection);tokenId=asNum(a.tokenId);
   quantity=asNum(a.quantity);price=asNum(a.priceWei);nonce=asNum(a.nonce);break;
  case "NonceCancelled":
   if(source!=="m7")return null;kind="listing_nonce_cancelled";
   actor=asAddress(a.seller);nonce=asNum(a.nonce);break;
  case "MinimumNonceIncreased":
   if(source!=="m7")return null;kind="listing_nonce_floor";
   actor=asAddress(a.seller);nonce=asNum(a.current);break;
  case "OfferFunded":
   if(source!=="m8")return null;kind="offer_funded";
   order=asHex(a.offerHash);actor=asAddress(a.buyer);
   collection=asAddress(a.collection);tokenId=asNum(a.tokenId);
   quantity=asNum(a.quantity);price=asNum(a.totalPriceWei);nonce=asNum(a.nonce);break;
  case "OfferAccepted":
   if(source!=="m8")return null;kind="offer_accepted";
   order=asHex(a.offerHash);actor=asAddress(a.seller);counterparty=asAddress(a.buyer);
   collection=asAddress(a.collection);tokenId=asNum(a.tokenId);
   quantity=asNum(a.quantity);price=asNum(a.totalPriceWei);nonce=asNum(a.nonce);break;
  case "OfferRefunded":
   if(source!=="m8")return null;kind="offer_refunded";
   order=asHex(a.offerHash);actor=asAddress(a.buyer);counterparty=asAddress(a.recipient);
   price=asNum(a.amountWei);nonce=asNum(a.nonce);break;
  case "OfferNonceCancelled":
   if(source!=="m8")return null;kind="offer_nonce_cancelled";
   actor=asAddress(a.buyer);nonce=asNum(a.nonce);break;
  case "MinimumOfferNonceIncreased":
   if(source!=="m8")return null;kind="offer_nonce_floor";
   actor=asAddress(a.buyer);nonce=asNum(a.current);break;
  default:return null;
 }
 if(!actor||!nonce||(kind==="listing_filled"||kind==="offer_accepted"||kind==="offer_funded")&&
  (!order||!collection||!tokenId||!quantity||!price||BigInt(price)===0n)||
  kind==="offer_refunded"&&(!order||!price))throw Error("Incomplete matching financial event");
 return {chainId:18881,txHash:lc(log.transactionHash),logIndex:log.logIndex,
  blockNumber:log.blockNumber.toString(),blockHash:lc(log.blockHash),
  marketAddress:lc(log.address),kind,orderHash:order,actor,counterparty,
  collection,tokenId,nonce,quantity,totalPriceWei:price};
}
export function rawLogFingerprint(l:RawMarketLog):string{
 return [lc(l.address),l.blockNumber.toString(),lc(l.blockHash),
  lc(l.transactionHash),l.logIndex.toString(),lc(l.data),
  l.topics.map(x=>lc(x)).join(":")].join("|");
}
export function equalWitnessLogs(primary:RawMarketLog[],secondary:RawMarketLog[]):boolean{
 const ordered=(arr:RawMarketLog[])=>arr.map(rawLogFingerprint).sort();
 const a=ordered(primary),b=ordered(secondary);
 return a.length===b.length&&a.every((x,i)=>x===b[i]);
}
export function hasAncestorContinuity(prev:MarketHeader,next:MarketHeader):boolean{
 return next.number===prev.number+1n&&lc(next.parentHash)===lc(prev.hash);
}
export function weiSplit(price:bigint,fee:bigint,royalty:bigint,proceeds:bigint):boolean{
 return price>0n&&fee>=0n&&royalty>=0n&&proceeds>=0n&&
 fee===price*200n/10000n&&royalty<=price*1000n/10000n&&
 price===fee+royalty+proceeds;
}
export function marketReadOnly():{enabled:false;chainId:18881;realExecutionAllowed:false}{
 return {enabled:false,chainId:18881,realExecutionAllowed:false};
}
