import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlan, tokenMetadata, type TraitLayer } from "../lib/generative/engine";

const layers: TraitLayer[] = [
  { id:"base", name:"Faces", variants:Array.from({length:24},(_,i)=>({
    id:"f"+i,name:"Face "+i,weight:i===23?1:10
  })) },
  { id:"eyes", name:"Eyes", variants:Array.from({length:24},(_,i)=>({
    id:"e"+i,name:"Eyes "+i,weight:i===23?1:10
  })) },
  { id:"hat", name:"Hats", variants:Array.from({length:20},(_,i)=>({
    id:"h"+i,name:"Hat "+i,weight:i===19?1:10
  })) }
];
test("generates reproducible 10,000 distinct punk trait combinations",()=>{
  const p=generatePlan(layers,10000,"UltraPunks-2026");
  const other=generatePlan(layers,10000,"UltraPunks-2026");
  assert.equal(p.tokens.length,10000);
  assert.equal(new Set(p.tokens.map(t=>t.picks.join(","))).size,10000);
  assert.deepEqual(p.tokens.slice(0,30),other.tokens.slice(0,30));
  assert.equal(new Set(p.ranks).size,10000);
  for (const row of p.counts) assert.equal(row.reduce((a,b)=>a+b,0),10000);
  const m=tokenMetadata("Ultra Punks","Free mint",layers,p,0);
  assert.equal(m.name,"Ultra Punks #1");
  assert.match(m.image,/REPLACE_WITH_REAL_IMAGES_CID/);
  assert.equal(m.attributes.length,3);
});
test("saturated combinations still generate all assets without duplicates",()=>{
  const l:TraitLayer[]=[
    {id:"a",name:"Face",variants:Array.from({length:50},(_,i)=>({id:"a"+i,name:String(i),weight:i===0?1000:1}))},
    {id:"b",name:"Accessory",variants:Array.from({length:50},(_,i)=>({id:"b"+i,name:String(i),weight:i===0?1000:1}))}
    ,    {id:"c",name:"Background",variants:Array.from({length:4},(_,i)=>({id:"c"+i,name:String(i),weight:10}))}
  ];
  const p=generatePlan(l,10000,"all");
  assert.equal(new Set(p.tokens.map(t=>t.picks.join(","))).size,10000);
});
test("rejects 10,000 supply when traits cannot yield 10,000 unique NFTs",()=>{
  assert.throws(()=>generatePlan(layers.slice(0,2),10000,"test"),/distinct combinations/);
  assert.throws(()=>generatePlan(layers,10001,"test"),/10,000/);
  assert.throws(()=>generatePlan(layers,1000,""),/seed/);
});
test("rarity weights and duplicate trait names fail closed",()=>{
  const bad=structuredClone(layers);
  bad[0].variants[0].weight=-1;
  assert.throws(()=>generatePlan(bad,100,"test"),/Rarity weight/);
  const badNames=structuredClone(layers);
  badNames[0].variants[0].name=badNames[0].variants[1].name;
  assert.throws(()=>generatePlan(badNames,100,"test"),/Duplicate variation/);
});
