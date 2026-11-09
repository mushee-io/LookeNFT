import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validateCommunityCoverUrl} from "../lib/server/community-cover";

test("NFT creator edits accept only approved public HTTPS image host URLs",()=>{
 const image="https://sample.mypinata.cloud/ipfs/bafybeiea/cover.png";
 assert.equal(validateCommunityCoverUrl(image),image);
 for(const url of ["http://localhost/image.png","javascript:alert(1)",
  "https://foo.mypinata.cloud.evil.test/pic.png","https://user:pass@sample.mypinata.cloud/pic.png"]){
  assert.throws(()=>validateCommunityCoverUrl(url));
 }
});
test("collection modifications require authenticated current on-chain owner, no operator secret",async()=>{
 const route=await readFile(new URL("../app/api/creator/collections/[address]/route.ts",import.meta.url),"utf8");
 assert.match(route,/guardMutation\(request\)/);
 assert.match(route,/requireSession\(request\)/);
 assert.match(route,/functionName:"owner"/);
 assert.match(route,/owner\.toLowerCase\(\)!==session\.wallet\.toLowerCase\(\)/);
 assert.match(route,/validateCommunityCoverUrl\(body\.coverUrl\)/);
 assert.match(route,/validateCommunityCoverUrl\(body\.avatarUrl\)/);
 assert.match(route,/operator_wallet/);
 assert.match(route,/mintPhases/);
 assert.match(route,/unitPrice/);
 assert.doesNotMatch(route,/LOOKE_NFT_OPERATOR_WALLET|requireOperator/);
});
test("only on-chain free/public mint phases can be activated",async()=>{
 const panel=await readFile(new URL("../components/CollectionManagePanel.tsx",import.meta.url),"utf8");
 const wallet=await readFile(new URL("../components/WalletSessionProvider.tsx",import.meta.url),"utf8");
 const curation=await readFile(new URL("../lib/server/curation.ts",import.meta.url),"utf8");
 const mint=await readFile(new URL("../components/FreePublicMintFlow.tsx",import.meta.url),"utf8");
 assert.match(panel,/scheduleMintPhase/);
 assert.match(panel,/pauseMinting/);
 assert.match(panel,/unpauseMinting/);
 assert.match(panel,/setBaseURI/);
 assert.match(panel,/metadataFrozen/);
 assert.match(panel,/List collection on Explore/);
 assert.match(wallet,/submitCollectionControl/);
 assert.match(wallet,/submitFreePublicMint/);
 assert.match(wallet,/price!==0n/);
 assert.match(wallet,/safeCreatorMintGas/);
 assert.match(curation,/rpc\.readContract/);
 assert.match(curation,/block.timestamp>=start&&block.timestamp<=end/);
 assert.match(curation,/mintAvailable=true/);
 assert.match(curation,/functionName:"phaseCount"/);
 assert.match(mint,/wallet\.submitFreePublicMint/);
 assert.match(mint,/PhaseMint/);
 assert.match(mint,/receipt\.status!=="success"/);
});
test("Public owner listing is separate from unverified NFT sale settlement",async()=>{
 const page=await readFile(new URL("../app/collection/[address]/page.tsx",import.meta.url),"utf8");
 const market=await readFile(new URL("../app/market/page.tsx",import.meta.url),"utf8");
 assert.match(page,/CollectionManagePanel/);
 assert.match(page,/NFTSaleEntry/);
 const sale=await readFile(new URL("../components/NFTSaleEntry.tsx",import.meta.url),"utf8");
 assert.match(sale,/List NFT for sale/);
 assert.match(sale,/m7Gate\("list"\)/);
 assert.match(page,/Artwork unavailable/);
 assert.match(market,/query\.get\("collection"\)/);
 const schema=await readFile(new URL("../db/migrations/012_creator_collection_appearance.sql",import.meta.url),"utf8");
 assert.match(schema,/ADD COLUMN IF NOT EXISTS avatar_url/);
});
