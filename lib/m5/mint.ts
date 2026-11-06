import { isAddress, parseAbi, type Address, type Hex } from "viem";

export const M5_CHAIN_ID = 18881 as const;
export const M5_MINT_ENABLED = process.env.NEXT_PUBLIC_M5_ENABLE_MINTING === "true";
export const M5_FACTORY_ADDRESS = process.env.NEXT_PUBLIC_M4_FACTORY_ADDRESS || "";

export const mintAbi = parseAbi([
  "function phaseCount() view returns (uint256)",
  "function mintPhases(uint256) view returns (uint64 start,uint64 end,uint96 unitPrice,uint32 walletCap,uint32 phaseCap,uint32 minted,bytes32 merkleRoot,bool cancelled)",
  "function mintNonces(uint256,address) view returns (uint256)",
  "function mintedByWallet(uint256,address) view returns (uint256)",
  "function lifetimeMintedByWallet(address) view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function maxTotalMinted() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address,uint256) view returns (uint256)",
  "function supportsInterface(bytes4) view returns (bool)",
  "function mintFromPhase(uint256 phaseId,uint256 tokenId,uint256 quantity,uint256 allowance,bytes32[] proof,uint256 nonce,uint256 requestDeadline) payable",
  "event PhaseMint(uint256 indexed phaseId,address indexed minter,uint256 indexed tokenId,uint256 quantity,uint256 nonce,uint256 payment,uint256 refund)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"
]);

export const mintCallAbi = parseAbi([
  "function mintFromPhase(uint256 phaseId,uint256 tokenId,uint256 quantity,uint256 allowance,bytes32[] proof,uint256 nonce,uint256 requestDeadline) payable"
]);

export type MintDraft = {
  collection: string;
  phaseId: string;
  tokenId: string;
  quantity: string;
  allowance: string;
  proof: string;
};
export type ParsedMintDraft = {
  collection: Address;
  phaseId: bigint;
  tokenId: bigint;
  quantity: bigint;
  allowance: bigint;
  proof: Hex[];
};
function uint(raw:string,name:string,maxDigits=78):bigint{
  if(!/^(0|[1-9][0-9]*)$/.test(raw) || raw.length>maxDigits)
    throw new Error(name+" must be an unsigned decimal integer");
  const n=BigInt(raw);
  if(n>((1n<<256n)-1n)) throw new Error(name+" exceeds uint256");
  return n;
}
export function parseMintDraft(d: MintDraft): ParsedMintDraft {
  if(!isAddress(d.collection,{strict:false}))throw new Error("Collection address must be an EVM address");
  const phaseId=uint(d.phaseId,"Phase ID",10);
  const tokenId=uint(d.tokenId,"Token ID");
  const quantity=uint(d.quantity,"Quantity",4);
  const allowance=uint(d.allowance,"Allowlist allowance",10);
  if(phaseId===0n || quantity===0n || quantity>1000n)
    throw new Error("Phase must be positive and quantity 1–1000");
  if(d.proof.length>16000)throw new Error("Allowlist proof is too long");
  let parsed:unknown;
  try { parsed=d.proof.trim()?JSON.parse(d.proof):[]; } catch {throw new Error("Allowlist proof must be a JSON array");}
  if(!Array.isArray(parsed)||parsed.length>64 ||
     !parsed.every(x=>typeof x==="string"&&/^0x[0-9a-fA-F]{64}$/.test(x)))
    throw new Error("Invalid 32-byte Merkle proof array");
  return {collection:d.collection as Address,phaseId,tokenId,quantity,allowance,proof:parsed as Hex[]};
}
export function requiredPayment(weiPerUnit:bigint,quantity:bigint):bigint{
  if(weiPerUnit<0n||weiPerUnit>1000n*10n**18n ||quantity<1n||quantity>1000n)
    throw new Error("Invalid UOS mint price or quantity");
  return weiPerUnit*quantity;
}
export function mintGate():string|null {
  if(process.env.NEXT_PUBLIC_M4_CANCUN_VERIFIED!=="true")
    return "Cancun/MCOPY compatibility has no independent Ultra EVM Testnet proof.";
  if(!M5_MINT_ENABLED)return "Real minting is disabled by the M5 operator gate.";
  if(!isAddress(M5_FACTORY_ADDRESS,{strict:false}))
    return "No independently verified M5-capable factory address is configured.";
  return null;
}
