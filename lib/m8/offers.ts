import { hashTypedData, isAddress, parseAbi, verifyTypedData, type Address, type Hex } from "viem";

export const M8_VAULT=process.env.NEXT_PUBLIC_M8_OFFER_VAULT_ADDRESS||"";
export const ZERO="0x0000000000000000000000000000000000000000" as Address;
export const offerTypes={Offer:[
 {name:"buyer",type:"address"},{name:"collection",type:"address"},
 {name:"tokenId",type:"uint256"},{name:"quantity",type:"uint256"},
 {name:"totalPriceWei",type:"uint256"},{name:"nonce",type:"uint256"},
 {name:"deadline",type:"uint256"},{name:"allowedSeller",type:"address"},
 {name:"minSellerProceedsWei",type:"uint256"},{name:"maxFeeBps",type:"uint16"},
 {name:"maxRoyaltyBps",type:"uint16"},{name:"standard",type:"uint8"}
]} as const;
export type Offer={buyer:Address;collection:Address;tokenId:bigint;quantity:bigint;
 totalPriceWei:bigint;nonce:bigint;deadline:bigint;allowedSeller:Address;
 minSellerProceedsWei:bigint;maxFeeBps:number;maxRoyaltyBps:number;standard:number};
export type OfferDraft={collection:string;tokenId:string;quantity:string;totalPriceUOS:string;
 nonce:string;deadline:string;allowedSeller:string;minSellerProceedsUOS:string;
 maxFeeBps:string;maxRoyaltyBps:string;standard:"erc721"|"erc1155"};
export const offerAbi=parseAbi([
 "function VERSION() view returns (uint256)",
 "function ULTRA_TESTNET_CHAIN_ID() view returns (uint256)",
 "function FEE_BPS() view returns (uint16)",
 "function feeRecipient() view returns (address)",
 "function offerHash((address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard) o) view returns (bytes32)",
 "function offerState(bytes32) view returns (uint8)",
 "function fundedNonceHash(address,uint256) view returns (bytes32)",
 "function minimumNonce(address) view returns (uint256)",
 "function invalidNonces(address,uint256) view returns (bool)",
 "function buyerLockedWei(address) view returns (uint256)",
 "function totalLockedWei() view returns (uint256)",
 "function quote((address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard) o) view returns (uint256 fee,address receiver,uint256 royalty,uint256 proceeds)",
 "function fund((address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard) o,bytes signature) payable",
 "function accept((address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard) o)",
 "function refundTo((address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard) o,address recipient)",
 "function refundExpired((address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard) o)",
 "function cancelNonce(uint256 nonce)",
 "function raiseMinimumNonce(uint256 newMinimum)",
 "event OfferFunded(bytes32 indexed offerHash,address indexed buyer,address indexed collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline)",
 "event OfferRefunded(bytes32 indexed offerHash,address indexed buyer,address indexed recipient,uint256 amountWei,uint256 nonce)",
 "event OfferAccepted(bytes32 indexed offerHash,address indexed buyer,address indexed seller,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 feeWei,address royaltyRecipient,uint256 royaltyWei,uint256 sellerProceedsWei,uint256 nonce,uint8 standard)",
 "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
 "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)",
]);
export function offerDomain(vault:Address) {
 if(!isAddress(vault,{strict:false}))throw Error("Verified offer vault address required");
 return {name:"LookeNFT FundedOffer",version:"1",chainId:18881,verifyingContract:vault} as const;
}
export function offerHash(o:Offer,vault:Address):Hex{
 return hashTypedData({domain:offerDomain(vault),types:offerTypes,primaryType:"Offer",message:o});
}
export async function verifyOfferEOA(o:Offer,vault:Address,signature:Hex){
 return verifyTypedData({address:o.buyer,domain:offerDomain(vault),types:offerTypes,
  primaryType:"Offer",message:o,signature});
}
export function uint(value:string,label:string):bigint{
 if(typeof value!=="string"||value.length>78||!/^(0|[1-9][0-9]*)$/.test(value))
  throw Error(label+" must be a canonical unsigned decimal integer");
 const n=BigInt(value);if(n>(1n<<256n)-1n)throw Error(label+" exceeds uint256");return n;
}
export function uosWei(value:string,label:string):bigint{
 if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/.test(value))
  throw Error(label+" requires a canonical UOS amount with at most 18 decimals");
 const [a,b=""]=value.split(".");return BigInt(a)*10n**18n+BigInt(b.padEnd(18,"0"));
}
export function parseOffer(d:OfferDraft,buyer:Address,now=BigInt(Math.floor(Date.now()/1000))):Offer {
 if(!isAddress(buyer,{strict:false})||!isAddress(d.collection,{strict:false}))
  throw Error("Buyer and collection require EVM addresses");
 const seller=d.allowedSeller.trim();
 if(seller&&!isAddress(seller,{strict:false}))throw Error("Allowed seller must be EVM address");
 const standard=d.standard==="erc721"?1:d.standard==="erc1155"?2:0;
 const quantity=uint(d.quantity,"Quantity"),tokenId=uint(d.tokenId,"Token ID");
 const totalPriceWei=uosWei(d.totalPriceUOS,"Total UOS"),nonce=uint(d.nonce,"Nonce");
 const deadline=uint(d.deadline,"Deadline");
 const minSellerProceedsWei=uosWei(d.minSellerProceedsUOS,"Minimum proceeds");
 const fee=uint(d.maxFeeBps,"Fee"),royalty=uint(d.maxRoyaltyBps,"Royalty");
 if(standard===0||quantity<1n||quantity>1000n||(standard===1&&quantity!==1n)||
  totalPriceWei<1n||totalPriceWei>1000n*10n**18n||deadline<now||
  deadline>now+90n*86400n||minSellerProceedsWei>totalPriceWei||
  fee<200n||fee>10000n||royalty>1000n)
  throw Error("Offer quantity, price, deadline or fee bounds invalid");
 return {buyer,collection:d.collection as Address,tokenId,quantity,totalPriceWei,nonce,deadline,
  allowedSeller:(seller||ZERO) as Address,minSellerProceedsWei,
  maxFeeBps:Number(fee),maxRoyaltyBps:Number(royalty),standard};
}
export function offerJson(o:Offer){
 return {buyer:o.buyer,collection:o.collection,tokenId:o.tokenId.toString(),
  quantity:o.quantity.toString(),totalPriceWei:o.totalPriceWei.toString(),
  nonce:o.nonce.toString(),deadline:o.deadline.toString(),allowedSeller:o.allowedSeller,
  minSellerProceedsWei:o.minSellerProceedsWei.toString(),maxFeeBps:o.maxFeeBps,
  maxRoyaltyBps:o.maxRoyaltyBps,standard:o.standard};
}
export function offerFromJSON(row:Record<string,unknown>):Offer{
 return {buyer:String(row.buyer) as Address,collection:String(row.collection) as Address,
  tokenId:uint(String(row.tokenId),"Token ID"),quantity:uint(String(row.quantity),"Quantity"),
  totalPriceWei:uint(String(row.totalPriceWei),"Price"),nonce:uint(String(row.nonce),"Nonce"),
  deadline:uint(String(row.deadline),"Deadline"),allowedSeller:String(row.allowedSeller) as Address,
  minSellerProceedsWei:uint(String(row.minSellerProceedsWei),"Proceeds"),
  maxFeeBps:Number(row.maxFeeBps),maxRoyaltyBps:Number(row.maxRoyaltyBps),standard:Number(row.standard)};
}
export function m8Gate(action:"sign"|"fund"|"accept"|"refund"):string|null{
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")return "Only Ultra EVM Testnet 18881 is supported";
 if(process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED!=="true")return "Actual Testnet Cancun/MCOPY proof is missing";
 if(!isAddress(M8_VAULT,{strict:false}))return "Independently verified vault address missing";
 const flag={sign:"NEXT_PUBLIC_M8_ENABLE_OFFERS",fund:"NEXT_PUBLIC_M8_ENABLE_FUNDING",
  accept:"NEXT_PUBLIC_M8_ENABLE_ACCEPTANCE",refund:"NEXT_PUBLIC_M8_ENABLE_REFUNDS"}[action];
 return process.env[flag]==="true"?null:"Operator has disabled M8 "+action;
}
