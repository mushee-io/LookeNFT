import { NextRequest } from "next/server";
import {createPublicClient,http,isAddress} from "viem";
import {ULTRA_TESTNET} from "@/lib/network";
import {
 CANCUN_PROBE_RUNTIME,CANCUN_PROBE_RETURN,makeCancunProbeCreationCode
} from "@/lib/testnet/probe";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:0})});
const cache={"Cache-Control":"no-store, max-age=0"};

export async function GET(request:NextRequest){
 const hash=request.nextUrl.searchParams.get("hash")||"";
 const wallet=request.nextUrl.searchParams.get("wallet")||"";
 if(!/^0x[0-9a-fA-F]{64}$/.test(hash)||!isAddress(wallet,{strict:false}))
  return Response.json({error:"Valid transaction hash and wallet required"},{status:400,headers:cache});
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK==="mainnet")
  return Response.json({error:"Probe verification is Testnet-only"},{status:403,headers:cache});
 try{
  const chain=await rpc.getChainId();
  if(chain!==18881)throw Error("RPC chain mismatch: expected Ultra 18881");
  const [tx,receipt,head]=await Promise.all([
   rpc.getTransaction({hash:hash as `0x${string}`}),
   rpc.getTransactionReceipt({hash:hash as `0x${string}`}),
   rpc.getBlockNumber()
  ]);
  if(tx.chainId!==18881||tx.from.toLowerCase()!==wallet.toLowerCase()||
     tx.to!==null||tx.input.toLowerCase()!==makeCancunProbeCreationCode().toLowerCase())
   throw Error("Transaction is not the expected Testnet-only wallet-signed Cancun probe");
  if(receipt.status!=="success"||!receipt.contractAddress)
   throw Error("Probe transaction has no successful contract deployment receipt");
  const confirmations=head>=receipt.blockNumber?head-receipt.blockNumber+1n:0n;
  const code=await rpc.getCode({address:receipt.contractAddress});
  if(code?.toLowerCase()!==CANCUN_PROBE_RUNTIME.toLowerCase())
   throw Error("Confirmed contract runtime does not match the expected smoke probe");
  const called=await rpc.call({to:receipt.contractAddress,data:"0x"});
  if(called.data?.toLowerCase()!==CANCUN_PROBE_RETURN.toLowerCase())
   throw Error("Deployed Cancun runtime did not return expected value 42");
  return Response.json({
   verified:confirmations>=12n,
   chainId:18881,
   transactionHash:hash,
   contractAddress:receipt.contractAddress,
   confirmations:confirmations.toString(),requiredConfirmations:12,
   opcodeProof:{push0:true,mcopy:true,returned42:true},
   status:confirmations>=12n?"confirmed-probe":"awaiting-12-confirmations",
   warning:"This is an operator-approved on-chain probe, NOT an independent security audit, live factory deployment or mint approval."
  },{headers:cache});
 }catch(e){
  return Response.json({
   verified:false,chainId:18881,
   error:e instanceof Error?e.message.slice(0,300):"Unable to verify Ultra Testnet probe"
  },{status:503,headers:cache});
 }
}
