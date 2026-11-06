const assert=require("node:assert/strict");
const {ethers}=require("hardhat");
const {reverts,factoryDeploy,create721,create1155}=require("./helpers");
const ONE=ethers.parseEther("1");
const ZERO=ethers.ZeroHash;
async function now(){return Number((await ethers.provider.getBlock("latest")).timestamp);}
async function phase(c,owner,{price=0n,walletCap=5,cap=30,root=ZERO,start,end}={}){
  const t=await now(),from=start??t-5,until=end??t+3600;
  await(await c.connect(owner).scheduleMintPhase(from,until,price,walletCap,cap,root)).wait();
  return {id:await c.phaseCount(),expires:BigInt(until-1),start:from,end:until};
}
async function buy(c,wallet,p,{tokenId=0n,qty=1n,nonce=0n,allowance=0n,proof=[],value=0n,deadline=p.expires}={}){
  return c.connect(wallet).mintFromPhase(p.id,tokenId,qty,allowance,proof,nonce,deadline,{value});
}
function rootPair(a,b){return ethers.keccak256(ethers.concat([a,b].sort()));}
describe("M5 mint policy: local Hardhat Cancun VM, not live Testnet",function(){
  let factory,creator,alice,bob;
  beforeEach(async function(){[creator,alice,bob]=await ethers.getSigners();factory=await factoryDeploy();});
  it("inactive initially; creator-only scheduling; bounded phase parameters",async function(){
    const {c}=await create721(factory,creator);
    const t=await now();
    await reverts(()=>buy(c,alice,{id:1n,expires:BigInt(t+3600)}),"BadMintPhase");
    await reverts(()=>c.connect(alice).scheduleMintPhase(t,t+3600,0n,5,10,ZERO),"OwnableUnauthorizedAccount");
    await reverts(()=>c.connect(creator).scheduleMintPhase(t+100,t+10,0n,5,10,ZERO),"BadMintPhase");
    await reverts(()=>c.connect(creator).scheduleMintPhase(t,t+3600,ethers.parseEther("1001"),5,10,ZERO),"BadMintPhase");
    await reverts(()=>c.connect(creator).scheduleMintPhase(t,t+3600,0n,11,10,ZERO),"BadMintPhase");
    const p=await phase(c,creator,{price:ONE,cap:10});
    assert.equal(p.id,1n);
    assert.equal((await c.mintPhases(p.id)).unitPrice,ONE);
    await reverts(()=>c.connect(alice).cancelMintPhase(p.id),"OwnableUnauthorizedAccount");
  });
  it("ERC721 exact UOS price, nonce replay, deadlines, per wallet and phase cap",async function(){
    const {c}=await create721(factory,creator,{cap:5n});
    const p=await phase(c,creator,{price:ONE,walletCap:2,cap:3});
    await reverts(()=>buy(c,alice,p,{value:ONE-1n}),"IncorrectMintPayment");
    await reverts(()=>buy(c,alice,p,{value:ONE,nonce:1n}),"InvalidMintNonce");
    await reverts(()=>buy(c,alice,p,{value:ONE,deadline:0n}),"MintRequestExpired");
    await reverts(()=>buy(c,alice,p,{value:ONE,tokenId:1n}),"InvalidMintQuantity");
    const receipt=await(await buy(c,alice,p,{qty:2n,value:2n*ONE})).wait();
    const logs=receipt.logs.flatMap(l=>{try{return [c.interface.parseLog(l)]}catch{return []}});
    const event=logs.find(l=>l?.name==="PhaseMint");
    assert.ok(event);assert.equal(event.args.payment,2n*ONE);assert.equal(event.args.nonce,0n);
    assert.equal(await c.ownerOf(1n),alice.address);
    assert.equal(await c.ownerOf(2n),alice.address);
    assert.equal(await c.mintedByWallet(p.id,alice.address),2n);
    assert.equal(await c.mintNonces(p.id,alice.address),1n);
    assert.equal(await c.accruedProceeds(),2n*ONE);
    await reverts(()=>buy(c,alice,p,{value:ONE,nonce:0n}),"InvalidMintNonce");
    await reverts(()=>buy(c,alice,p,{value:ONE,nonce:1n}),"WalletMintCapExceeded");
    await(await buy(c,bob,p,{value:ONE})).wait();
    await reverts(()=>buy(c,bob,p,{value:ONE,nonce:1n}),"MintSupplyExceeded");
    assert.equal(await c.totalMinted(),3n);
  });
  it("Merkle proof binds allowlist wallet, phase, collection and allowance",async function(){
    const {c}=await create721(factory,creator,{cap:10n});
    const leafA=await c.allowlistLeaf(1n,alice.address,2n);
    const leafB=await c.allowlistLeaf(1n,bob.address,1n);
    const root=rootPair(leafA,leafB);
    const p=await phase(c,creator,{root,cap:10,walletCap:3});
    await reverts(()=>buy(c,alice,p,{allowance:2n,proof:[]}),"InvalidAllowlistProof");
    await reverts(()=>buy(c,alice,p,{allowance:3n,proof:[leafB]}),"InvalidAllowlistProof");
    await reverts(()=>buy(c,bob,p,{allowance:2n,proof:[leafB]}),"InvalidAllowlistProof");
    await(await buy(c,alice,p,{allowance:2n,proof:[leafB],qty:2n})).wait();
    await reverts(()=>buy(c,alice,p,{allowance:2n,proof:[leafB],nonce:1n}),"InvalidAllowlistProof");
    await(await buy(c,bob,p,{allowance:1n,proof:[leafA]})).wait();
    assert.equal(await c.ownerOf(3n),bob.address);
    const another=await create721(factory,creator,{cap:10n});
    const q=await phase(another.c,creator,{root,cap:10});
    await reverts(()=>buy(another.c,alice,q,{allowance:2n,proof:[leafB]}),"InvalidAllowlistProof");
  });
  it("ERC1155 reserved and public mints share lifetime global and token-ID limits",async function(){
    const {c}=await create1155(factory,creator,{totalCap:10n,perIdCap:5n});
    await(await c.connect(creator).mintReserved(creator.address,5n,3n)).wait();
    const p=await phase(c,creator,{cap:10,walletCap:6});
    await(await buy(c,alice,p,{tokenId:5n,qty:2n})).wait();
    assert.equal(await c.balanceOf(alice.address,5n),2n);
    await reverts(()=>buy(c,bob,p,{tokenId:5n}),"SupplyCapExceeded");
    await(await buy(c,bob,p,{tokenId:6n,qty:5n})).wait();
    assert.equal(await c.totalMinted(),10n);
    await reverts(()=>buy(c,bob,p,{tokenId:7n,nonce:1n}),"SupplyCapExceeded");
  });
  it("lifetime per-wallet cap across phases and phase cancellation",async function(){
    const {c}=await create1155(factory,creator,{totalCap:1500n,perIdCap:1500n});
    const p=await phase(c,creator,{walletCap:1000,cap:1100});
    await(await buy(c,alice,p,{tokenId:8n,qty:1000n})).wait();
    assert.equal(await c.lifetimeMintedByWallet(alice.address),1000n);
    const q=await phase(c,creator,{walletCap:100,cap:100});
    await reverts(()=>buy(c,alice,q,{tokenId:8n}),"WalletMintCapExceeded");
    await(await c.connect(creator).cancelMintPhase(q.id)).wait();
    await reverts(()=>buy(c,bob,q,{tokenId:9n}),"MintInactive");
  });
  it("overpayment returns UOS; only creator can withdraw accrued proceeds",async function(){
    const {c}=await create721(factory,creator);
    const p=await phase(c,creator,{price:ONE,cap:3});
    const receipt=await(await buy(c,alice,p,{value:3n*ONE})).wait();
    const event=receipt.logs.flatMap(l=>{try{return [c.interface.parseLog(l)]}catch{return []}}).find(l=>l?.name==="PhaseMint");
    assert.equal(event.args.refund,2n*ONE);
    assert.equal(await ethers.provider.getBalance(await c.getAddress()),ONE);
    assert.equal(await c.accruedProceeds(),ONE);
    await reverts(()=>c.connect(bob).withdrawProceeds(bob.address,ONE),"OwnableUnauthorizedAccount");
    await reverts(()=>c.connect(creator).withdrawProceeds(creator.address,2n*ONE),"WithdrawAmountExceedsProceeds");
    const before=await ethers.provider.getBalance(bob.address);
    await(await c.connect(creator).withdrawProceeds(bob.address,ONE)).wait();
    assert.equal(await ethers.provider.getBalance(bob.address)-before,ONE);
    assert.equal(await c.accruedProceeds(),0n);
  });
  it("ERC721 receiver callback cannot reenter, rejected refund reverts entire transaction",async function(){
    const {c}=await create721(factory,creator,{cap:10n});
    const p=await phase(c,creator,{price:ONE,cap:10});
    const Attack=await ethers.getContractFactory("MintAdversary");
    const attacker=await Attack.deploy();await attacker.waitForDeployment();
    await(await attacker.configure(await c.getAddress(),p.id,p.expires,false)).wait();
    await(await attacker.connect(alice).buy(0n,{value:ONE})).wait();
    assert.equal(await attacker.reentered(),true);
    assert.equal(await c.totalMinted(),1n);
    const refusing=await Attack.deploy();await refusing.waitForDeployment();
    await(await refusing.configure(await c.getAddress(),p.id,p.expires,true)).wait();
    await reverts(()=>refusing.connect(alice).buy(0n,{value:2n*ONE}),"NativeTransferFailed");
    assert.equal(await c.totalMinted(),1n);
    assert.equal(await c.mintNonces(p.id,await refusing.getAddress()),0n);
  });
  it("start/end windows, user deadlines and owner pause fail closed",async function(){
    const {c}=await create721(factory,creator);
    const t=await now(),p=await phase(c,creator,{start:t+15,end:t+60});
    await reverts(()=>buy(c,alice,p),"MintInactive");
    await ethers.provider.send("evm_setNextBlockTimestamp",[t+16]);
    await ethers.provider.send("evm_mine",[]);
    await(await c.connect(creator).pauseMinting()).wait();
    await reverts(()=>buy(c,alice,p),"EnforcedPause");
    await(await c.connect(creator).unpauseMinting()).wait();
    await reverts(()=>buy(c,alice,p,{deadline:BigInt(t+61)}),"MintRequestExpired");
    await ethers.provider.send("evm_setNextBlockTimestamp",[t+62]);
    await ethers.provider.send("evm_mine",[]);
    await reverts(()=>buy(c,alice,p),"MintInactive");
  });
});
