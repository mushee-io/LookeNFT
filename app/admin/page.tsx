"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useWalletSession } from "@/components/WalletSessionProvider";
type Drop={address:string;title:string;description:string;coverUrl:string|null;status:"draft"|"published";mintAvailable:boolean;mintEnabled:boolean};
export default function OperatorConsole(){
 const wallet=useWalletSession();
 const [items,setItems]=useState<Drop[]>([]);
 const [authorised,setAuthorised]=useState(false);
 const [loading,setLoading]=useState(true);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [address,setAddress]=useState("");
 const [title,setTitle]=useState("");
 const [description,setDescription]=useState("");
 const [coverUrl,setCoverUrl]=useState("");
 const [phaseId,setPhaseId]=useState("1");
 async function read(res:Response){
  const value=await res.json() as {error?:string;collections?:Drop[];mintReleaseOpen?:boolean};
  if(!res.ok)throw new Error(value.error||"Operator service unavailable");return value;
 }
 async function refresh(){
  if(!wallet.authenticated){setLoading(false);setAuthorised(false);return;}
  try{const result=await read(await fetch("/api/admin/collections",{cache:"no-store"}));
   setItems(result.collections||[]);setAuthorised(true);setError("");
  }catch(e){setAuthorised(false);setError(e instanceof Error?e.message:"Operator verification failed");}
  finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[wallet.authenticated,wallet.address]);
 async function mutate(method:"POST"|"PATCH",body:object){
  setBusy(true);setMessage("");setError("");
  try{await read(await fetch("/api/admin/collections",{method,credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
    setMessage("Saved. Public collection visibility is controlled by the publish action.");await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Update failed");}
  finally{setBusy(false);}
 }
 function register(e:FormEvent<HTMLFormElement>){e.preventDefault();void mutate("POST",{address,title,description,coverUrl,phaseId});}
 return <section className="operator-page"><Link className="curated-back" href="/explore">← Back to NFT collections</Link>
  <p className="curated-overline">PRIVATE OPERATOR CONSOLE</p><p><Link className="curated-mint" href="/create">+ Create a new collection</Link></p><h1>LookeNFT collection control</h1>
  <p>Only the configured LookeNFT wallet can register verified contracts, preview drafts, and publish official collections. Other wallets cannot create or publish drops here.</p>
  <p className="operator-note">Collection deployment remains a separately wallet-signed operator process. Publishing never starts minting automatically. Minting stays disabled until independent release approval.</p>
  {!wallet.authenticated?<p className="operator-note">Connect and sign in with the authorised Ultra EVM Testnet wallet to manage collections.</p>:
   loading?<p role="status">Checking operator access…</p>:
   !authorised?<p className="operator-note" role="alert">Operator access unavailable. {error}</p>:<>
    <form onSubmit={register}>
      <h2>Register an official collection</h2>
      <p>Register an already-deployed, indexer-verified collection owned by the operator wallet. It starts as a private draft.</p>
      <label>Collection contract address<input required value={address} onChange={e=>setAddress(e.target.value)} placeholder="0x…" /></label>
      <label>Collection name<input required value={title} onChange={e=>setTitle(e.target.value)} maxLength={90}/></label>
      <label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={1200} rows={3}/></label>
      <label>Approved HTTPS cover image (optional)<input value={coverUrl} onChange={e=>setCoverUrl(e.target.value)} placeholder="https://…" /></label>
      <label>On-chain mint phase ID<input inputMode="numeric" required value={phaseId} onChange={e=>setPhaseId(e.target.value)}/></label>
      <button disabled={busy}>{busy?"Saving…":"Save draft collection"}</button>
    </form>
    <h2>Published and draft collections</h2>
    {items.length?items.map(drop=><article key={drop.address} className="operator-record">
      <h3>{drop.title}</h3><p>{drop.address}</p>
      <p>Status: {drop.status} · Mint: {drop.mintAvailable?"open":drop.mintEnabled?"configured, release gate closed":"disabled"}</p>
      {drop.status==="draft"?<button disabled={busy} onClick={()=>void mutate("PATCH",{address:drop.address,action:"publish"})}>Publish preview</button>:
       <button disabled={busy} onClick={()=>void mutate("PATCH",{address:drop.address,action:"unpublish"})}>Unpublish</button>}
      {drop.status==="published"&&<button disabled={busy} onClick={()=>void mutate("PATCH",{address:drop.address,action:drop.mintEnabled?"disableMint":"enableMint"})}>{drop.mintEnabled?"Pause mint":"Open mint (release gated)"}</button>}
      {drop.status==="published"&&<Link className="inline-link" href={"/collection/"+drop.address}> View public preview ↗</Link>}
    </article>):<p>No official collections registered. Nothing will appear publicly until you publish a verified one.</p>}
   </>}
  {message&&<p role="status" className="operator-note">{message}</p>}
  {error&&authorised&&<p role="alert" className="operator-note">{error}</p>}
 </section>;
}
