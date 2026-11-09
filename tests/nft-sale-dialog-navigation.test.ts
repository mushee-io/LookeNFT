import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("each NFT opens a real interactive sale dialog rather than only a route link",async()=>{
  const component=await readFile(new URL("../components/NFTSaleEntry.tsx",import.meta.url),"utf8");
  const collection=await readFile(new URL("../app/collection/[address]/page.tsx",import.meta.url),"utf8");
  assert.match(collection,/<NFTSaleEntry collection=\{drop\.address\} tokenId=\{t\.tokenId\}/);
  assert.match(component,/onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(component,/createPortal\(/);
  assert.match(component,/role="dialog"/);
  assert.match(component,/Asking price \(UOS\)/);
  assert.match(component,/m7Gate\("list"\)/);
  assert.match(component,/Live listings are not available yet/);
  assert.match(component,/No NFT is transferred|never transfers your NFT/);
  assert.match(component,/document\.body/);
});
test("sale form carries selected contract, token id and price to seller review",async()=>{
  const component=await readFile(new URL("../components/NFTSaleEntry.tsx",import.meta.url),"utf8");
  const market=await readFile(new URL("../app/market/page.tsx",import.meta.url),"utf8");
  assert.match(component,/new URLSearchParams\(\{ collection, tokenId, price \}\)/);
  assert.match(component,/#seller-listing/);
  assert.match(market,/const price=query\.get\("price"\)/);
  assert.match(market,/unitPriceUOS:validPrice\?price/);
  assert.match(market,/id="seller-listing"/);
  assert.match(market,/disabled=\{Boolean\(gateList\)/);
});
