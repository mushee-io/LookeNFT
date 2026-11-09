import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=(path:string)=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("Testnet cleanup uses reversible archive, not deleting on-chain NFTs",async()=>{
 const migration=await source("db/migrations/013_testnet_collection_cleanup.sql");
 const api=await source("app/api/creator/collections/[address]/route.ts");
 const curator=await source("lib/server/curation.ts");
 assert.match(migration,/ADD COLUMN IF NOT EXISTS archived_at/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS looke_hidden_testnet_tokens/);
 assert.match(api,/export async function DELETE/);
 assert.match(api,/guardMutation\(request\)/);
 assert.match(api,/requireSession\(request\)/);
 assert.match(api,/functionName:"owner"/);
 assert.match(api,/owner\.toLowerCase\(\)!==session\.wallet\.toLowerCase\(\)/);
 assert.match(api,/body\.confirm!==user\.address/);
 assert.match(api,/archived_at=COALESCE\(archived_at,now\(\)\)/);
 assert.match(api,/archived_at=NULL,status='draft'/);
 assert.match(api,/mint_enabled=FALSE/);
 assert.match(api,/if\(user\.archivedAt\)/);
 assert.match(curator,/c\.archived_at IS NULL/);
 assert.doesNotMatch(api,/DELETE FROM (?:nft_collections|nft_token_transfers)/);
});

test("Hiding one ERC721 checks the contract owner and the NFT owner on-chain",async()=>{
 const api=await source("app/api/creator/collections/[address]/tokens/[tokenId]/route.ts");
 const read=await source("app/api/nfts/tokens/route.ts");
 assert.match(api,/guardMutation\(request\)/);
 assert.match(api,/requireSession\(request\)/);
 assert.match(api,/token_standard!=="erc721"/);
 assert.match(api,/functionName:"ownerOf"/);
 assert.match(api,/tokenOwner\.toLowerCase\(\)!==session\.wallet\.toLowerCase\(\)/);
 assert.match(api,/ON CONFLICT\(chain_id,contract_address,token_id\)/);
 assert.match(read,/current\?\.toLowerCase\(\)===row\.hidden_by/);
 assert.match(read,/ownerCanSee\|\|!suppressed\.has\(t\.tokenId\)/);
 assert.match(read,/authenticatedCollectionOwner/);
 assert.match(read,/Collection removed from LookeNFT/);
});

test("Owner UI clearly differentiates delete-from-app, hide, and onchain burn",async()=>{
 const panel=await source("components/CollectionManagePanel.tsx");
 const page=await source("app/collection/[address]/page.tsx");
 const contract=await source("contracts/Looke721Collection.sol");
 assert.match(panel,/Delete collection from LookeNFT/);
 assert.match(panel,/DELETE /);
 assert.match(panel,/Restore collection as private draft/);
 assert.match(page,/Hide NFT from gallery/);
 assert.match(page,/Restore NFT to gallery/);
 assert.match(page,/drop\.archived/);
 assert.match(page,/canManageTokens/);
 assert.doesNotMatch(contract,/function burn\(/);
});


test("Explore collection cards expose a separate owner-confirmed Testnet delete action",async()=>{
 const explore=await source("app/explore/page.tsx");
 const backend=await source("app/api/creator/collections/[address]/route.ts");
 assert.match(explore,/curated-card-shell/);
 assert.match(explore,/Delete collection/);
 assert.match(explore,/role="dialog" aria-modal="true"/);
 assert.match(explore,/DELETE "\+deleteTarget\.title/);
 assert.match(explore,/wallet\.authenticated/);
 assert.match(explore,/wallet\.chainId!==18881/);
 assert.match(explore,/method:"DELETE"/);
 assert.match(explore,/confirm:deleteTarget\.address\.toLowerCase\(\)/);
 assert.match(explore,/setCollections\(old=>old\.filter/);
 assert.match(explore,/does <strong>not<\/strong> burn NFTs/);
 assert.match(backend,/owner\.toLowerCase\(\)!==session\.wallet\.toLowerCase\(\)/);
 assert.match(backend,/archived_at=COALESCE\(archived_at,now\(\)\)/);
});
