"use client";
import {useState} from "react";
import Link from "next/link";
import {ULTRA_TESTNET} from "@/lib/network";
import {useWalletSession} from "@/components/WalletSessionProvider";

type Preflight={
 network:string;chainId:number;rpcOnline:boolean;blockNumber?:string;
 wallet?:{address:string;balanceUos:string;funded:boolean;operatorApproved:boolean};
 factory?:{configured:boolean;hasCode:boolean};
 gasPriceWei?:string;error?:string;reason?:string;
};
type Proof={verified:boolean;transactionHash?:string;contractAddress?:string;
 confirmations?:string;requiredConfirmations?:number;status?:string;error?:string};
const done=(value:boolean|undefined)=>value===true?"Confirmed":"Not verified";

export default function UltraTestnetPage(){
 const wallet=useWalletSession();
 const [check,setCheck]=useState<Preflight|null>(null);
 const [proof,setProof]=useState<Proof|null>(null);
 const [hash,setHash]=useState("");
 const [working,setWorking]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const ready=check?.rpcOnline===true&&check.chainId===18881&&
   check.wallet?.funded===true&&wallet.authenticated&&wallet.chainId===18881&&
   wallet.address?.toLowerCase()===check.wallet.address.toLowerCase();

 async function checkBalance(){
  if(!wallet.address){setError("Connect your EVM wallet first, using the Connect button in the header.");return;}
  setWorking(true);setError("");setCheck(null);setNotice("");
  try{
   const response=await fetch("/api/testnet/preflight?wallet="+encodeURIComponent(wallet.address),{cache:"no-store"});
   const data=await response.json() as Preflight;
   setCheck(data);
   if(!response.ok)throw Error(data.error||"Ultra Testnet preflight failed");
   setNotice("Read-only Testnet check complete. No transaction was sent.");
  }catch(e){setError(e instanceof Error?e.message:"Testnet check failed");}
  finally{setWorking(false);}
 }
 async function submitProbe(){
  if(!ready||working)return;
  setWorking(true);setError("");setProof(null);setNotice("");
  try{
   const submitted=await wallet.submitTestnetProbe();
   setHash(submitted);
   setNotice("Wallet submitted a Testnet-only Cancun smoke probe. Use Verify below to check its real receipt.");
  }catch(e){setError(e instanceof Error?e.message:"Wallet did not confirm Testnet probe");}
  finally{setWorking(false);}
 }
 async function verify(){
  if(!/^0x[\da-fA-F]{64}$/.test(hash)||!wallet.address)return;
  setWorking(true);setError("");setProof(null);
  try{
   const response=await fetch("/api/testnet/probe?hash="+encodeURIComponent(hash)+
       "&wallet="+encodeURIComponent(wallet.address),{cache:"no-store"});
   const data=await response.json() as Proof;
   setProof(data);
   if(!response.ok)throw Error(data.error||"Not yet verified on Testnet");
   setNotice(data.verified?"12+ confirmed blocks. PUSH0/MCOPY probe matched on-chain execution.":
     "Probe has a valid receipt but is waiting for twelve block confirmations.");
  }catch(e){setError(e instanceof Error?e.message:"Probe verification unavailable");}
  finally{setWorking(false);}
 }
 return <section className="operator-page ultra-testnet-ops">
  <Link className="curated-back" href="/create">← NFT Creation</Link>
  <p className="curated-overline">ULTRA EVM TESTNET · CHAIN ID 18881</p>
  <h1>Testnet deployment checks</h1>
  <p>Verify that your funded MetaMask account is on the real Ultra EVM Testnet. Run a harmless, user-approved transaction to check Cancun smart-contract compatibility before attempting the owner-only NFT factory. This page never connects to mainnet.</p>
  <div className="testnet-status-panel">
   <h2>1. Verify your wallet and funds</h2>
   <p>Funded account for this test: <strong>0xB2b3…5942</strong>. The existing LookeNFT publishing administrator uses a different wallet (0xb7f8…ad98). Check which wallet MetaMask is actually connected to.</p>
   <dl>
    <div><dt>Connected address</dt><dd>{wallet.address||"Not connected"}</dd></div>
    <div><dt>Current wallet network</dt><dd>{wallet.chainId??"Unknown"} {wallet.chainId===18881?"— Ultra EVM Testnet":""}</dd></div>
    <div><dt>Wallet sign-in</dt><dd>{wallet.authenticated?"Signed in":"Required for a wallet transaction"}</dd></div>
    <div><dt>Latest Testnet block</dt><dd>{check?.blockNumber??"Not checked"}</dd></div>
    <div><dt>Confirmed Testnet balance</dt><dd>{check?.wallet?.balanceUos??"Not checked"} UOS</dd></div>
    <div><dt>Administrator matches this wallet</dt><dd>{done(check?.wallet?.operatorApproved)}</dd></div>
    <div><dt>Verified factory code</dt><dd>{done(check?.factory?.hasCode)}</dd></div>
   </dl>
   <div className="testnet-actions">
    <button type="button" disabled={working||!wallet.address} onClick={()=>void checkBalance()}>
     {working?"Checking…":"Check live Testnet balance and network"}
    </button>
    {!wallet.authenticated&&wallet.address&&<button type="button" className="creator-secondary" disabled={working} onClick={()=>void wallet.signIn()}>Sign in with this wallet</button>}
    {wallet.chainId!==18881&&wallet.address&&<button type="button" className="creator-secondary" disabled={working} onClick={()=>void wallet.switchNetwork()}>Switch to Ultra EVM Testnet</button>}
   </div>
   {check?.rpcOnline===false&&<p className="operator-error">Primary Ultra EVM RPC did not respond. Do not deploy contracts until the network is available and the balance is verified. {check.reason}</p>}
  </div>
  <div className="testnet-status-panel">
   <h2>2. Prove Cancun opcode compatibility</h2>
   <p>This small wallet-approved transaction deploys only a smoke-test contract. It uses PUSH0 and MCOPY and returns 42 when called. It cannot transfer tokens, mint NFTs, or control LookeNFT.</p>
   <p className="operator-note">This creates a real Testnet contract, so your wallet will ask you to approve a gas fee in test UOS. No transaction is sent automatically. It is not an audit or a factory deployment.</p>
   <div className="testnet-actions">
    <button type="button" disabled={!ready||working||wallet.pending} onClick={()=>void submitProbe()}>
      {working||wallet.pending?"Waiting…":"Deploy small Testnet compatibility probe (wallet approval)"}
    </button>
   </div>
   <label>Testnet probe transaction hash
     <input value={hash} onChange={e=>{setHash(e.target.value);setProof(null);}} placeholder="0x…" autoComplete="off"/>
   </label>
   <div className="testnet-actions">
    <button type="button" className="creator-secondary" disabled={working||!wallet.address||!/^0x[\da-fA-F]{64}$/.test(hash)} onClick={()=>void verify()}>Verify confirmed Testnet transaction</button>
   </div>
   {hash&&<p><a target="_blank" rel="noopener noreferrer" href={ULTRA_TESTNET.explorerUrl+"/tx/"+encodeURIComponent(hash)}>View probe transaction on Ultra Testnet Explorer</a></p>}
   {proof&&<dl>
    <div><dt>Opcode compatibility proof</dt><dd>{done(proof.verified)}</dd></div>
    <div><dt>Confirmations</dt><dd>{proof.confirmations??0} / 12 required</dd></div>
    <div><dt>On-chain probe contract</dt><dd>{proof.contractAddress||"Unavailable"}</dd></div>
   </dl>}
  </div>
  <div className="testnet-status-panel">
   <h2>3. Owner-only NFT factory and free mint</h2>
   <p>The remaining actions must occur on **Ultra EVM Testnet**, one signed wallet transaction at a time: verify and deploy the owner-only factory, pin real artwork/metadata, deploy a 10,000-cap ERC-721 collection, schedule a 0 UOS mint phase, test minting from a second wallet, and verify receipts and ownership.</p>
   <p className="operator-note"><strong>Deployment and public minting remain disabled until actual chain proofs and owner approval exist.</strong> A funded wallet does not automatically replace the existing administrator or authorize mainnet activity. No unverified collections or NFTs will be fabricated.</p>
   <Link className="inline-link" href="/create">Prepare NFT collection →</Link>
  </div>
  {notice&&<p role="status" className="gen-good">{notice}</p>}
  {error&&<p role="alert" className="operator-error">{error}</p>}
 </section>;
}
