"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  createPublicClient, encodeFunctionData, formatEther, getAddress, http, isAddress,
  parseEventLogs, type Address, type Hex
} from "viem";
import { ACTIVE_NETWORK } from "@/lib/network";
import { useWalletSession } from "@/components/WalletSessionProvider";
import { factoryAbi } from "@/lib/m4/factory";
import {
  M5_MINT_ENABLED, M5_FACTORY_ADDRESS, mintAbi, mintCallAbi,
  mintGate, parseMintDraft, requiredPayment, type MintDraft
} from "@/lib/m5/mint";

const rpc = createPublicClient({ transport: http(ACTIVE_NETWORK.rpcUrl, {timeout:12000,retryCount:1}) });
type Review = {
  creatorWallet: Address;
  collection: Address;
  standard: "erc721"|"erc1155";
  phaseId: bigint;
  tokenId: bigint;
  quantity: bigint;
  nonce: bigint;
  deadline: bigint;
  unitPrice: bigint;
  valueWei: bigint;
  calldata: Hex;
  phaseEnd: bigint;
};
type VerifiedReceipt = {
  txHash:Hex;
  blockNumber:string;
  blockHash:Hex;
  collection:Address;
  wallet:Address;
  tokenIds:string[];
  quantity:string;
  status:"confirmed-primary-rpc-only";
};

const initial: MintDraft={
  collection:"",phaseId:"1",tokenId:"0",quantity:"1",allowance:"0",proof:""
};
function errorText(error:unknown):string{
  if(error instanceof Error)return error.message.slice(0,450);
  return "Unable to review mint request";
}
export default function CuratedMintFlow({collection,phaseId}:{collection:string;phaseId:string}){
  const wallet=useWalletSession();
  const [draft,setDraft]=useState<MintDraft>(()=>({...initial,collection,phaseId}));
  const [review,setReview]=useState<Review|null>(null);
  const [ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [hash,setHash]=useState<Hex|null>(null);
  const [status,setStatus]=useState<"idle"|"preflight"|"wallet"|"submitted"|"confirmed-primary"|"failed">("idle");
  const [receipt,setReceipt]=useState<VerifiedReceipt|null>(null);
  const gate=mintGate();
  useEffect(()=>{setReview(null);setAck(false);},[draft,wallet.address,wallet.chainId,wallet.authenticated]);
  function edit<K extends keyof MintDraft>(key:K,value:MintDraft[K]){
    setDraft(prev=>({...prev,[key]:value}));
    setReview(null);setAck(false);setError(null);setReceipt(null);setHash(null);setStatus("idle");
  }
  async function preflight(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);setError(null);setReview(null);setStatus("preflight");
    try{
      if(draft.collection.toLowerCase()!==collection.toLowerCase()||draft.phaseId!==phaseId)throw new Error("This collection is not in the official mint flow");
      if(!wallet.address||wallet.chainId!==18881)throw new Error("Connect an Ultra EVM Testnet wallet first");
      if(!isAddress(M5_FACTORY_ADDRESS,{strict:false}))throw new Error("M5 factory is not configured by operator");
      const params=parseMintDraft(draft);
      if(await rpc.getChainId()!==18881)throw new Error("Wrong RPC network");
      const collection=getAddress(params.collection);
      const [factoryVersion,listed,code,has721,has1155,phase,nonce,mintedWallet,lifetime,block]=await Promise.all([
        rpc.readContract({address:M5_FACTORY_ADDRESS,abi:factoryAbi,functionName:"VERSION"}),
        rpc.readContract({address:M5_FACTORY_ADDRESS,abi:factoryAbi,functionName:"isCollection",args:[collection]}),
        rpc.getCode({address:collection}),
        rpc.readContract({address:collection,abi:mintAbi,functionName:"supportsInterface",args:["0x80ac58cd"]}).catch(()=>false),
        rpc.readContract({address:collection,abi:mintAbi,functionName:"supportsInterface",args:["0xd9b67a26"]}).catch(()=>false),
        rpc.readContract({address:collection,abi:mintAbi,functionName:"mintPhases",args:[params.phaseId]}),
        rpc.readContract({address:collection,abi:mintAbi,functionName:"mintNonces",args:[params.phaseId,wallet.address as Address]}),
        rpc.readContract({address:collection,abi:mintAbi,functionName:"mintedByWallet",args:[params.phaseId,wallet.address as Address]}),
        rpc.readContract({address:collection,abi:mintAbi,functionName:"lifetimeMintedByWallet",args:[wallet.address as Address]}),
        rpc.getBlock({blockTag:"latest"})
      ]);
      if(factoryVersion!==3n||!listed||!code||code==="0x")
        throw new Error("Collection is not approved by an on-chain M5 factory");
      if(!has721&&!has1155)throw new Error("Collection does not expose a supported NFT interface");
      const standard=has721?"erc721":"erc1155";
      if(standard==="erc721"&&params.tokenId!==0n)
        throw new Error("ERC-721 phase mint automatically assigns IDs; enter token ID 0");
      if(standard==="erc721"&&params.quantity>20n)
        throw new Error("Maximum 20 ERC-721 tokens per mint transaction");
      const [start,end,unitPrice,walletCap,phaseCap,minted,root,cancelled]=phase;
      if(cancelled||params.phaseId===0n||block.timestamp<start||block.timestamp>end)
        throw new Error("Mint phase is not currently active");
      if(params.quantity>BigInt(phaseCap)-BigInt(minted)||
         params.quantity>BigInt(walletCap)-mintedWallet||
         params.quantity>1000n-lifetime)
        throw new Error("Mint amount exceeds phase/wallet lifetime cap");
      if(root==="0x"+"0".repeat(64)){
        if(params.allowance!==0n||params.proof.length)
          throw new Error("Public phase does not accept allowlist proofs");
      } else if(params.allowance===0n||mintedWallet+params.quantity>params.allowance){
        throw new Error("Allowlist allocation is missing or exhausted");
      }
      const requestedDeadline=block.timestamp+600n;
      const deadline=requestedDeadline<end?requestedDeadline:end;
      if(deadline<=block.timestamp)throw new Error("Mint phase expires before wallet review can complete");
      const valueWei=requiredPayment(unitPrice,params.quantity);
      if(valueWei>1000n*10n**18n)
        throw new Error("Mint transaction safety limit is 1000 UOS");
      const data=encodeFunctionData({
        abi:mintCallAbi,functionName:"mintFromPhase",
        args:[params.phaseId,params.tokenId,params.quantity,params.allowance,params.proof,nonce,deadline]
      });
      // Read-only simulation with exact native value; failure is not approved.
      await rpc.simulateContract({
        address:collection,abi:mintCallAbi,functionName:"mintFromPhase",
        args:[params.phaseId,params.tokenId,params.quantity,params.allowance,params.proof,nonce,deadline],
        account:wallet.address as Address,value:valueWei
      });
      setReview({
        creatorWallet:getAddress(wallet.address),collection,standard,
        phaseId:params.phaseId,tokenId:params.tokenId,quantity:params.quantity,
        nonce,deadline,unitPrice,valueWei,calldata:data,phaseEnd:end
      });
      setStatus("idle");
    }catch(e){setError(errorText(e));setStatus("failed");}
    finally{setBusy(false);}
  }
  async function confirm(){
    if(!review||!ack||busy||!M5_MINT_ENABLED||!wallet.authenticated||gate)return;
    setBusy(true);setError(null);setStatus("wallet");setHash(null);setReceipt(null);
    try {
      if(wallet.address?.toLowerCase()!==review.creatorWallet.toLowerCase()||wallet.chainId!==18881)
        throw new Error("Wallet or chain changed; restart review");
      // Provider rechecks session, on-chain factory, quote and nonce before wallet popup.
      const txHash=await wallet.submitMint(review.collection,review.calldata,review.valueWei);
      setHash(txHash);setStatus("submitted");
      const result=await rpc.waitForTransactionReceipt({hash:txHash,confirmations:2,timeout:180000});
      if(result.status!=="success")throw new Error("Mint transaction failed or reverted");
      const tx=await rpc.getTransaction({hash:txHash});
      if(tx.chainId!==18881||tx.from.toLowerCase()!==review.creatorWallet.toLowerCase()||
         tx.to?.toLowerCase()!==review.collection.toLowerCase()||
         tx.input.toLowerCase()!==review.calldata.toLowerCase()||
         tx.value!==review.valueWei)
        throw new Error("Confirmed transaction differs from reviewed mint/account/UOS payment");
      const phaseEvents=parseEventLogs({abi:mintAbi,logs:result.logs,eventName:"PhaseMint"});
      const matched=phaseEvents.find(e=>e.address.toLowerCase()===review.collection.toLowerCase()&&
        e.args.phaseId===review.phaseId&&e.args.minter.toLowerCase()===review.creatorWallet.toLowerCase()&&
        e.args.quantity===review.quantity&&e.args.nonce===review.nonce&&
        e.args.payment===review.valueWei);
      if(!matched)throw new Error("On-chain receipt missing exact phase mint event");
      const transferIds:string[]=[];
      if(review.standard==="erc721"){
        const transfers=parseEventLogs({abi:mintAbi,logs:result.logs,eventName:"Transfer"});
        for(const e of transfers){
          if(e.address.toLowerCase()===review.collection.toLowerCase() &&
             e.args.from.toLowerCase()==="0x"+"0".repeat(40) &&
             e.args.to.toLowerCase()===review.creatorWallet.toLowerCase())transferIds.push(e.args.tokenId.toString());
        }
      }else{
        const transfers=parseEventLogs({abi:mintAbi,logs:result.logs,eventName:"TransferSingle"});
        const found=transfers.find(e=>e.address.toLowerCase()===review.collection.toLowerCase()&&
          e.args.from.toLowerCase()==="0x"+"0".repeat(40)&&
          e.args.to.toLowerCase()===review.creatorWallet.toLowerCase()&&
          e.args.id===review.tokenId&&e.args.value===review.quantity);
        if(found)transferIds.push(found.args.id.toString());
      }
      if((review.standard==="erc721"&&transferIds.length!==Number(review.quantity))||
         (review.standard==="erc1155"&&transferIds.length!==1))
        throw new Error("Mint transfer count/quantity is inconsistent with the receipt");
      // Ownership is read-only; users may transfer after mint, so do not infer current ownership forever.
      if(review.standard==="erc721"){
        for(const id of transferIds){
          const owner=await rpc.readContract({
            address:review.collection,abi:mintAbi,functionName:"ownerOf",
            args:[BigInt(id)],blockNumber:result.blockNumber
          });
          if(owner.toLowerCase()!==review.creatorWallet.toLowerCase())
            throw new Error("ERC-721 owner differs from confirmed receipt block");
        }
      }else{
        const balance=await rpc.readContract({
          address:review.collection,abi:mintAbi,functionName:"balanceOf",
          args:[review.creatorWallet,review.tokenId],blockNumber:result.blockNumber
        });
        if(balance<review.quantity)
          throw new Error("ERC-1155 balance lacks minted quantity at receipt block");
      }
      setReceipt({
        txHash,blockHash:result.blockHash,blockNumber:result.blockNumber.toString(),
        collection:review.collection,wallet:review.creatorWallet,
        tokenIds:transferIds,quantity:review.quantity.toString(),status:"confirmed-primary-rpc-only"
      });
      setStatus("confirmed-primary");
    }catch(e){setError(errorText(e));setStatus("failed");}
    finally{setBusy(false);}
  }
  return <section className="interior creator-page">
    <p className="eyebrow">LOOKE NFT / ULTRA EVM TESTNET</p>
    <h1>Mint a collection token.</h1>
    <p className="interior-copy">Review the live NFT phase, exact UOS price, Merkle allocation and wallet nonce. A real mint requires operator evidence, an authenticated wallet and explicit wallet confirmation. Nothing is auto-minted.</p>
    <div className="index-warning" role="status">{gate || "The operator has enabled Testnet mint reviews; independent security and wallet approvals still apply."}</div>
    <form onSubmit={e=>void preflight(e)} className="creator-form">
      <div className="creator-form-grid">
        <label className="creator-wide">Collection contract (registered in factory)
          <input placeholder="0x…" value={collection} readOnly />
        </label>
        <label>Mint phase ID<input inputMode="numeric" value={phaseId} readOnly/></label>
        <label>Quantity<input inputMode="numeric" value={draft.quantity} onChange={e=>edit("quantity",e.target.value)}/></label>
        <label>Token ID (0 for ERC-721)<input inputMode="numeric" value={draft.tokenId} onChange={e=>edit("tokenId",e.target.value)}/></label>
        <label>Allowlist allocation (0 for public)<input inputMode="numeric" value={draft.allowance} onChange={e=>edit("allowance",e.target.value)}/></label>
        <label className="creator-wide">Merkle proof JSON (empty for public)
          <textarea rows={3} value={draft.proof} onChange={e=>edit("proof",e.target.value)} placeholder={'["0x…", "0x…"]'} />
          <span>Proof must be generated for this chain, collection, phase, wallet and allocation. Do not paste private keys or seed phrases.</span>
        </label>
      </div>
      <button type="submit" className="primary-link" disabled={busy||wallet.pending}>{busy?"Reviewing…":"Review on-chain mint (read-only)"}</button>
    </form>
    {review&&<div className="creator-preflight">
      <h2>Mint review — transaction not submitted</h2>
      <dl>
        <div><dt>Network</dt><dd>Ultra EVM Testnet · 18881</dd></div>
        <div><dt>Collection</dt><dd>{review.collection}</dd></div>
        <div><dt>Wallet</dt><dd>{review.creatorWallet}</dd></div>
        <div><dt>Standard / phase</dt><dd>{review.standard.toUpperCase()} · {review.phaseId.toString()}</dd></div>
        <div><dt>Quantity</dt><dd>{review.quantity.toString()}</dd></div>
        <div><dt>Unit price</dt><dd>{formatEther(review.unitPrice)} UOS</dd></div>
        <div><dt>Total payment</dt><dd>{formatEther(review.valueWei)} UOS plus wallet gas</dd></div>
        <div><dt>Request nonce</dt><dd>{review.nonce.toString()}</dd></div>
        <div><dt>Request deadline</dt><dd>{new Date(Number(review.deadline)*1000).toLocaleString()}</dd></div>
      </dl>
      <label className="creator-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
        I approve this specific Testnet mint and UOS payment, after checking collection address, supply, wallet and terms. I understand wallet confirmation is separate.
      </label>
      <button type="button" className="primary-link" disabled={Boolean(gate)||!ack||!wallet.authenticated||busy||wallet.pending} onClick={()=>void confirm()}>
        Confirm mint in wallet
      </button>
    </div>}
    <p className="wallet-note" role="status">Transaction state: {status}. No on-chain mint is inferred without a verified receipt.</p>
    {hash&&<p className="index-warning">Wallet-submitted transaction: <a href={ACTIVE_NETWORK.explorerUrl+"/tx/"+hash} target="_blank" rel="noopener noreferrer">{hash}</a>. Submission alone does not prove success.</p>}
    {error&&<p className="index-warning" role="alert">{error}</p>}
    {receipt&&<div className="creator-preflight">
      <h2>Mint receipt — primary RPC only</h2>
      <p className="wallet-note">Confirmed on primary Testnet RPC and at its receipt block. Not independently corroborated or source-code audited.</p>
      <pre className="creator-json">{JSON.stringify(receipt,null,2)}</pre>
    </div>}
  </section>;
}
