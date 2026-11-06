import test from "node:test";
import assert from "node:assert/strict";
import { TESTNET_CHAIN_ID, CANCUN_PROBE_RUNTIME, CANCUN_PROBE_RETURN,
  makeCancunProbeCreationCode,isExpectedCancunProbeRuntime,
  isExpectedCancunProbeResult,isFundedForGas } from "../lib/testnet/probe";

test("minimal probe targets 18881 and contains PUSH0 and MCOPY",()=>{
 assert.equal(TESTNET_CHAIN_ID,18881);
 const code=makeCancunProbeCreationCode();
 assert.ok(code.startsWith("0x60"));
 assert.ok(code.endsWith(CANCUN_PROBE_RUNTIME.slice(2)));
 assert.ok(CANCUN_PROBE_RUNTIME.includes("5f"));
 assert.ok(CANCUN_PROBE_RUNTIME.includes("5e"));
 assert.equal(Number.parseInt(code.slice(4,6),16),CANCUN_PROBE_RUNTIME.slice(2).length/2);
 assert.equal(Number.parseInt(code.slice(8,10),16),12);
 assert.equal(CANCUN_PROBE_RETURN.length,66);
 assert.equal(isExpectedCancunProbeRuntime(CANCUN_PROBE_RUNTIME),true);
 assert.equal(isExpectedCancunProbeRuntime("0x"),false);
 assert.equal(isExpectedCancunProbeResult(CANCUN_PROBE_RETURN),true);
});
test("funding check uses confirmed wei instead of screenshots",()=>{
 assert.equal(isFundedForGas(0n),false);
 assert.equal(isFundedForGas(1n),true);
});
