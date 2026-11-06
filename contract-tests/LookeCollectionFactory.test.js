const assert=require("node:assert/strict");
const {ethers}=require("hardhat");
const {uri721,uri1155,newSalt,reverts,factoryDeploy,create721,create1155}=require("./helpers");

describe("M4 collection factory — isolated Hardhat EVM (chainId 18881)", function () {
  let factory,creator,other,collector;
  beforeEach(async function () {
    [creator,other,collector]=await ethers.getSigners();
    factory=await factoryDeploy();
  });
  it("creates ERC721 and ERC1155 with deterministic addresses, real local receipt logs and creator ownership",async function(){
    assert.equal(await factory.ULTRA_TESTNET_CHAIN_ID(),18881n);
    const a=await create721(factory,creator);
    const b=await create1155(factory,creator);
    assert.equal(await a.c.owner(),creator.address);
    assert.equal(await b.c.owner(),creator.address);
    assert.equal(await factory.isCollection(a.address),true);
    assert.equal(await factory.isCollection(b.address),true);
    assert.equal(await a.c.supportsInterface("0x80ac58cd"),true);
    assert.equal(await b.c.supportsInterface("0xd9b67a26"),true);
    assert.equal(await a.c.supportsInterface("0x2a55205a"),true);
    assert.equal(await b.c.supportsInterface("0x2a55205a"),true);
    const logs=a.receipt.logs.flatMap(l=>{try{return [factory.interface.parseLog(l)]}catch{return []}});
    const event=logs.find(x=>x?.name==="CollectionCreated");
    assert.ok(event);
    assert.equal(event.args.creator,creator.address);
    assert.equal(event.args.collection,a.address);
    assert.equal(event.args.standard,1n);
    assert.equal(await ethers.provider.getBalance(await factory.getAddress()),0n);
  });
  it("refuses salt reuse even across standards, isolates same salt for distinct creators",async function(){
    const salt=newSalt();
    const a=await create721(factory,creator,{salt});
    await reverts(()=>factory.connect(creator).createERC721(...a.args),"SaltAlreadyConsumed");
    await reverts(()=>factory.connect(creator).createERC1155(uri1155,8n,5n,creator.address,500,salt),"SaltAlreadyConsumed");
    const b=await create721(factory,other,{salt});
    assert.notEqual(a.address,b.address);
    assert.equal(await b.c.owner(),other.address);
    await reverts(()=>factory.deriveSalt(creator.address,ethers.ZeroHash),"InvalidSalt");
  });
  it("restricts ERC721 minting, metadata changes, pausing and ownership actions to creator",async function(){
    const {c}=await create721(factory,creator);
    await reverts(()=>c.connect(other).mintReserved(collector.address),"OwnableUnauthorizedAccount");
    await reverts(()=>c.connect(other).setBaseURI(uri721),"OwnableUnauthorizedAccount");
    await reverts(()=>c.connect(other).pauseMinting(),"OwnableUnauthorizedAccount");
    await reverts(()=>c.connect(other).transferOwnership(other.address),"OwnableUnauthorizedAccount");
    assert.equal(await c.owner(),creator.address);
  });
  it("enforces ERC721 lifetime cap, safe recipient, mint pause and metadata freeze",async function(){
    const {c}=await create721(factory,creator,{cap:2n});
    await reverts(()=>c.connect(creator).mintReserved(ethers.ZeroAddress),"InvalidCollectionConfiguration");
    await(await c.connect(creator).mintReserved(collector.address)).wait();
    assert.equal(await c.ownerOf(1n),collector.address);
    assert.equal(await c.tokenURI(1n),uri721+"1");
    await(await c.connect(creator).pauseMinting()).wait();
    await reverts(()=>c.connect(creator).mintReserved(collector.address),"EnforcedPause");
    await(await c.connect(creator).unpauseMinting()).wait();
    await(await c.connect(creator).mintReserved(creator.address)).wait();
    await reverts(()=>c.connect(creator).mintReserved(creator.address),"SupplyCapExceeded");
    assert.equal(await c.totalMinted(),2n);
    await(await c.connect(creator).setBaseURI("ipfs://updated/")).wait();
    await(await c.connect(creator).freezeMetadata()).wait();
    await reverts(()=>c.connect(creator).setBaseURI(uri721),"MetadataIsFrozen");
    await reverts(()=>c.connect(creator).freezeMetadata(),"MetadataIsFrozen");
  });
  it("enforces ERC1155 aggregate AND per-ID lifetime caps and creator-only operations",async function(){
    const {c}=await create1155(factory,creator,{totalCap:8n,perIdCap:5n});
    await reverts(()=>c.connect(other).mintReserved(collector.address,10n,1n),"OwnableUnauthorizedAccount");
    await reverts(()=>c.connect(creator).mintReserved(collector.address,10n,0n),"InvalidCollectionConfiguration");
    await(await c.connect(creator).mintReserved(collector.address,10n,4n)).wait();
    assert.equal(await c.balanceOf(collector.address,10n),4n);
    await reverts(()=>c.connect(creator).mintReserved(collector.address,10n,2n),"SupplyCapExceeded");
    await(await c.connect(creator).mintReserved(collector.address,11n,4n)).wait();
    assert.equal(await c.totalMinted(),8n);
    assert.equal(await c.mintedById(10n),4n);
    await reverts(()=>c.connect(creator).mintReserved(collector.address,11n,1n),"SupplyCapExceeded");
    await(await c.connect(creator).pauseMinting()).wait();
    await reverts(()=>c.connect(creator).mintReserved(collector.address,12n,1n),"EnforcedPause");
    await(await c.connect(creator).freezeMetadata()).wait();
    await reverts(()=>c.connect(creator).setURI(uri1155),"MetadataIsFrozen");
  });
  it("invalid configurations revert atomically, without using salt",async function(){
    const s=newSalt();
    await reverts(()=>factory.connect(creator).createERC721("","LKO",uri721,10n,creator.address,100,s),"InvalidCollectionConfiguration");
    assert.equal(await factory.consumedSalt(await factory.deriveSalt(creator.address,s)),false);
    await reverts(()=>factory.connect(creator).createERC721("Name","LKO",uri721,0n,creator.address,100,newSalt()),"InvalidCollectionConfiguration");
    await reverts(()=>factory.connect(creator).createERC721("Name","LKO",uri721,1000001n,creator.address,100,newSalt()),"InvalidCollectionConfiguration");
    await reverts(()=>factory.connect(creator).createERC721("Name","LKO",uri721,10n,creator.address,1001,newSalt()),"InvalidCollectionConfiguration");
    await reverts(()=>factory.connect(creator).createERC721("Name","LKO","x".repeat(513),10n,creator.address,100,newSalt()),"InvalidCollectionConfiguration");
    await reverts(()=>factory.connect(creator).createERC1155(uri1155,2n,3n,creator.address,100,newSalt()),"InvalidCollectionConfiguration");
    await reverts(()=>factory.connect(creator).createERC1155(uri1155,2n,0n,creator.address,100,newSalt()),"InvalidCollectionConfiguration");
    await reverts(()=>factory.connect(creator).createERC1155(uri1155,2n,2n,ethers.ZeroAddress,100,newSalt()),"InvalidCollectionConfiguration");
  });
  it("ERC2981 exact royalty maths and no factory fees",async function(){
    const a=await create721(factory,creator,{bps:750,receiver:collector.address});
    const b=await create1155(factory,creator,{bps:300,receiver:other.address});
    const x=await a.c.royaltyInfo(1n,10000n);
    assert.equal(x[0],collector.address);assert.equal(x[1],750n);
    const y=await b.c.royaltyInfo(99n,10000n);
    assert.equal(y[0],other.address);assert.equal(y[1],300n);
    const factoryAddress=await factory.getAddress();
    await reverts(()=>creator.sendTransaction({to:factoryAddress,value:1n}));
    assert.equal(await ethers.provider.getBalance(await factory.getAddress()),0n);
  });
  it("unsafe receivers revert atomically with unchanged mint counters",async function(){
    const Reject=await ethers.getContractFactory("RejectingReceiver");
    const receiver=await Reject.deploy();await receiver.waitForDeployment();
    const target=await receiver.getAddress();
    const a=await create721(factory,creator);
    const b=await create1155(factory,creator);
    await reverts(()=>a.c.connect(creator).mintReserved(target));
    await reverts(()=>b.c.connect(creator).mintReserved(target,3n,2n));
    assert.equal(await a.c.totalMinted(),0n);
    assert.equal(await b.c.totalMinted(),0n);
    assert.equal(await b.c.mintedById(3n),0n);
  });
});
