import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ipfsGateway,trustedGateway} from "../lib/server/chain-token-fallback";

const metadata="ipfs://bafybeibeourtlr5nen7yoqofkvbzfpnbi7xe66e6wxbmrv4luarobcb4n4/metadata/1";
const image="ipfs://bafybeieaahkuyos7dnlvjknya5viag7mo3dl62fmyhx2dyewtpeztzh6ey/00001.png";
const gateway="amethyst-wrong-sparrow-956.mypinata.cloud";
test("only IPFS CID paths resolve through an approved gateway",()=>{
 assert.equal(ipfsGateway(metadata,gateway),
  "https://"+gateway+"/ipfs/bafybeibeourtlr5nen7yoqofkvbzfpnbi7xe66e6wxbmrv4luarobcb4n4/metadata/1");
 assert.equal(ipfsGateway(image,gateway),
  "https://"+gateway+"/ipfs/bafybeieaahkuyos7dnlvjknya5viag7mo3dl62fmyhx2dyewtpeztzh6ey/00001.png");
 for(const value of ["http://localhost/secret","ipfs://../../secret",
  "ipfs://bafybeibeourtlr5nen7yoqofkvbzfpnbi7xe66e6wxbmrv4luarobcb4n4/../secret",
  "ipfs://bafybeibeourtlr5nen7yoqofkvbzfpnbi7xe66e6wxbmrv4luarobcb4n4//evil",
  "file:///etc/passwd"]){assert.equal(ipfsGateway(value,gateway),null);}
});
test("unknown cover host cannot choose a gateway",()=>{
 assert.equal(trustedGateway("https://"+gateway+"/ipfs/x.png"),gateway);
 assert.equal(trustedGateway("https://"+gateway+".attacker.example/ipfs/x.png"),"gateway.pinata.cloud");
 assert.equal(trustedGateway("http://"+gateway+"/ipfs/x.png"),"gateway.pinata.cloud");
 assert.equal(trustedGateway(null),"gateway.pinata.cloud");
});
test("collection fallback uses contract code hash and ownerOf, not invented events",async()=>{
 const fallback=await readFile(new URL("../lib/server/chain-token-fallback.ts",import.meta.url),"utf8");
 const endpoint=await readFile(new URL("../app/api/nfts/tokens/route.ts",import.meta.url),"utf8");
 const page=await readFile(new URL("../app/collection/[address]/page.tsx",import.meta.url),"utf8");
 assert.match(fallback,/keccak256\(code\)/);
 assert.match(fallback,/functionName:"totalMinted"/);
 assert.match(fallback,/functionName:"ownerOf"/);
 assert.match(fallback,/functionName:"tokenURI"/);
 assert.match(endpoint,/read-only-on-chain-ownership-snapshot/);
 assert.match(page,/t\.imageUrl/);
 assert.match(page,/Ownership verified on-chain/);
 assert.doesNotMatch(endpoint,/INSERT INTO nft_token_transfers/);
});
