/* Offline compiled-bytecode manifest. NEVER deploys or signs transactions. */
const hre = require("hardhat");
const { keccak256, toUtf8Bytes } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");
const { version } = require("solc");
const names = ["LookeCollectionFactory", "Looke721Collection", "Looke1155Collection"];
const result = {
  schema:"lookenft/m4-compiler-artifacts/v1",
  environment:"local-ci-only",
  chainIdTarget:18881,
  compiler:"solc-js "+version(),
  openzeppelinContracts:"5.6.1",
  optimization:{viaIR:true,optimizerRuns:200,evmVersion:"paris"},
  creationBytecodeOnly:true,
  deployedOnTestnet:false,
  securityReview:"not independently audited",
  contracts:[]
};
for(const name of names){
  const a=hre.artifacts.readArtifactSync(name);
  const creationBytes=(a.bytecode.length-2)/2;
  const runtimeBytes=(a.deployedBytecode.length-2)/2;
  if(a.bytecode==="0x"||a.deployedBytecode==="0x") throw Error("Missing contract bytecode: "+name);
  if(runtimeBytes>24576) throw Error(name+" exceeds EIP-170 runtime 24KiB limit");
  if(creationBytes>49152) throw Error(name+" exceeds EIP-3860 initcode 48KiB limit");
  result.contracts.push({
    name,abiEntries:a.abi.length,creationBytes,runtimeBytes,
    creationHash:keccak256(a.bytecode),runtimeHash:keccak256(a.deployedBytecode),
    sourceName:a.sourceName
  });
}
fs.mkdirSync(path.join(".artifacts"),{recursive:true});
fs.writeFileSync(path.join(".artifacts","m4-compiled-bytecode.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
