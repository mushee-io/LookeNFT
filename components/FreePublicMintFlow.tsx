"use client";
import {useState} from "react";
import Link from "next/link";
import {createPublicClient,encodeFunctionData,http,parseEventLogs,formatEther,type Address,type Hex} from "viem";
import {useWalletSession} from "@/components/WalletSessionProvider";
import {ULTRA_TESTNET} from "@/lib/network";
import {mintAbi,mintCallAbi} from "@/lib/m5/mint";

const rpc=createPublicClient({transport:http(ULTRA_TESTNET.rpcUrl,{timeout:12000,retryCount:1})});
export default function FreePublicMintFlow({collection,phaseId}:{collection:string;phaseId:string}){
 const wallet=useWalletSession();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [confirmed,setConfirmed]=useState<Hex|null>(null);
 const [status,setStatus]=useState("Free public mint (0 UOS plus Testnet gas)");
 const [qty,setQty]=useState("1");
 async function mint(){
  if(!wallet.address||wallet.chainId!==18881)throw Error("Connect an Ultra EVM Testnet wallet.");
  if(!/^[1-9][0-9]?$/.test(qty)||Number(qty)>20)throw Error("Choose 1–20 NFTs.");
  setBusy(true);setError("");setConfirmed(null);
  try{
   const address=collection as Address,id=BigInt(phaseId),count=BigInt(qty),account=wallet.address as Address;
   const [rpcChain,block,code,phase,nonce,mintedWallet,has721]=await Promise.all([
    rpc.getChainId(),rpc.getBlock(),rpc.getCode({address}),
    rpc.readContract({address,abi:mintAbi,functionName:"mintPhases",args:[id]}),
    rpc.readContract({address,abi:mintAbi,functionName:"mintNonces",args:[id,account]}),
    rpc.readContract({address,abi:mintAbi,functionName:"mintedByWallet",args:[id,account]}),
    rpc.readContract({address,abi:mintAbi,functionName:"supportsInterface",args:["0x80ac58cd"]})
   ]);
   const [start,end,price,walletCap,phaseCap,minted,root,cancelled]=phase;
   if(rpcChain!==18881||!code||code==="0x"||cancelled||
      block.timestamp<start||block.timestamp>end||price!==0n||
      root!=="0x"+"0".repeat(64)||BigInt(walletCap)-mintedWallet<count||
      BigInt(phaseCap)-BigInt(minted)<count)
    throw Error("This free Testnet mint phase is not currently open for your wallet.");
   const deadline=(block.timestamp+600n)<end?(block.timestamp+600n):end;
   const calldata=encodeFunctionData({abi:mintCallAbi,functionName:"mintFromPhase",
     args:[id,has721?0n:1n,count,0n,[],nonce,deadline]});
   setStatus("Confirm the free mint in your wallet. You only pay Testnet gas.");
   const hash=await wallet.submitFreePublicMint(collection,calldata);
   setStatus("Transaction submitted. Checking the Ultra Testnet receipt: "+hash);
   const receipt=await rpc.waitForTransactionReceipt({hash,confirmations:1,timeout:120000});
   if(receipt.status!=="success")throw Error("The mint transaction reverted.");
   const events=parseEventLogs({abi:mintAbi,logs:receipt.logs,eventName:"PhaseMint"});
   if(!events.some(e=>e.address.toLowerCase()===address.toLowerCase()&&
     e.args.phaseId===id&&e.args.minter.toLowerCase()===account.toLowerCase()&&
     e.args.quantity===count&&e.args.payment===0n))
    throw Error("Transaction confirmed, but the expected NFT mint event was not found.");
   setConfirmed(hash);
   setStatus("Success! Your NFT mint is confirmed on Ultra EVM Testnet. Refresh the collection gallery.");
  }catch(e){setError(e instanceof Error?e.message:"Minting failed");setStatus("Mint not confirmed.");}
  finally{setBusy(false);}
 }
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT · ULTRA EVM TESTNET</p>
  <h1>Free NFT mint</h1>
  <p className="interior-copy">This collection's free public phase is verified on-chain. The mint price is <strong>{formatEther(0n)} UOS</strong>. Your wallet only pays Testnet gas. No NFT is minted without your approval.</p>
  <p>Collection: <code>{collection}</code> · Phase #{phaseId}</p>
  <label>Quantity <input type="number" min={1} max={20} value={qty} onChange={e=>setQty(e.target.value)}/></label>
  <button type="button" disabled={busy||wallet.pending||!wallet.address||wallet.chainId!==18881}
   onClick={()=>void mint()}>{busy?"Verifying…":"Mint free NFT (wallet approval)"}</button>
  <p role="status" className="operator-note">{status}</p>
  {confirmed&&<p>Verified mint transaction: <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+confirmed} target="_blank" rel="noopener noreferrer">{confirmed}</a></p>}
  {error&&<p role="alert" className="operator-error">{error}</p>}
  <p><Link href={"/collection/"+collection}>← Back to collection</Link></p>
 </section>;
}
