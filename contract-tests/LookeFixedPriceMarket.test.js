const assert=require("node:assert/strict");
const {ethers}=require("hardhat");
const {reverts, factoryDeploy, create721, create1155}=require("./helpers");

const types={Listing:[
 {name:"seller",type:"address"},{name:"collection",type:"address"},
 {name:"tokenId",type:"uint256"},{name:"quantity",type:"uint256"},
 {name:"unitPriceWei",type:"uint256"},{name:"nonce",type:"uint256"},
 {name:"deadline",type:"uint256"},{name:"reservedBuyer",type:"address"},
 {name:"minSellerProceedsWei",type:"uint256"},{name:"maxFeeBps",type:"uint16"},
 {name:"maxRoyaltyBps",type:"uint16"},{name:"standard",type:"uint8"}
]};
const UOS=ethers.parseEther("1");
let serial=10n;
async function now(){return BigInt((await ethers.provider.getBlock("latest")).timestamp);}
async function order(market, token, seller, opts={}){
 const standard=opts.standard||1;
 return {
  seller:seller.address,collection:await token.getAddress(),tokenId:opts.tokenId??1n,
  quantity:opts.quantity??1n,unitPriceWei:opts.price??UOS,nonce:opts.nonce??serial++,
  deadline:opts.deadline??await now()+3600n,reservedBuyer:opts.reservedBuyer??ethers.ZeroAddress,
  minSellerProceedsWei:opts.minSellerProceedsWei??0n,
  maxFeeBps:opts.maxFeeBps??200,maxRoyaltyBps:opts.maxRoyaltyBps??1000,standard
 };
}
async function sign(market, wallet, listing, overrides={}){
 const domain={name:"LookeNFT FixedPrice",version:"1",chainId:18881,verifyingContract:await market.getAddress(),...overrides};
 return wallet.signTypedData(domain,types,listing);
}
async function marketDeploy(recipient){
 const F=await ethers.getContractFactory("LookeFixedPriceMarket");
 const market=await F.deploy(recipient);await market.waitForDeployment();return market;
}

describe("M7 fixed-price EIP712 marketplace — LOCAL Hardhat only; no real Testnet trades",function(){
 let seller,buyer,outsider,feeWallet,royaltyWallet,factory,market,c;
 beforeEach(async function(){
  [seller,buyer,outsider,feeWallet,royaltyWallet]=await ethers.getSigners();
  factory=await factoryDeploy();market=await marketDeploy(feeWallet.address);
  ({c}=await create721(factory,seller,{cap:20n,receiver:royaltyWallet.address,bps:500}));
  await(await c.connect(seller).mintReserved(seller.address)).wait();
 });
 it("matches exact domain-bound seller EIP712 typed signature and full UOS settlement split",async()=>{
  await(await c.connect(seller).approve(await market.getAddress(),1n)).wait();
  const o=await order(market,c,seller,{minSellerProceedsWei:ethers.parseEther("0.93")});
  const signature=await sign(market,seller,o);
  const digest=ethers.TypedDataEncoder.hash(
   {name:"LookeNFT FixedPrice",version:"1",chainId:18881,verifyingContract:await market.getAddress()},types,o
  );
  assert.equal(await market.hashListing(o),digest);
  assert.equal(await market.isFillable(o,signature),true);
  const beforeSeller=await ethers.provider.getBalance(seller.address);
  const beforeFee=await ethers.provider.getBalance(feeWallet.address);
  const beforeRoyalty=await ethers.provider.getBalance(royaltyWallet.address);
  const receipt=await(await market.connect(buyer).buy(o,signature,{value:UOS})).wait();
  const event=receipt.logs.flatMap(l=>{try{return [market.interface.parseLog(l)]}catch{return []}}).find(x=>x?.name==="ListingFilled");
  assert.ok(event);
  assert.equal(event.args.orderHash,digest);
  assert.equal(event.args.feeWei,ethers.parseEther("0.02"));
  assert.equal(event.args.royaltyWei,ethers.parseEther("0.05"));
  assert.equal(event.args.sellerProceedsWei,ethers.parseEther("0.93"));
  assert.equal(await c.ownerOf(1n),buyer.address);
  assert.equal(await ethers.provider.getBalance(seller.address)-beforeSeller,ethers.parseEther("0.93"));
  assert.equal(await ethers.provider.getBalance(feeWallet.address)-beforeFee,ethers.parseEther("0.02"));
  assert.equal(await ethers.provider.getBalance(royaltyWallet.address)-beforeRoyalty,ethers.parseEther("0.05"));
  assert.equal(await ethers.provider.getBalance(await market.getAddress()),0n);
  await reverts(()=>market.connect(buyer).buy(o,signature,{value:UOS}),"InvalidNonce");
 });
 it("blocks unsigned listings, tampered terms, wrong chain, different market domain and expired orders",async()=>{
  await(await c.connect(seller).approve(await market.getAddress(),1n)).wait();
  const o=await order(market,c,seller);
  const signature=await sign(market,seller,o);
  await reverts(()=>market.connect(buyer).buy({...o,unitPriceWei:UOS+1n},signature,{value:UOS+1n}),"InvalidSignature");
  await reverts(()=>market.connect(buyer).buy(o,await sign(market,seller,o,{chainId:1}),{value:UOS}),"InvalidSignature");
  const otherMarket=await marketDeploy(feeWallet.address);
  await reverts(()=>otherMarket.connect(buyer).buy(o,signature,{value:UOS}),"InvalidSignature|UnauthorizedNFT");
  await reverts(()=>market.connect(buyer).buy(o,await sign(market,outsider,o),{value:UOS}),"InvalidSignature");
  await reverts(()=>market.connect(buyer).buy({...o,deadline:1n},signature,{value:UOS}),"ListingExpired");
 });
 it("seller cancellation and floor are wallet-scoped and monotonic",async()=>{
  await(await c.connect(seller).approve(await market.getAddress(),1n)).wait();
  const o=await order(market,c,seller,{nonce:77n});
  const sig=await sign(market,seller,o);
  await(await market.connect(outsider).cancelNonce(77n)).wait();
  assert.equal(await market.isFillable(o,sig),true);
  await(await market.connect(seller).cancelNonce(77n)).wait();
  assert.equal(await market.isFillable(o,sig),false);
  await reverts(()=>market.connect(buyer).buy(o,sig,{value:UOS}),"InvalidNonce");
  await reverts(()=>market.connect(seller).cancelNonce(77n),"InvalidNonce");
  await(await market.connect(seller).raiseMinimumNonce(100n)).wait();
  await reverts(()=>market.connect(seller).raiseMinimumNonce(99n),"InvalidNonce");
  await reverts(()=>market.connect(seller).raiseMinimumNonce(100n),"InvalidNonce");
 });
 it("requires actual ownership and NFT operator approval at execution, never custody",async()=>{
  const o=await order(market,c,seller);
  const sig=await sign(market,seller,o);
  assert.equal(await market.isFillable(o,sig),false);
  await reverts(()=>market.connect(buyer).buy(o,sig,{value:UOS}),"UnauthorizedNFT");
  await(await c.connect(seller).approve(await market.getAddress(),1n)).wait();
  await(await c.connect(seller).transferFrom(seller.address,outsider.address,1n)).wait();
  await reverts(()=>market.connect(buyer).buy(o,sig,{value:UOS}),"UnauthorizedNFT");
  assert.equal(await market.invalidNonces(seller.address,o.nonce),false);
 });
 it("buy must be exact UOS cost, reserved-buyer-bound, cannot self-trade",async()=>{
  await(await c.connect(seller).approve(await market.getAddress(),1n)).wait();
  const o=await order(market,c,seller,{reservedBuyer:buyer.address});
  const sig=await sign(market,seller,o);
  await reverts(()=>market.connect(outsider).buy(o,sig,{value:UOS}),"UnauthorizedBuyer");
  await reverts(()=>market.connect(seller).buy(o,sig,{value:UOS}),"UnauthorizedBuyer");
  await reverts(()=>market.connect(buyer).buy(o,sig,{value:UOS+1n}),"InvalidPrice");
  await reverts(()=>market.connect(buyer).buy(o,sig,{value:UOS-1n}),"InvalidPrice");
  assert.equal(await market.invalidNonces(seller.address,o.nonce),false);
 });
 it("reverts if fee/royalty exceeds seller's signed limits or minimum proceeds",async()=>{
  await(await c.connect(seller).approve(await market.getAddress(),1n)).wait();
  const a=await order(market,c,seller,{maxFeeBps:100});
  await reverts(()=>market.connect(buyer).buy(a,await sign(market,seller,a),{value:UOS}),"InvalidListing");
  const b=await order(market,c,seller,{maxRoyaltyBps:100});
  await reverts(()=>market.connect(buyer).buy(b,await sign(market,seller,b),{value:UOS}),"RoyaltyExceedsBound");
  const x=await order(market,c,seller,{minSellerProceedsWei:ethers.parseEther("0.94")});
  await reverts(()=>market.connect(buyer).buy(x,await sign(market,seller,x),{value:UOS}),"SellerProceedsTooLow");
 });
 it("ERC1155 performs full-order amount transfer and cannot replay nonce",async()=>{
  const result=await create1155(factory,seller,{totalCap:30n,perIdCap:20n,receiver:royaltyWallet.address,bps:500});
  const token=result.c;
  await(await token.connect(seller).mintReserved(seller.address,55n,12n)).wait();
  await(await token.connect(seller).setApprovalForAll(await market.getAddress(),true)).wait();
  const o=await order(market,token,seller,{standard:2,tokenId:55n,quantity:4n,price:ethers.parseEther("0.25")});
  const sig=await sign(market,seller,o);
  const before=await token.balanceOf(seller.address,55n);
  await(await market.connect(buyer).buy(o,sig,{value:UOS})).wait();
  assert.equal(await token.balanceOf(seller.address,55n),before-4n);
  assert.equal(await token.balanceOf(buyer.address,55n),4n);
  assert.equal(await market.invalidNonces(seller.address,o.nonce),true);
  await reverts(()=>market.connect(buyer).buy(o,sig,{value:UOS}),"InvalidNonce");
 });
 it("rejected payout atomically rolls back ERC721 ownership, consumed nonce and buyer funds",async()=>{
  const R=await ethers.getContractFactory("LookeRejectPayout");
  const reject=await R.deploy();await reject.waitForDeployment();
  const fresh=await create721(factory,seller,{cap:4n,receiver:await reject.getAddress(),bps:500});
  await(await fresh.c.connect(seller).mintReserved(seller.address)).wait();
  await(await fresh.c.connect(seller).approve(await market.getAddress(),1n)).wait();
  const o=await order(market,fresh.c,seller);
  await reverts(()=>market.connect(buyer).buy(o,await sign(market,seller,o),{value:UOS}),"TransferFailed");
  assert.equal(await fresh.c.ownerOf(1n),seller.address);
  assert.equal(await market.invalidNonces(seller.address,o.nonce),false);
  assert.equal(await ethers.provider.getBalance(await market.getAddress()),0n);
 });
});
