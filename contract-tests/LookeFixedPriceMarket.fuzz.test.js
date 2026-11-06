const assert=require("node:assert/strict");
const fc=require("fast-check");
const {ethers}=require("hardhat");
const {factoryDeploy,create1155,reverts}=require("./helpers");

const typed={Listing:[
 {name:"seller",type:"address"},{name:"collection",type:"address"},
 {name:"tokenId",type:"uint256"},{name:"quantity",type:"uint256"},
 {name:"unitPriceWei",type:"uint256"},{name:"nonce",type:"uint256"},
 {name:"deadline",type:"uint256"},{name:"reservedBuyer",type:"address"},
 {name:"minSellerProceedsWei",type:"uint256"},{name:"maxFeeBps",type:"uint16"},
 {name:"maxRoyaltyBps",type:"uint16"},{name:"standard",type:"uint8"}
]};
describe("M7 property-based atomic UOS sale accounting and nonce replay (local VM only)",function(){
 let seller,buyer,fee,royalty,factory,market,collection;
 beforeEach(async function(){
  [seller,buyer,fee,royalty]=await ethers.getSigners();
  factory=await factoryDeploy();
  market=await(await ethers.getContractFactory("LookeFixedPriceMarket")).deploy(fee.address);
  await market.waitForDeployment();
  ({c:collection}=await create1155(factory,seller,{totalCap:600n,perIdCap:300n,receiver:royalty.address,bps:500}));
  await(await collection.connect(seller).mintReserved(seller.address,7n,300n)).wait();
  await(await collection.connect(seller).setApprovalForAll(await market.getAddress(),true)).wait();
 });
 it("property: no positive value disappears, split equals exact price, and same nonce cannot sell twice",async function(){
  await fc.assert(fc.asyncProperty(
   fc.integer({min:1,max:15}),fc.integer({min:1,max:300000}),fc.integer({min:1,max:1000000}),
   async(q,priceMicro,seed)=>{
    const nonce=BigInt(seed)*1000n+BigInt(q);
    const price=BigInt(priceMicro)*10n**12n;
    const total=price*BigInt(q);
    const now=BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const order={
     seller:seller.address,collection:await collection.getAddress(),tokenId:7n,quantity:BigInt(q),
     unitPriceWei:price,nonce,deadline:now+3600n,reservedBuyer:ethers.ZeroAddress,
     minSellerProceedsWei:0n,maxFeeBps:200,maxRoyaltyBps:1000,standard:2
    };
    const sig=await seller.signTypedData({
     name:"LookeNFT FixedPrice",version:"1",chainId:18881,verifyingContract:await market.getAddress()
    },typed,order);
    const beforeSeller=await ethers.provider.getBalance(seller.address);
    const beforeFee=await ethers.provider.getBalance(fee.address);
    const beforeRoyalty=await ethers.provider.getBalance(royalty.address);
    const beforeBuyer=await collection.balanceOf(buyer.address,7n);
    await(await market.connect(buyer).buy(order,sig,{value:total})).wait();
    const sellerDelta=await ethers.provider.getBalance(seller.address)-beforeSeller;
    const feeDelta=await ethers.provider.getBalance(fee.address)-beforeFee;
    const royaltyDelta=await ethers.provider.getBalance(royalty.address)-beforeRoyalty;
    assert.equal(sellerDelta+feeDelta+royaltyDelta,total);
    assert.equal(feeDelta,total*200n/10000n);
    assert.equal(royaltyDelta,total*500n/10000n);
    assert.equal(await collection.balanceOf(buyer.address,7n)-beforeBuyer,BigInt(q));
    assert.equal(await ethers.provider.getBalance(await market.getAddress()),0n);
    assert.equal(await market.invalidNonces(seller.address,nonce),true);
    await reverts(()=>market.connect(buyer).buy(order,sig,{value:total}),"InvalidNonce");
   }),{numRuns:14}
  );
 });
});
