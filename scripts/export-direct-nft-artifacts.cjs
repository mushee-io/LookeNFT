#!/usr/bin/env node
/**
 * Export public creation bytecode for wallet-signed NFT deployment.
 * Browser data is NEVER signed by a server; each creator deploys from their own
 * Ultra EVM Testnet wallet. Pinned OpenZeppelin 5.6.1 uses MCOPY, so compile with Cancun semantics.
 */
const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");
const root = path.resolve(__dirname,"..");
const names = ["Looke721Collection","Looke1155Collection"];
const sources = {};
for (const name of names.concat("LookeMintPhases")) {
  const key = "contracts/" + name + ".sol";
  sources[key] = { content: fs.readFileSync(path.join(root,key),"utf8") };
}
function readImport(filename) {
  for (const target of [
    path.resolve(root,filename),
    path.resolve(root,"contracts",filename),
    path.resolve(root,"node_modules",filename)
  ]) {
    if (fs.existsSync(target) && fs.statSync(target).isFile())
      return { contents: fs.readFileSync(target,"utf8") };
  }
  return { error: "Solidity import was not found: " + filename };
}
const input = {
  language:"Solidity",
  sources,
  settings:{
    optimizer:{enabled:true,runs:1},
    viaIR:true,
    evmVersion:"cancun",
    metadata:{bytecodeHash:"ipfs"},
    outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input),{import:readImport}));
const errors=(output.errors||[]).filter(e=>e.severity==="error");
if (errors.length) throw Error(errors.map(e=>e.formattedMessage).join("\n"));
const dest=path.join(root,"public","contracts");
fs.mkdirSync(dest,{recursive:true});
for (const [i,name] of names.entries()) {
  const compiled=output.contracts["contracts/"+name+".sol"]?.[name];
  const raw=compiled?.evm?.bytecode?.object;
  if (!raw || !/^[0-9a-f]+$/i.test(raw) || raw.length<200)
    throw Error("Invalid unlinked creation bytecode for "+name);
  const filename=i===0?"create-erc721.json":"create-erc1155.json";
  fs.writeFileSync(path.join(dest,filename),JSON.stringify({
    standard:i===0?"erc721":"erc1155",
    chainId:18881,
    compiler:solc.version(),
    evmVersion:"paris",
    abi:compiled.abi,
    bytecode:"0x"+raw
  })+"\n");
  console.log(filename+": exported "+(raw.length/2)+" creation bytes for direct creator wallet deployment");
}
