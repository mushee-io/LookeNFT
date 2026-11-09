import { NextRequest } from "next/server";
import { createPublicClient, formatEther, http, isAddress } from "viem";
import { ULTRA_TESTNET } from "@/lib/network";
import { operatorAddress } from "@/lib/server/curation";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:0})});
const noCache={"Cache-Control":"no-store, max-age=0"};

export async function GET(request:NextRequest){
 const wallet=request.nextUrl.searchParams.get("wallet")||"";
 if(!isAddress(wallet,{strict:false}))
  return Response.json({error:"Valid 0x wallet address required"},{status:400,headers:noCache});
 if(process.env.NEXT_PUBLIC_ULTRA_NETWORK==="mainnet")
  return Response.json({error:"LookeNFT Testnet checks blocked because mainnet mode is enabled"},{status:503,headers:noCache});
 try{
  const chainId=await rpc.getChainId();
  if(chainId!==18881)return Response.json({
   error:"RPC chain mismatch",expectedChainId:18881,receivedChainId:chainId
  },{status:503,headers:noCache});
  const [balance,block,gasPrice]=await Promise.all([
   rpc.getBalance({address:wallet}),rpc.getBlockNumber(),rpc.getGasPrice()
  ]);
  const operator=operatorAddress();
  const factory=process.env.LOOKE_NFT_OWNER_FACTORY_ADDRESS||"";
  let factoryCodePresent=false;
  if(isAddress(factory,{strict:false})){
   const code=await rpc.getCode({address:factory});
   factoryCodePresent=!!code&&code!=="0x";
  }
  return Response.json({
   network:"Ultra EVM Testnet",chainId,blockNumber:block.toString(),
   rpcUrl:ULTRA_TESTNET.rpcUrl,
   rpcOnline:true,wallet:{
    address:wallet,balanceWei:balance.toString(),balanceUos:formatEther(balance),
    funded:balance>0n,operatorApproved:operator?.toLowerCase()===wallet.toLowerCase()
   },factory:{configured:isAddress(factory,{strict:false}),hasCode:factoryCodePresent},
   gasPriceWei:gasPrice.toString(),
   opcodeVerification:"Real wallet-confirmed probe transaction required; not verified by a read-only balance check",
   releaseStatus:"NO-GO: factory, wallet-probe, source review, and mint approval are separate gates"
  },{headers:noCache});
 }catch(e){
  return Response.json({
   network:"Ultra EVM Testnet",chainId:18881,rpcOnline:false,
   error:"Unable to verify Ultra EVM Testnet directly from server. No balance, contract or release approval inferred.",
   reason:e instanceof Error?e.message.slice(0,250):"RPC unavailable"
  },{status:503,headers:noCache});
 }
}
