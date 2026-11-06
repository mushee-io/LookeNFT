const assert=require("node:assert/strict");
const fc=require("fast-check");
const {ethers}=require("hardhat");
const {uri721,uri1155,newSalt,reverts,factoryDeploy,create721,create1155}=require("./helpers");

describe("M4 security property tests — local chain only, never real deployments",function(){
  let factory,creator,other;
  beforeEach(async function(){
    [creator,other]=await ethers.getSigners();
    factory=await factoryDeploy();
  });

  it("fuzzes ERC721 exact cap boundary for varying total supplies and royalties",async function(){
    await fc.assert(fc.asyncProperty(
      fc.integer({min:1,max:20}),fc.integer({min:0,max:1000}),
      async (cap,bps)=>{
        const {c}=await create721(factory,creator,{cap:BigInt(cap),bps});
        assert.equal(await c.maxSupply(),BigInt(cap));
        for(let i=0;i<cap;i++) await(await c.connect(creator).mintReserved(creator.address)).wait();
        assert.equal(await c.totalMinted(),BigInt(cap));
        await reverts(()=>c.connect(creator).mintReserved(creator.address),"SupplyCapExceeded");
        const royalty=await c.royaltyInfo(1n,10000n);
        assert.equal(royalty[1],BigInt(bps));
      }),
      {numRuns:12}
    );
  });

  it("fuzzes ERC1155 total and per-ID caps across independent tokens",async function(){
    await fc.assert(fc.asyncProperty(
      fc.integer({min:1,max:30}),fc.integer({min:1,max:20}),
      async (total,desiredPerId)=>{
        const perId=Math.min(total,desiredPerId);
        const {c}=await create1155(factory,creator,{totalCap:BigInt(total),perIdCap:BigInt(perId)});
        await(await c.connect(creator).mintReserved(creator.address,1n,BigInt(perId))).wait();
        await reverts(()=>c.connect(creator).mintReserved(creator.address,1n,1n),"SupplyCapExceeded");
        let remaining=total-perId, tokenId=2n;
        while(remaining>0){const take=Math.min(remaining,perId);await(await c.connect(creator).mintReserved(creator.address,tokenId,BigInt(take))).wait();remaining-=take;tokenId+=1n;}
        assert.equal(await c.totalMinted(),BigInt(total));
        await reverts(()=>c.connect(creator).mintReserved(creator.address,3n,1n),"SupplyCapExceeded");
      }),
      {numRuns:12}
    );
  });

  it("property: creator-salted CREATE2 predictions cannot be hijacked by alternate signer",async function(){
    await fc.assert(fc.asyncProperty(fc.integer({min:1,max:2147483647}),async(saltNumber)=>{
      const s=ethers.zeroPadValue(ethers.toBeHex(saltNumber),32);
      const alpha=await create721(factory,creator,{salt:s});
      const beta=await create721(factory,other,{salt:s});
      assert.notEqual(alpha.address,beta.address);
      assert.equal(await alpha.c.owner(),creator.address);
      assert.equal(await beta.c.owner(),other.address);
    }),{numRuns:8});
  });
});
