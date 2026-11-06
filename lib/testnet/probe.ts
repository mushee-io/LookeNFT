/**
 * Minimal TESTNET ONLY smoke probe: deployed runtime requires PUSH0 (Shanghai)
 * and MCOPY (Cancun), and must return uint256(42). No transfers, minting or owner.
 */
export const TESTNET_CHAIN_ID = 18881 as const;
export const CANCUN_PROBE_RUNTIME = "0x602a5f5260205f60205e60206020f3" as const;
export const CANCUN_PROBE_RETURN = ("0x" + "0".repeat(62) + "2a") as `0x${string}`;
function byteHex(value:number):string {
 if(!Number.isInteger(value)||value<0||value>255)throw Error("Invalid byte");
 return value.toString(16).padStart(2,"0");
}
export function makeCancunProbeCreationCode(): `0x${string}` {
 const runtime=CANCUN_PROBE_RUNTIME.slice(2);
 const len=runtime.length/2;
 // 12-byte init prefix: PUSH1(len), PUSH1(12), PUSH1(0), CODECOPY,
 // PUSH1(len), PUSH1(0), RETURN, then the runtime.
 return ("0x60"+byteHex(len)+"600c60003960"+byteHex(len)+"6000f3"+runtime) as `0x${string}`;
}
export function isExpectedCancunProbeRuntime(code:string):boolean{
 return code.toLowerCase()===CANCUN_PROBE_RUNTIME.toLowerCase();
}
export function isExpectedCancunProbeResult(code:string):boolean{
 return code.toLowerCase()===CANCUN_PROBE_RETURN.toLowerCase();
}
export function isFundedForGas(balanceWei:bigint):boolean{return balanceWei>0n;}
