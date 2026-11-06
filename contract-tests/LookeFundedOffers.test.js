const assert=require("node:assert/strict");
const fc=require("fast-check");
const {ethers}=require("hardhat");
const {reverts,factoryDeploy,create721,create1155}=require("./helpers");
const UOS=ethers.parseEther("1");
const typed={Offer:[
  {name:"buyer",type:"address"},{name:"collection",type:"address"},
  {name:"tokenId",type:"uint256"},{name:"quantity",type:"uint256"},
  {name:"totalPriceWei",type:"uint256"},{name:"nonce",type:"uint256"},
  {name:"deadline",type:"uint256"},{name:"allowedSeller",type:"address"},
  {name:"minSellerProceedsWei",type:"uint256"},{name:"maxFeeBps",type:"uint16"},
  {name:"maxRoyaltyBps",type:"uint16"},{name:"standard",type:"uint8"}
]};
let nonce=700n;
async function now(){return BigInt((await ethers.provider.getBlock("latest")).timestamp);}
async function deployOffers(fee){const F=await ethers.getContractFactory("LookeFundedOffers");const c=await F.deploy(fee);await c.waitForDeployment();return c;}
async function offer(contract,collection,buyer,opts={}){
 return {buyer:buyer.address,collection:await collection.getAddress(),
   tokenId:opts.tokenId??1n,quantity:opts.quantity??1n,totalPriceWei:opts.totalPriceWei??UOS,
   nonce:opts.nonce??nonce++,deadline:opts.deadline??await now()+3600n,
   allowedSeller:opts.allowedSeller??ethers.ZeroAddress,minSellerProceedsWei:opts.minSellerProceedsWei??0n,
   maxFeeBps:opts.maxFeeBps??200,maxRoyaltyBps:opts.maxRoyaltyBps??1000,
   standard:opts.standard??1};
}
async function sign(market,buyer,o,override={}){
 return buyer.signTypedData({name:"LookeNFT FundedOffer",version:"1",chainId:18881,
   verifyingContract:await market.getAddress(),...override},typed,o);
}
describe("M8 fully funded buyer offers on a LOCAL Hardhat VM, not Ultra Testnet",function(){
 let factory,market,seller,buyer,other,treasury,royalty,nft;
 beforeEach(async()=>{
  [seller,buyer,other,treasury,royalty]=await ethers.getSigners();
  factory=await factoryDeploy();market=await deployOffers(treasury.address);
  nft=(await create721(factory,seller,{cap:10n,receiver:royalty.address,bps:500})).c;
  await(await nft.connect(seller).mintReserved(seller.address)).wait();
 });
 it("EIP712 domain binds signed buyer intent to exact Testnet market and fully collateralized UOS amount",async()=>{
  const o=await offer(market,nft,buyer,{minSellerProceedsWei:ethers.parseEther("0.93")});
  const signature=await sign(market,buyer,o);
  assert.equal(await market.offerHash(o),ethers.TypedDataEncoder.hash({
   name:"LookeNFT FundedOffer",version:"1",chainId:18881,verifyingContract:await market.getAddress()
  },typed,o));
  await reverts(()=>market.connect(other).fund(o,signature,{value:UOS}),"NotBuyer");
  await reverts(()=>market.connect(buyer).fund(o,signature,{value:UOS-1n}),"IncorrectFunding");
  const foreign=await sign(market,buyer,o,{chainId:1});
  await reverts(()=>market.connect(buyer).fund(o,foreign,{value:UOS}),"BadSignature");
  const tampered={...o,totalPriceWei:UOS+1n};
  await reverts(()=>market.connect(buyer).fund(tampered,signature,{value:UOS+1n}),"BadSignature");
  const receipt=await(await market.connect(buyer).fund(o,signature,{value:UOS})).wait();
  assert.equal(receipt.status,1);
  const hash=await market.offerHash(o);
  assert.equal(await market.offerState(hash),1n);
  assert.equal(await market.totalLockedWei(),UOS);
  assert.equal(await market.buyerLockedWei(buyer.address),UOS);
  assert.equal(await ethers.provider.getBalance(await market.getAddress()),UOS);
  await reverts(()=>market.connect(buyer).fund(o,signature,{value:UOS}),"InvalidNonce");
  const otherOrder={...o,tokenId:2n};
  await reverts(()=>market.connect(buyer).fund(otherOrder,await sign(market,buyer,otherOrder),{value:UOS}),"InvalidNonce");
 });
 it("seller separately approves and accepts ERC721; distributes seller fee and ERC2981 royalty atomically",async()=>{
  const o=await offer(market,nft,buyer,{minSellerProceedsWei:ethers.parseEther("0.93")});
  await(await market.connect(buyer).fund(o,await sign(market,buyer,o),{value:UOS})).wait();
  await reverts(()=>market.connect(other).accept(o),"UnapprovedNFT");
  await reverts(()=>market.connect(seller).accept(o),"UnapprovedNFT");
  await(await nft.connect(seller).approve(await market.getAddress(),1n)).wait();
  const beforeSeller=await ethers.provider.getBalance(seller.address);
  const beforeFee=await ethers.provider.getBalance(treasury.address);
  const beforeRoyalty=await ethers.provider.getBalance(royalty.address);
  const receipt=await(await market.connect(seller).accept(o)).wait();
  const gas=receipt.gasUsed*receipt.gasPrice;
  const event=receipt.logs.flatMap(l=>{try{return [market.interface.parseLog(l)];}catch{return [];}}).find(e=>e?.name==="OfferAccepted");
  assert.ok(event);
  assert.equal(event.args.feeWei,ethers.parseEther("0.02"));
  assert.equal(event.args.royaltyWei,ethers.parseEther("0.05"));
  assert.equal(event.args.sellerProceedsWei,ethers.parseEther("0.93"));
  assert.equal(await nft.ownerOf(1n),buyer.address);
  assert.equal(await ethers.provider.getBalance(seller.address)-beforeSeller+gas,ethers.parseEther("0.93"));
  assert.equal(await ethers.provider.getBalance(treasury.address)-beforeFee,ethers.parseEther("0.02"));
  assert.equal(await ethers.provider.getBalance(royalty.address)-beforeRoyalty,ethers.parseEther("0.05"));
  assert.equal(await market.offerState(await market.offerHash(o)),2n);
  assert.equal(await market.totalLockedWei(),0n);
  assert.equal(await ethers.provider.getBalance(await market.getAddress()),0n);
  await reverts(()=>market.connect(seller).accept(o),"InvalidNonce");
 });
 it("ERC1155 full quantities and reserved seller: exact buyer balance, no partial settlement",async()=>{
  const collection=(await create1155(factory,seller,{
   totalCap:30n,perIdCap:15n,receiver:royalty.address,bps:500
  })).c;
  await(await collection.connect(seller).mintReserved(seller.address,20n,12n)).wait();
  const o=await offer(market,collection,buyer,{standard:2,tokenId:20n,quantity:4n,allowedSeller:seller.address});
  await(await market.connect(buyer).fund(o,await sign(market,buyer,o),{value:UOS})).wait();
  await(await collection.connect(seller).setApprovalForAll(await market.getAddress(),true)).wait();
  await reverts(()=>market.connect(other).accept(o),"NotSeller");
  await(await market.connect(seller).accept(o)).wait();
  assert.equal(await collection.balanceOf(buyer.address,20n),4n);
  assert.equal(await collection.balanceOf(seller.address,20n),8n);
  assert.equal(await market.offerState(await market.offerHash(o)),2n);
 });
 it("buyer cancellation, arbitrary recipient refund and nonce monotonic floor do not strand exact escrow",async()=>{
  const o=await offer(market,nft,buyer);
  await(await market.connect(buyer).fund(o,await sign(market,buyer,o),{value:UOS})).wait();
  await(await market.connect(buyer).cancelNonce(o.nonce)).wait();
  await reverts(()=>market.connect(seller).accept(o),"InvalidNonce");
  const before=await ethers.provider.getBalance(other.address);
  await reverts(()=>market.connect(other).refundTo(o,other.address),"NotBuyer");
  await(await market.connect(buyer).refundTo(o,other.address)).wait();
  assert.equal(await ethers.provider.getBalance(other.address)-before,UOS);
  assert.equal(await market.offerState(await market.offerHash(o)),3n);
  assert.equal(await market.totalLockedWei(),0n);
  await reverts(()=>market.connect(buyer).refundTo(o,buyer.address),"NotFunded");
  const p=await offer(market,nft,buyer,{nonce:999n});
  await(await market.connect(buyer).fund(p,await sign(market,buyer,p),{value:UOS})).wait();
  await(await market.connect(buyer).raiseMinimumNonce(1000n)).wait();
  await reverts(()=>market.connect(seller).accept(p),"InvalidNonce");
  await(await market.connect(other).refundExpired(p)).wait();
  assert.equal(await market.totalLockedWei(),0n);
  await reverts(()=>market.connect(buyer).raiseMinimumNonce(999n),"InvalidNonce");
 });
 it("anyone can refund expired offers only after deadline; no early third-party refund",async()=>{
  const t=await now();
  const o=await offer(market,nft,buyer,{deadline:t+10n});
  await(await market.connect(buyer).fund(o,await sign(market,buyer,o),{value:UOS})).wait();
  await reverts(()=>market.connect(other).refundExpired(o),"OfferExpired");
  await ethers.provider.send("evm_setNextBlockTimestamp",[Number(t+11n)]);
  await ethers.provider.send("evm_mine",[]);
  await(await market.connect(other).refundExpired(o)).wait();
  assert.equal(await market.totalLockedWei(),0n);
  assert.equal(await market.offerState(await market.offerHash(o)),3n);
 });
 it("seller proceeds and royalty cap are signed; malicious royalty recipient reverts full transfer",async()=>{
  const reject=await(await ethers.getContractFactory("LookeRejectPayout")).deploy();
  await reject.waitForDeployment();
  const token=(await create721(factory,seller,{cap:3n,receiver:await reject.getAddress(),bps:500})).c;
  await(await token.connect(seller).mintReserved(seller.address)).wait();
  const o=await offer(market,token,buyer);
  await(await market.connect(buyer).fund(o,await sign(market,buyer,o),{value:UOS})).wait();
  await(await token.connect(seller).approve(await market.getAddress(),1n)).wait();
  await reverts(()=>market.connect(seller).accept(o),"NativeTransferFailed");
  assert.equal(await token.ownerOf(1n),seller.address);
  assert.equal(await market.offerState(await market.offerHash(o)),1n);
  assert.equal(await market.totalLockedWei(),UOS);
  const limited=await offer(market,nft,buyer,{nonce:1001n,maxRoyaltyBps:100});
  await(await market.connect(buyer).fund(limited,await sign(market,buyer,limited),{value:UOS})).wait();
  await(await nft.connect(seller).approve(await market.getAddress(),1n)).wait();
  await reverts(()=>market.connect(seller).accept(limited),"RoyaltyExceedsBound");
  await(await market.connect(buyer).refundTo(limited,buyer.address)).wait();
  await(await market.connect(buyer).refundTo(o,buyer.address)).wait();
  assert.equal(await market.totalLockedWei(),0n);
 });
 it("invalid parameter bounds and buyer self-sale fail before funds move",async()=>{
  const o=await offer(market,nft,buyer);
  const cases=[{...o,quantity:0n},{...o,totalPriceWei:1001n*UOS},
   {...o,standard:1,quantity:2n},{...o,maxFeeBps:100},
   {...o,maxRoyaltyBps:1001}];
  for(const candidate of cases){const sig=await sign(market,buyer,candidate);await reverts(()=>market.connect(buyer).fund(
    candidate,sig,{value:candidate.totalPriceWei}),"BadOffer");}
  const self=await offer(market,nft,buyer);
  await(await market.connect(buyer).fund(self,await sign(market,buyer,self),{value:UOS})).wait();
  await reverts(()=>market.connect(buyer).accept(self),"NotSeller");
  await(await market.connect(buyer).refundTo(self,buyer.address)).wait();
  assert.equal(await ethers.provider.getBalance(await market.getAddress()),0n);
 });
 it("property: random ERC1155 fills keep exact collateral/royalty/fee UOS invariants",async()=>{
  const token=(await create1155(factory,seller,{totalCap:400n,perIdCap:300n,receiver:royalty.address,bps:500})).c;
  await(await token.connect(seller).mintReserved(seller.address,44n,300n)).wait();
  await(await token.connect(seller).setApprovalForAll(await market.getAddress(),true)).wait();
  await fc.assert(fc.asyncProperty(
   fc.integer({min:1,max:10}),fc.integer({min:1,max:9000}),async(q,units)=>{
    const price=BigInt(units)*10n**12n;
    const o=await offer(market,token,buyer,{quantity:BigInt(q),tokenId:44n,standard:2,totalPriceWei:price});
    await(await market.connect(buyer).fund(o,await sign(market,buyer,o),{value:price})).wait();
    const feeBefore=await ethers.provider.getBalance(treasury.address);
    const royaltyBefore=await ethers.provider.getBalance(royalty.address);
    await(await market.connect(seller).accept(o)).wait();
    const feeDiff=await ethers.provider.getBalance(treasury.address)-feeBefore;
    const royaltyDiff=await ethers.provider.getBalance(royalty.address)-royaltyBefore;
    assert.equal(feeDiff,price*200n/10000n);
    assert.equal(royaltyDiff,price*500n/10000n);
    assert.equal(await market.totalLockedWei(),0n);
    assert.equal(await ethers.provider.getBalance(await market.getAddress()),0n);
   }),{numRuns:12}
  );
 });
});
