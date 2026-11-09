const assert=require("node:assert/strict");
const {ethers}=require("hardhat");
const {uri721,uri1155,newSalt,reverts}=require("./helpers");
describe("LookeNFT V3 operator-owned factory",()=>{
 let operator,visitor,factory;
 beforeEach(async()=>{
  [operator,visitor]=await ethers.getSigners();
  const F=await ethers.getContractFactory("LookeOwnerCollectionFactory");
  factory=await F.connect(operator).deploy(operator.address);
  await factory.waitForDeployment();
 });
 it("rejects contract creation by every non-owner wallet",async()=>{
  const salt=newSalt();
  assert.equal(await factory.VERSION(),3n);
  await reverts(()=>factory.connect(visitor).createERC721("Looke","LKO",uri721,10n,visitor.address,500,salt),"OwnableUnauthorizedAccount");
  await reverts(()=>factory.connect(visitor).createERC1155(uri1155,50n,5n,visitor.address,500,salt),"OwnableUnauthorizedAccount");
 });
 it("only owner may deploy collection; created collection owned by operator",async()=>{
  const salt=newSalt();
  const expected=await factory.predictERC721(operator.address,"Looke","LKO",uri721,10n,operator.address,500,salt);
  await(await factory.connect(operator).createERC721("Looke","LKO",uri721,10n,operator.address,500,salt)).wait();
  assert.equal(await factory.isCollection(expected),true);
  const collection=await ethers.getContractAt("Looke721Collection",expected);
  assert.equal(await collection.owner(),operator.address);
 });
 it("owner transfer changes eligible creator wallet",async()=>{
  await(await factory.connect(operator).transferOwnership(visitor.address)).wait();
  await reverts(()=>factory.connect(operator).createERC721("Old","OLD",uri721,10n,operator.address,500,newSalt()),"OwnableUnauthorizedAccount");
  const salt=newSalt();
  const predicted=await factory.predictERC1155(visitor.address,uri1155,50n,5n,visitor.address,500,salt);
  await(await factory.connect(visitor).createERC1155(uri1155,50n,5n,visitor.address,500,salt)).wait();
  const collection=await ethers.getContractAt("Looke1155Collection",predicted);
  assert.equal(await collection.owner(),visitor.address);
 });
});
