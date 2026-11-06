const assert=require("node:assert/strict");
const fc=require("fast-check");
const {ethers}=require("hardhat");
const {reverts,factoryDeploy,create721,create1155}=require("./helpers");

async function schedule(c,owner,price,perWallet,phaseCap){
  const t=Number((await ethers.provider.getBlock("latest")).timestamp);
  await(await c.connect(owner).scheduleMintPhase(t-1,t+3600,price,perWallet,phaseCap,ethers.ZeroHash)).wait();
  return BigInt(t+3599);
}

describe("M5 property/fuzz invariants — synthetic local chain",function(){
  let factory,creator,alice,bob;
  beforeEach(async function(){[creator,alice,bob]=await ethers.getSigners();factory=await factoryDeploy();});

  it("property: ERC721 payment/refund equals price * minted quantity and cannot replay nonce",async function(){
    await fc.assert(fc.asyncProperty(
      fc.integer({min:1,max:15}),
      fc.integer({min:1,max:4}),
      fc.integer({min:0,max:10000}),
      async(cap,qtyInput,priceInput)=>{
        const qty=Math.min(cap,qtyInput);
        const price=BigInt(priceInput)*10n**12n;
        const {c}=await create721(factory,creator,{cap:BigInt(cap)});
        const deadline=await schedule(c,creator,price,qty,cap);
        const expected=price*BigInt(qty);
        const extra=2n*10n**12n;
        const tx=await c.connect(alice).mintFromPhase(1n,0n,BigInt(qty),0n,[],0n,deadline,{value:expected+extra});
        await tx.wait();
        assert.equal(await c.totalMinted(),BigInt(qty));
        assert.equal(await c.accruedProceeds(),expected);
        assert.equal(await ethers.provider.getBalance(await c.getAddress()),expected);
        assert.equal(await c.mintNonces(1n,alice.address),1n);
        await reverts(()=>c.connect(alice).mintFromPhase(1n,0n,1n,0n,[],0n,deadline,{value:price}),"InvalidMintNonce");
      }),{numRuns:12}
    );
  });
  it("property: ERC1155 phase and per-ID caps never overmint even after reverting",async function(){
    await fc.assert(fc.asyncProperty(
      fc.integer({min:1,max:25}),
      fc.integer({min:1,max:15}),
      async(total,want)=>{
        const amount=Math.min(total,want);
        const {c}=await create1155(factory,creator,{totalCap:BigInt(total),perIdCap:BigInt(amount)});
        const deadline=await schedule(c,creator,0n,total,total);
        await(await c.connect(alice).mintFromPhase(1n,9n,BigInt(amount),0n,[],0n,deadline)).wait();
        assert.equal(await c.mintedById(9n),BigInt(amount));
        assert.equal(await c.totalMinted(),BigInt(amount));
        await reverts(()=>c.connect(alice).mintFromPhase(1n,9n,1n,0n,[],1n,deadline),"SupplyCapExceeded");
        assert.equal(await c.mintedById(9n),BigInt(amount));
        assert.equal(await c.accruedProceeds(),0n);
      }),{numRuns:14}
    );
  });
  it("property: indexed double-hash allowlist leaves differ for phase, wallet or contract",async function(){
    const a=await create721(factory,creator,{cap:10n});
    const b=await create721(factory,creator,{cap:10n});
    await fc.assert(fc.asyncProperty(fc.integer({min:1,max:1000}),async(allowance)=>{
      const x=BigInt(allowance);
      const a1=await a.c.allowlistLeaf(1n,alice.address,x);
      const a2=await a.c.allowlistLeaf(2n,alice.address,x);
      const otherWallet=await a.c.allowlistLeaf(1n,bob.address,x);
      const otherContract=await b.c.allowlistLeaf(1n,alice.address,x);
      assert.notEqual(a1,a2);assert.notEqual(a1,otherWallet);assert.notEqual(a1,otherContract);
    }),{numRuns:20});
  });
});
