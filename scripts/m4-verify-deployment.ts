/**
 * M4 operator-only read-only deployment acceptance.
 * No private keys, RPC write calls, deployments, transfers or synthetic receipts.
 * Requires a wallet-approved real Testnet transaction and independent providers.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { createPublicClient, http, isAddress, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { ULTRA_TESTNET } from "../lib/network";

const factoryAbi = parseAbi([
  "function VERSION() view returns (uint256)",
  "function ULTRA_TESTNET_CHAIN_ID() view returns (uint256)",
  "function isCollection(address) view returns (bool)",
  "event CollectionCreated(address indexed creator,address indexed collection,uint8 indexed standard,bytes32 derivedSalt,uint256 totalSupplyCap,uint256 perIdCap,uint96 royaltyBps)"
]);
const tokenAbi = parseAbi([
  "function owner() view returns (address)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)"
]);

async function verify() {
  if (process.env.NEXT_PUBLIC_ULTRA_NETWORK !== "testnet")
    throw Error("Refusing non-Testnet verification");
  const factoryAddress=process.env.M4_FACTORY_ADDRESS||"";
  const hash=process.env.M4_CREATION_TX_HASH||"";
  const independentRpc=process.env.M4_INDEPENDENT_RPC_URL||"";
  if (!isAddress(factoryAddress,{strict:false}) || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw Error("Actual M4_FACTORY_ADDRESS and M4_CREATION_TX_HASH required");
  const secondUrl = new URL(independentRpc);
  if (secondUrl.protocol !== "https:" || secondUrl.hostname === new URL(ULTRA_TESTNET.rpcUrl).hostname ||
      secondUrl.username || secondUrl.password)
    throw Error("Independent HTTPS Testnet RPC must use a distinct provider");
  const address = factoryAddress.toLowerCase() as Address;
  const txHash = hash as Hex;
  const primary = createPublicClient({ transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1}) });
  const secondary = createPublicClient({ transport:http(independentRpc,{timeout:12000,retryCount:1}) });
  if (await primary.getChainId() !== 18881 || await secondary.getChainId() !== 18881)
    throw Error("Wrong RPC chain ID");
  const [tx, receipt, independentReceipt] = await Promise.all([
    primary.getTransaction({hash:txHash}),
    primary.getTransactionReceipt({hash:txHash}),
    secondary.getTransactionReceipt({hash:txHash})
  ]);
  if (receipt.status !== "success" || independentReceipt.status !== "success" ||
      receipt.blockHash.toLowerCase() !== independentReceipt.blockHash.toLowerCase() ||
      receipt.blockNumber !== independentReceipt.blockNumber ||
      tx.from === undefined || tx.to?.toLowerCase() !== address)
    throw Error("Factory transaction/receipt mismatch across independent RPC providers");
  const [a,b] = await Promise.all([
    primary.getBlock({blockNumber:receipt.blockNumber}),
    secondary.getBlock({blockNumber:receipt.blockNumber})
  ]);
  if (a.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
      b.hash?.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw Error("Block hash diverged between providers");
  const explorerUrl = ULTRA_TESTNET.explorerUrl + "/api/v2/transactions/" + hash;
  const response = await fetch(explorerUrl, {redirect:"error",signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Error("External Blockscout transaction evidence unavailable: HTTP "+response.status);
  const external:unknown = await response.json();
  if (!external || typeof external !== "object") throw Error("Explorer returned malformed transaction evidence");
  const externalRecord = external as { hash?:string; block?:number; block_hash?:string; status?:string };
  if (externalRecord.hash?.toLowerCase() !== hash.toLowerCase() ||
      (externalRecord.block_hash && externalRecord.block_hash.toLowerCase() !== receipt.blockHash.toLowerCase()))
    throw Error("Explorer transaction hash or block hash differs from RPC");

  const [chain,version] = await Promise.all([
    primary.readContract({address,abi:factoryAbi,functionName:"ULTRA_TESTNET_CHAIN_ID"}),
    primary.readContract({address,abi:factoryAbi,functionName:"VERSION"})
  ]);
  if (chain !== 18881n || version !== 1n) throw Error("Factory version/chain guard invalid");
  const events = parseEventLogs({abi:factoryAbi,logs:receipt.logs,eventName:"CollectionCreated"});
  if (events.length !== 1 || events[0].address.toLowerCase() !== address ||
      events[0].args.creator.toLowerCase() !== tx.from.toLowerCase())
    throw Error("Expected exact creator-bound CollectionCreated event missing");
  const event=events[0], collection=event.args.collection;
  const standard = Number(event.args.standard);
  if (standard!==1 && standard!==2) throw Error("Unknown NFT standard in receipt");
  const [owner,ownerIndependent,code1,code2,registry,supported] = await Promise.all([
    primary.readContract({address:collection,abi:tokenAbi,functionName:"owner"}),
    secondary.readContract({address:collection,abi:tokenAbi,functionName:"owner"}),
    primary.getCode({address:collection}),
    secondary.getCode({address:collection}),
    primary.readContract({address,abi:factoryAbi,functionName:"isCollection",args:[collection]}),
    primary.readContract({address:collection,abi:tokenAbi,functionName:"supportsInterface",args:[standard===1?"0x80ac58cd":"0xd9b67a26"]})
  ]);
  if (owner.toLowerCase()!==tx.from.toLowerCase() ||
      ownerIndependent.toLowerCase()!==tx.from.toLowerCase() ||
      !code1 || code1==="0x" || code1!==code2 || !registry || !supported)
    throw Error("Independent collection bytecode/owner/interface/registry checks failed");

  const manifest = {
    schema:"lookenft/m4-verified-testnet-deployment/v1",
    chainId:18881, network:"Ultra EVM Testnet",
    verificationLevel:"primary-and-independent-RPC-plus-Blockscout-transaction",
    factory:address,collection:collection.toLowerCase(),creator:tx.from.toLowerCase(),
    standard:standard===1?"erc721":"erc1155",
    txHash:hash,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,
    totalSupplyCap:event.args.totalSupplyCap.toString(),
    perTokenCap:event.args.perIdCap.toString(),royaltyBps:Number(event.args.royaltyBps),
    explorerTransactionUrl:ULTRA_TESTNET.explorerUrl+"/tx/"+hash,
    explorerContractUrl:ULTRA_TESTNET.explorerUrl+"/address/"+collection,
    verifiedOnChain:true,
    sourceCodeIndependentlyVerified:false,
    independentSecurityAudit:false,
    finalityNote:"Receipt/block/contract checks; operator must separately sign off sufficient finality and source-code verification."
  };
  await mkdir(".artifacts",{recursive:true});
  await writeFile(".artifacts/m4-deployment-evidence.json",JSON.stringify(manifest,null,2)+"\n");
  console.log(JSON.stringify(manifest,null,2));
}
verify().catch(e=>{console.error(JSON.stringify({
  status:"NO_GO_OR_UNVERIFIED",
  reason:e instanceof Error?e.message:"Unknown verification error",
  fabricatedEvidence:false
}));process.exitCode=1;});
