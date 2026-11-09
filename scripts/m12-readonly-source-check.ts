/**
 * M12 final source sample. READ-ONLY, opt-in, never deploys or transacts.
 * Fails closed and saves a source blocker rather than creating NFT proof.
 */
import {mkdir,writeFile} from "node:fs/promises";
import {ULTRA_TESTNET} from "../lib/network";
import {distinctRPCs,provider,officialBlockscout,corroborateBlock,
 verifyReadOnlyContractCode} from "../lib/m12/witness";
const out={
 milestone:12,chainId:18881,decision:"NO_GO",launchAuthorised:false,
 sourceStatus:"source_unavailable",operatorSourceProof:false,
 currentNftProof:false,securityAuditPassed:false,
 userWalletExecutionAuthorised:false,
 flags:"Testnet-only, financial execution/mainnet/public beta disabled",
 checkedAt:new Date().toISOString(),
 blocker:"Operator-independent RPC, approved contract hashes and official Blockscout are unverified"
};
async function main(){
 try{
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK!=="testnet"||
  process.env.M12_SOURCE_CHECK_ENABLED!=="true")
  throw Error("M12 independently witnessed read-only Testnet source probe is OFF");
 const secondary=process.env.M12_INDEPENDENT_RPC_URL||"";
 const first=ULTRA_TESTNET.rpcUrl;
 distinctRPCs(first,secondary);
 const p=provider(first),s=provider(secondary);
 const witness=await corroborateBlock(p,s,officialBlockscout,12);
 const required=[
  ["M12_APPROVED_FACTORY_ADDRESS","M12_APPROVED_FACTORY_CODE_HASH"],
  ["M12_APPROVED_MARKET_ADDRESS","M12_APPROVED_MARKET_CODE_HASH"],
  ["M12_APPROVED_OFFER_VAULT_ADDRESS","M12_APPROVED_OFFER_CODE_HASH"]
 ];
 const contracts=[];
 for(const [addressKey,hashKey] of required){
  const address=process.env[addressKey]||"",hash=process.env[hashKey]||"";
  if(!address||!hash)throw Error("Operator-approved deployed Testnet address/runtime evidence missing: "+addressKey);
  contracts.push(await verifyReadOnlyContractCode(p,s,witness,address,hash));
 }
 Object.assign(out,{sourceStatus:"read_only_unverified",
  operatorSourceProof:false,currentNftProof:false,
  blocker:"Two RPCs/Blockscout may agree on a block/bytecode, but independent human provider control, NFT owner/media, Cancun execution, real wallets and security audit are NOT proven",
  blockNumber:witness.number,blockHash:witness.hash,
  contractCodeMatches:contracts.map(c=>({address:c.address,codeHash:c.codeHash,approved:false}))
 });
}catch(e){
 // This is an operator evidence blocker, NOT a successful release action.
 Object.assign(out,{sourceStatus:"source_unavailable",
  blocker:e instanceof Error?e.message:"Unknown source mismatch",
  noSyntheticNetworkEvidence:true});
 process.exitCode=1;
}finally{
 await mkdir(".artifacts",{recursive:true});
 await writeFile(".artifacts/m12-final-readiness.json",JSON.stringify(out,null,2)+"\n");
 console.log(JSON.stringify(out));
}
}
void main().catch(e=>{
 console.error(JSON.stringify({status:"NO_GO",reason:e instanceof Error?e.message:"Unhandled source error"}));
 process.exitCode=1;
});
