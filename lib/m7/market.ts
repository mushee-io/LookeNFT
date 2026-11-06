import {
  hashTypedData, isAddress, parseAbi, verifyTypedData, type Address, type Hex
} from "viem";

export const M7_CHAIN_ID=18881 as const;
export const M7_FEE_BPS=200;
export const M7_MAX_ROYALTY_BPS=1000;
export const M7_MARKET_ADDRESS=process.env.NEXT_PUBLIC_M7_MARKET_ADDRESS || "";
export const M7_LISTING_ENABLED=process.env.NEXT_PUBLIC_M7_ENABLE_LISTINGS==="true";
export const M7_SETTLEMENT_ENABLED=process.env.NEXT_PUBLIC_M7_ENABLE_SETTLEMENT==="true";
export const M7_BPS=10000n;
export const ZERO_ADDRESS="0x0000000000000000000000000000000000000000" as Address;

const listingFields=[
  {name:"seller",type:"address"}, {name:"collection",type:"address"},
  {name:"tokenId",type:"uint256"}, {name:"quantity",type:"uint256"},
  {name:"unitPriceWei",type:"uint256"}, {name:"nonce",type:"uint256"},
  {name:"deadline",type:"uint256"}, {name:"reservedBuyer",type:"address"},
  {name:"minSellerProceedsWei",type:"uint256"},
  {name:"maxFeeBps",type:"uint16"}, {name:"maxRoyaltyBps",type:"uint16"},
  {name:"standard",type:"uint8"},
] as const;
export const marketTypes={Listing:listingFields} as const;

export type Listing={
  seller:Address;collection:Address;tokenId:bigint;quantity:bigint;
  unitPriceWei:bigint;nonce:bigint;deadline:bigint;reservedBuyer:Address;
  minSellerProceedsWei:bigint;maxFeeBps:number;maxRoyaltyBps:number;standard:number;
};
export type ListingDraft={
  collection:string;tokenId:string;quantity:string;unitPriceUOS:string;
  nonce:string;deadlineSeconds:string;reservedBuyer:string;
  minSellerProceedsUOS:string;maxFeeBps:string;maxRoyaltyBps:string;
  standard:"erc721"|"erc1155";
};
const tuple="(address seller,address collection,uint256 tokenId,uint256 quantity,uint256 unitPriceWei,uint256 nonce,uint256 deadline,address reservedBuyer,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard)";
export const marketAbi=parseAbi([
  "function VERSION() view returns (uint256)",
  "function ULTRA_TESTNET_CHAIN_ID() view returns (uint256)",
  "function FEE_BPS() view returns (uint16)",
  "function feeRecipient() view returns (address)",
  "function minimumNonce(address) view returns (uint256)",
  "function invalidNonces(address,uint256) view returns (bool)",
  "function hashListing("+tuple+" o) view returns (bytes32)",
  "function isFillable("+tuple+" o,bytes signature) view returns (bool)",
  "function quote("+tuple+" o) view returns (uint256 price,uint256 fee,address receiver,uint256 royalty,uint256 proceeds)",
  "function buy("+tuple+" o,bytes signature) payable",
  "function cancelNonce(uint256 nonce)",
  "function raiseMinimumNonce(uint256 newMinimum)",
  "event ListingFilled(bytes32 indexed orderHash,address indexed seller,address indexed buyer,address collection,uint256 tokenId,uint256 quantity,uint256 priceWei,uint256 feeWei,address royaltyRecipient,uint256 royaltyWei,uint256 sellerProceedsWei,uint256 nonce,uint8 standard)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)",
]);
export const erc721Abi=parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner,address operator) view returns (bool)"
]);
export const erc1155Abi=parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function balanceOf(address account,uint256 tokenId) view returns (uint256)",
  "function isApprovedForAll(address owner,address operator) view returns (bool)"
]);
function uint(value:unknown,name:string,max=78):bigint{
  if(typeof value!=="string"||value.length>max||!/^(0|[1-9][0-9]*)$/.test(value))
    throw Error(name+" must be an unsigned decimal integer");
  const n=BigInt(value);
  if(n>(1n<<256n)-1n)throw Error(name+" exceeds uint256");
  return n;
}
function nativeUOS(value:unknown,name:string):bigint {
  if(typeof value!=="string"||! /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/.test(value))
    throw Error(name+" must be a nonnegative UOS amount with at most 18 decimals");
  const [whole,fraction=""]=value.split(".");
  return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,"0"));
}
export function parseListingDraft(d:ListingDraft,seller:Address,atSeconds=BigInt(Math.floor(Date.now()/1000))):Listing{
  if(!isAddress(seller,{strict:false})||!isAddress(d.collection,{strict:false}))
    throw Error("Seller and collection must be valid EVM addresses");
  const reservedBuyer=d.reservedBuyer.trim();
  if(reservedBuyer!==""&&!isAddress(reservedBuyer,{strict:false}))
    throw Error("Reserved buyer must be an EVM address");
  const tokenId=uint(d.tokenId,"Token ID");
  const quantity=uint(d.quantity,"Quantity",4);
  const unitPriceWei=nativeUOS(d.unitPriceUOS,"Unit price");
  const nonce=uint(d.nonce,"Listing nonce");
  const deadline=uint(d.deadlineSeconds,"Expiry");
  const minSellerProceedsWei=nativeUOS(d.minSellerProceedsUOS,"Minimum seller proceeds");
  const fee=uint(d.maxFeeBps,"Max fee bps",5),royalty=uint(d.maxRoyaltyBps,"Max royalty bps",5);
  const standard=d.standard==="erc721"?1:d.standard==="erc1155"?2:0;
  const price=unitPriceWei*quantity;
  if(standard===0||quantity===0n||quantity>1000n||
    (standard===1&&quantity!==1n)||unitPriceWei===0n||
    price>1000n*10n**18n||deadline<atSeconds||deadline>atSeconds+90n*86400n)
    throw Error("Listing exceeds fixed-price quantity, amount or expiry bounds");
  if(fee<200n||fee>10000n||royalty>1000n||
     minSellerProceedsWei>price)
    throw Error("Invalid signed marketplace fees, royalties or minimum proceeds");
  return {
    seller,collection:d.collection as Address,tokenId,quantity,unitPriceWei,nonce,deadline,
    reservedBuyer:(reservedBuyer||ZERO_ADDRESS) as Address,
    minSellerProceedsWei,maxFeeBps:Number(fee),maxRoyaltyBps:Number(royalty),standard
  };
}
export function listingDomain(market:Address){
  if(!isAddress(market,{strict:false}))throw Error("Valid deployed Testnet marketplace address required");
  return {name:"LookeNFT FixedPrice",version:"1",chainId:18881,verifyingContract:market} as const;
}
export function hashListing(listing:Listing,market:Address):Hex{
  return hashTypedData({domain:listingDomain(market),types:marketTypes,primaryType:"Listing",message:listing});
}
export async function verifyListingSignature(listing:Listing,market:Address,signature:Hex){
  // EOA signature validation for server registration; contract-wallet EIP1271
  // acceptance requires additional independent on-chain validation in future.
  return verifyTypedData({
    address:listing.seller,domain:listingDomain(market),
    types:marketTypes,primaryType:"Listing",message:listing,signature
  });
}
export function splitValue(price:bigint,royalty:bigint){
  const fee=price*BigInt(M7_FEE_BPS)/M7_BPS;
  if(price<=0n||fee+royalty>price||royalty<0n||royalty>price/10n)
    throw Error("Invalid UOS sale proceeds split");
  return {price,fee,royalty,sellerProceeds:price-fee-royalty};
}
export function m7Gate(kind:"list"|"buy"):string|null {
  if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet")return "M7 is restricted to Ultra EVM Testnet";
  if(process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED!=="true")
    return "Independent Ultra EVM Testnet Cancun opcode verification is unavailable";
  if(!isAddress(M7_MARKET_ADDRESS,{strict:false}))
    return "An independently verified marketplace deployment is not configured";
  if(kind==="list"&&!M7_LISTING_ENABLED)return "M7 wallet listing signatures are disabled by the operator";
  if(kind==="buy"&&!M7_SETTLEMENT_ENABLED)return "M7 UOS settlement and wallet execution are disabled";
  return null;
}
