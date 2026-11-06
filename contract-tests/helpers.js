const assert=require("node:assert/strict");
const {ethers}=require("hardhat");
const uri721="ipfs://bafybeigdyrztg3kv/721/";
const uri1155="ipfs://bafybeigdyrztg3kv/{id}.json";
const newSalt=()=>ethers.hexlify(ethers.randomBytes(32));
async function reverts(action,fragment) {
  let caught;
  try { const tx=await action(); if(tx?.wait) await tx.wait(); } catch(e) {caught=e;}
  assert.ok(caught,"expected a revert");
  if(fragment) assert.match(String(caught.shortMessage||caught.message||caught),new RegExp(fragment));
}
async function factoryDeploy() {
  const F=await ethers.getContractFactory("LookeCollectionFactory");
  const f=await F.deploy(); await f.waitForDeployment(); return f;
}
async function create721(factory,creator,options={}) {
  const a=[options.name??"Looke Originals",options.symbol??"LKO",options.uri??uri721,options.cap??3n,options.receiver??creator.address,options.bps??500,options.salt??newSalt()];
  const expected=await factory.predictERC721(creator.address,...a);
  const tx=await factory.connect(creator).createERC721(...a);const receipt=await tx.wait();
  assert.equal(receipt.status,1);
  assert.notEqual(await ethers.provider.getCode(expected),"0x");
  return {c:await ethers.getContractAt("Looke721Collection",expected),address:expected,args:a,receipt};
}
async function create1155(factory,creator,options={}) {
  const a=[options.uri??uri1155,options.totalCap??8n,options.perIdCap??5n,options.receiver??creator.address,options.bps??500,options.salt??newSalt()];
  const expected=await factory.predictERC1155(creator.address,...a);
  const tx=await factory.connect(creator).createERC1155(...a);const receipt=await tx.wait();
  assert.equal(receipt.status,1);
  assert.notEqual(await ethers.provider.getCode(expected),"0x");
  return {c:await ethers.getContractAt("Looke1155Collection",expected),address:expected,args:a,receipt};
}
module.exports={uri721,uri1155,newSalt,reverts,factoryDeploy,create721,create1155};
