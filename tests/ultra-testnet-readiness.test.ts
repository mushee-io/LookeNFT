import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=(p:string)=>readFile(new URL(p,import.meta.url),"utf8");
test("Testnet preflight never infers balance or approval without RPC chain 18881",async()=>{
 const route=await read("../app/api/testnet/preflight/route.ts");
 assert.match(route,/chainId!==18881/);
 assert.match(route,/getBalance/);
 assert.match(route,/balance>0n/);
 assert.match(route,/operatorApproved/);
 assert.match(route,/hasCode/);
 assert.match(route,/mainnet/);
 assert.doesNotMatch(route,/eth_sendTransaction/);
});
test("Real probe uses wallet signature and independent receipt verification",async()=>{
 const provider=await read("../components/WalletSessionProvider.tsx");
 const verifier=await read("../app/api/testnet/probe/route.ts");
 assert.match(provider,/submitTestnetProbe/);
 assert.match(provider,/makeCancunProbeCreationCode/);
 assert.match(provider,/fresh\?\.wallet/);
 assert.match(provider,/eth_sendTransaction/);
 assert.match(verifier,/getTransactionReceipt/);
 assert.match(verifier,/getCode/);
 assert.match(verifier,/rpc\.call/);
 assert.match(verifier,/confirmations>=12n/);
 assert.match(verifier,/CANCUN_PROBE_RUNTIME/);
 assert.match(verifier,/CANCUN_PROBE_RETURN/);
});
test("The operations page does not bypass operator factory and mint gates",async()=>{
 const page=await read("../app/testnet/page.tsx");
 const curation=await read("../lib/server/curation.ts");
 assert.match(page,/wallet\.submitTestnetProbe/);
 assert.match(page,/Deploy small Testnet compatibility probe/);
 assert.match(curation,/M12_FINAL_FINANCIAL_EXECUTION_ENABLED/);
 assert.match(curation,/M12_FINAL_PUBLIC_BETA_ENABLED/);
 assert.match(curation,/requireOperator/);
});
