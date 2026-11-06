import { isAddress, parseAbi, type Address, type Hex } from "viem";

export const M4_CHAIN_ID = 18881 as const;
export const MAX_COLLECTION_SUPPLY = 1_000_000n;
export const MAX_ROYALTY_BPS = 1_000n;
export const M4_FACTORY_ADDRESS = process.env.NEXT_PUBLIC_M4_FACTORY_ADDRESS || "";
export const M4_DEPLOY_ENABLED = process.env.NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT === "true";
export const M4_CANCUN_VERIFIED = process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED === "true";

export const factoryAbi = parseAbi([
  "function VERSION() view returns (uint256)",
  "function ULTRA_TESTNET_CHAIN_ID() view returns (uint256)",
  "function isCollection(address) view returns (bool)",
  "function predictERC721(address creator,string name,string symbol,string baseURI,uint256 maxSupply,address royaltyReceiver,uint96 royaltyBps,bytes32 userSalt) view returns (address)",
  "function predictERC1155(address creator,string uriTemplate,uint256 totalCap,uint256 perIdCap,address royaltyReceiver,uint96 royaltyBps,bytes32 userSalt) view returns (address)",
  "function createERC721(string name,string symbol,string baseURI,uint256 maxSupply,address royaltyReceiver,uint96 royaltyBps,bytes32 userSalt) returns (address)",
  "function createERC1155(string uriTemplate,uint256 totalCap,uint256 perIdCap,address royaltyReceiver,uint96 royaltyBps,bytes32 userSalt) returns (address)",
  "event CollectionCreated(address indexed creator,address indexed collection,uint8 indexed standard,bytes32 derivedSalt,uint256 totalSupplyCap,uint256 perIdCap,uint96 royaltyBps)"
]);

export const collectionAbi = parseAbi([
  "function owner() view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function maxSupply() view returns (uint256)",
  "function maxTotalMinted() view returns (uint256)",
  "function maxMintedPerId() view returns (uint256)"
]);

export type CollectionDraft = {
  standard: "erc721" | "erc1155";
  name: string;
  symbol: string;
  uri: string;
  totalCap: string;
  perIdCap: string;
  royaltyBps: string;
  royaltyReceiver: string;
  salt: string;
};

export type ValidatedCollection = {
  standard: "erc721" | "erc1155";
  name: string; symbol: string; uri: string;
  totalCap: bigint; perIdCap: bigint; royaltyBps: number;
  royaltyReceiver: Address; salt: Hex;
};

/** Value validation is duplicated in the constructor, not trusted to the browser. */
export function validateCollectionDraft(draft: CollectionDraft): ValidatedCollection {
  const name = draft.name.trim();
  const symbol = draft.symbol.trim().toUpperCase();
  const uri = draft.uri.trim();
  if (draft.standard !== "erc721" && draft.standard !== "erc1155") throw new Error("Invalid collection standard");
  if (draft.standard === "erc721" && (!name || name.length > 80 || !symbol || symbol.length > 15))
    throw new Error("ERC-721 name (1–80) and symbol (1–15) are required");
  if (uri.length < 9 || uri.length > 512 || /[\u0000-\u001f]/.test(uri))
    throw new Error("Metadata URI must be 9–512 printable characters");
  if (uri.startsWith("https://")) {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password || !parsed.hostname || parsed.hostname === "localhost" ||
        parsed.hostname.endsWith(".local") || parsed.hostname.endsWith(".internal"))
      throw new Error("Metadata HTTPS URL must not contain credentials or local hosts");
  } else if (!/^ipfs:\/\/[a-zA-Z0-9]+\/[a-zA-Z0-9._/{}-]*$/.test(uri)) {
    throw new Error("Metadata must use an HTTPS or IPFS URI");
  }
  if (draft.standard === "erc1155" && !uri.includes("{id}"))
    throw new Error("ERC-1155 metadata URI must contain {id}");
  if (!/^[1-9][0-9]{0,6}$/.test(draft.totalCap)) throw new Error("Supply must be a positive integer <=1,000,000");
  const totalCap = BigInt(draft.totalCap);
  if (totalCap > MAX_COLLECTION_SUPPLY) throw new Error("Supply must be <=1,000,000");
  if (!/^[0-9]{1,4}$/.test(draft.royaltyBps) || BigInt(draft.royaltyBps) > MAX_ROYALTY_BPS)
    throw new Error("Royalty must be 0–1000 basis points (0–10%)");
  const royaltyBps = Number(draft.royaltyBps);
  if (!isAddress(draft.royaltyReceiver, { strict: false }))
    throw new Error("A valid EVM royalty recipient is required");
  const perIdCap = draft.standard === "erc721" ? 1n :
    /^[1-9][0-9]{0,6}$/.test(draft.perIdCap) ? BigInt(draft.perIdCap) : 0n;
  if (perIdCap === 0n || perIdCap > totalCap)
    throw new Error("Per-token supply must be positive and <= total supply");
  if (!/^0x[0-9a-fA-F]{64}$/.test(draft.salt) || /^0x0{64}$/i.test(draft.salt))
    throw new Error("Generate a nonzero random deployment salt before proceeding");
  return {
    standard:draft.standard, name,symbol,uri,totalCap,perIdCap,royaltyBps,
    royaltyReceiver:draft.royaltyReceiver as Address, salt:draft.salt as Hex
  };
}
