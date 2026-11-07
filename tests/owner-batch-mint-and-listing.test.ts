import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("owner batch mint is guarded by Ultra EVM on-chain supply, wallet caps and receipts",async()=>{
 const panel=await readFile(new URL("../components/CollectionManagePanel.tsx",import.meta.url),"utf8");
 assert.match(panel,/Mint all remaining NFTs to my wallet/);
 assert.match(panel,/maxSupply-info\.totalMinted/);
 assert.match(panel,/remaining>20n/);
 assert.match(panel,/functionName:"scheduleMintPhase"/);
 assert.match(panel,/functionName:"mintedByWallet"/);
 assert.match(panel,/functionName:"mintNonces"/);
 assert.match(panel,/functionName:"mintFromPhase"/);
 assert.match(panel,/wallet\.submitFreePublicMint/);
 assert.match(panel,/waitForTransactionReceipt/);
 assert.match(panel,/event\.args\.quantity===remaining/);
 assert.match(panel,/Anyone can mint from an open public phase/);
 assert.match(panel,/phaseCap/);
});
test("individual NFT listing deep-links into a seller form and explains gated trading",async()=>{
 const page=await readFile(new URL("../app/collection/[address]/page.tsx",import.meta.url),"utf8");
 const market=await readFile(new URL("../app/market/page.tsx",import.meta.url),"utf8");
 assert.match(page,/tokenId=.*seller-listing/);
 assert.match(market,/listingTarget/);
 assert.match(market,/id="seller-listing"/);
 assert.match(market,/Sales are not yet enabled/);
 assert.match(market,/setDraft\(current=>/);
 assert.match(market,/gateList/);
});
