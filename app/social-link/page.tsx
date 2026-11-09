"use client";
import {useEffect,useState,type FormEvent} from "react";
import Link from "next/link";
import {useWalletSession} from "@/components/WalletSessionProvider";
import {ULTRA_TESTNET} from "@/lib/network";

type Post={post_id:string;body:string;created_at:string;media_kind:string|null;approved_media_url:string|null};
type Avatar={collection_address:string;token_standard:string;token_id:string;
 verified_balance:string;block_number:string;block_hash:string;expires_at:string};
type Profile={wallet:string;profileId:string;handle:string;displayName:string;bio:string;
 sourceCommit:string;lastSignedAt:string;proofExpiresAt:string;
 avatar:Avatar|null;approvedImageUrl:string|null;posts:Post[];warning:string};
type Notice={source_kind:string;event_kind:string;tx_hash:string;block_number:string;created_at:string};
type BridgeResponse={chainId:number;profile:Profile|null;verifiedMarketNotifications:Notice[];
 linkedWallet:string;warning:string;error?:string};
type DirectoryItem={handle:string;display_name:string;wallet_address:string;
 collection_address:string|null;avatar_token_id:string|null};
async function json<T>(response:Response):Promise<T>{
 const result=await response.json() as T&{error?:string};
 if(!response.ok)throw Error(result.error||"Trusted Looke Social integration unavailable");
 return result;
}
function appURL(){
 const raw=process.env.NEXT_PUBLIC_M10_LOOKE_SOCIAL_ORIGIN;
 if(!raw)return null;
 try{
  const url=new URL(raw);
  return url.protocol==="https:"&&url.pathname==="/"&&!url.search&&!url.hash?
   new URL("/social",url.origin).toString():null;
 }catch{return null;}
}
export default function SocialNFTPage(){
 const wallet=useWalletSession();
 const authenticated=Boolean(wallet.authenticated&&wallet.address&&wallet.chainId===18881);
 const enabled=process.env.NEXT_PUBLIC_M10_SOCIAL_UI_ENABLED==="true";
 const avatarEnabled=process.env.NEXT_PUBLIC_M10_AVATAR_UI_ENABLED==="true";
 const creatorsEnabled=process.env.NEXT_PUBLIC_M10_CREATOR_DIRECTORY_ENABLED==="true";
 const [profile,setProfile]=useState<Profile|null>(null);
 const [notifications,setNotifications]=useState<Notice[]>([]);
 const [assertion,setAssertion]=useState("");
 const [identityAssertion,setIdentityAssertion]=useState("");
 const [collection,setCollection]=useState("");
 const [tokenId,setTokenId]=useState("1");
 const [standard,setStandard]=useState<"erc721"|"erc1155">("erc721");
 const [search,setSearch]=useState("");
 const [directory,setDirectory]=useState<DirectoryItem[]>([]);
 const [message,setMessage]=useState("No trusted social profile, NFT ownership or posts have been independently evidenced.");
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [reload,setReload]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  setProfile(null);setNotifications([]);setDirectory([]);setError(null);
  if(!authenticated||!enabled)return;
  fetch("/api/social/bridge",{cache:"no-store",signal:controller.signal})
   .then(async r=>json<BridgeResponse>(r))
   .then(body=>{
    if(controller.signal.aborted)return;
    setProfile(body.profile);setNotifications(body.verifiedMarketNotifications||[]);
    setMessage(body.profile?"Verified signed Looke Social snapshot loaded. Expiry and NFT chain witnesses remain separate.":"No valid signed Looke Social profile linked to this wallet.");
   }).catch(e=>{if(!controller.signal.aborted)
    setError(e instanceof Error?e.message:"Untrusted social source unavailable");});
  return ()=>controller.abort();
 },[authenticated,enabled,wallet.address,wallet.chainId,reload]);
 async function perform(action:()=>Promise<void>){
  setBusy(true);setError(null);
  try{await action();setReload(v=>v+1);}
  catch(e){setError(e instanceof Error?e.message:"Verified source unavailable");}
  finally{setBusy(false);}
 }
 function linkM2Identity(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!authenticated||!enabled||busy)return;
  const proof=identityAssertion;setIdentityAssertion("");
  void perform(async()=>{
   const result=await json<{linked:boolean;profileId:string}>(
    await fetch("/api/profile/link",{method:"POST",credentials:"same-origin",
     headers:{"content-type":"application/json"},
     body:JSON.stringify({assertion:proof})}));
   if(!result.linked||result.profileId?.toLowerCase()!==wallet.address?.toLowerCase())
    throw Error("M2 identity assertion did not link this authenticated Looke wallet");
   setMessage("M2 wallet/profile identity linked from genuine Looke issuer. A separate short-lived, moderated M10 Social proof is still required.");
  });
 }
 function importSigned(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!authenticated||!enabled||busy)return;
  const token=assertion;setAssertion("");
  void perform(async()=>{
   const r=await json<{accepted:boolean;handle:string;proofExpiresAt:string}>(
    await fetch("/api/social/bridge",{method:"POST",credentials:"same-origin",
     headers:{"content-type":"application/json"},body:JSON.stringify({assertion:token})}));
   if(!r.accepted)throw Error("Looke Social signed assertion was not accepted");
   setMessage("Looke Social proof validated for "+r.handle+" until "+r.proofExpiresAt+
    ". Imported only source-approved public profile/post records.");
  });
 }
 function verifyAvatar(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!authenticated||!avatarEnabled||!profile||busy)return;
  void perform(async()=>{
   const response=await json<{verified:boolean;evidence:{blockNumber:string}}>(
    await fetch("/api/social/avatar",{method:"POST",credentials:"same-origin",
     headers:{"content-type":"application/json"},
     body:JSON.stringify({collection,tokenId,standard})}));
   if(!response.verified)throw Error("Independent NFT owner evidence missing");
   setMessage("ERC NFT ownership corroborated at Ultra Testnet block #"+
    response.evidence.blockNumber+". It can change; no on-chain profile update was made.");
  });
 }
 function removeAvatar(){
  if(!authenticated||busy)return;
  void perform(async()=>{
   await json<{selected:boolean}>(await fetch("/api/social/avatar",{
    method:"DELETE",credentials:"same-origin",headers:{"content-type":"application/json"},
    body:"{}"}));
   setMessage("Local NFT profile reference removed. No NFT was transferred.");
  });
 }
 function findCreators(){
  if(!authenticated||!creatorsEnabled||busy)return;
  void perform(async()=>{
   const results=await json<{profiles:DirectoryItem[]}>(
    await fetch("/api/social/creators?search="+encodeURIComponent(search),{cache:"no-store"}));
   setDirectory(results.profiles||[]);
   setMessage("Directory results are from source-approved, currently valid signed public Looke Social profiles only.");
  });
 }
 const lookeLink=appURL();
 return <section className="interior creator-page">
  <p className="eyebrow">LOOKE NFT / SOCIAL LINK / ULTRA EVM TESTNET 18881</p>
  <h1>NFT identity, with genuine social proof.</h1>
  <p className="interior-copy">Connect an already wallet-linked Looke Social profile using a trusted short-lived signed identity assertion. Feature an NFT only after independent ERC-721/1155 ownership, M3 canonical block evidence and Blockscout agreement. Nothing here posts on Looke Social, mints, transfers or approves tokens.</p>
  <p className="index-warning" role="status">M10 integration {enabled?"requires trusted issuer and operator source proofs":"DISABLED pending a real Looke Social JWT issuer"} · NFT ownership {avatarEnabled?"requires 2 RPCs and Blockscout":"OFF"} · Creator directory {creatorsEnabled?"restricted to signed public records":"OFF"}. Existing wallet and financial release gates remain NO-GO.</p>
  {error&&<p className="index-warning" role="alert">{error}</p>}
  {!authenticated&&<p className="wallet-note">Sign in with an Ultra EVM Testnet wallet to inspect only your own linked Looke Social data. No wallet payments are needed.</p>}
  <div className="studio-grid">
   <section className="creator-preflight">
    <h2>1. Signed Looke Social profile</h2>
    {profile?<dl>
     <div><dt>Handle</dt><dd>@{profile.handle}</dd></div>
     <div><dt>Display name</dt><dd>{profile.displayName}</dd></div>
     <div><dt>Linked wallet</dt><dd>{profile.wallet}</dd></div>
     <div><dt>Approved bio</dt><dd>{profile.bio||"No biography supplied"}</dd></div>
     <div><dt>Source commit</dt><dd>{profile.sourceCommit}</dd></div>
     <div><dt>Signed proof expires</dt><dd>{new Date(profile.proofExpiresAt).toLocaleString()}</dd></div>
    </dl>:<p className="wallet-note">No genuine linked, issuer-signed, unsuspended Looke Social profile is available.</p>}
    {lookeLink&&<p><a className="secondary-link" href={lookeLink} target="_blank" rel="noopener noreferrer">Open the actual Looke Social page (no post created)</a></p>}
    <form className="creator-form" onSubmit={linkM2Identity}>
     <label>Step A: M2 wallet/profile identity JWT (`aud: lookenft`)
      <textarea value={identityAssertion} rows={2} maxLength={8192}
       onChange={e=>setIdentityAssertion(e.target.value)} spellCheck={false}
       autoComplete="off" placeholder="Signed identity issuer not provisioned; no username-only linking"/>
     </label>
     <button className="secondary-link" type="submit"
      disabled={!authenticated||!enabled||!identityAssertion||busy}>Link M2 wallet identity (one-use signed assertion)</button>
    </form>
    <form className="creator-form" onSubmit={importSigned}>
     <label>Step B: moderated M10 Looke Social snapshot JWT (`aud: lookenft-social-proof`)
      <textarea value={assertion} rows={3} maxLength={16384} onChange={e=>setAssertion(e.target.value)}
       spellCheck={false} autoComplete="off" placeholder="No issuer configured: cannot link with a username or public profile URL"/>
     </label>
     <p className="wallet-note">The independently operated Looke Social backend must issue a wallet-bound, one-use, moderation-approved JWT. Existing Looke Social code has no compatible issuer yet. Never paste wallet private keys or login cookies.</p>
     <button className="primary-link" type="submit" disabled={!authenticated||!enabled||!assertion||busy}>Import trusted Social proof (no transactions)</button>
    </form>
   </section>
   <section className="creator-preflight">
    <h2>2. Verified NFT profile picture</h2>
    {profile?.avatar?<dl>
     <div><dt>Collection</dt><dd>{profile.avatar.collection_address}</dd></div>
     <div><dt>Token ID</dt><dd>#{profile.avatar.token_id} · {profile.avatar.token_standard.toUpperCase()}</dd></div>
     <div><dt>Independently witnessed balance</dt><dd>{profile.avatar.verified_balance}</dd></div>
     <div><dt>Verified Testnet block</dt><dd>#{profile.avatar.block_number}</dd></div>
     <div><dt>Expires</dt><dd>{new Date(profile.avatar.expires_at).toLocaleString()}</dd></div>
    </dl>:<p className="wallet-note">No verified NFT owner proof. An uploaded image or NFT metadata alone is not ownership.</p>}
    {profile?.approvedImageUrl&&<img src={profile.approvedImageUrl} alt={"Moderated and pinned NFT token profile picture"} width={200} height={200} className="m10-nft-avatar" loading="lazy"/>}
    <form className="creator-form" onSubmit={verifyAvatar}>
     <label>NFT collection address<input value={collection} onChange={e=>setCollection(e.target.value)}
       placeholder="0x… approved ERC721/ERC1155" maxLength={42}/></label>
     <label>Token ID<input value={tokenId} onChange={e=>setTokenId(e.target.value)}
       inputMode="numeric" maxLength={78}/></label>
     <label>Token standard<select value={standard} onChange={e=>setStandard(e.target.value as "erc721"|"erc1155")}>
      <option value="erc721">ERC-721</option><option value="erc1155">ERC-1155</option>
     </select></label>
     <p className="wallet-note">Requires two independent Ultra EVM Testnet RPCs, 12+ confirmations, approved on-chain bytecode, matching M3 canonical ownership records and a working independent Blockscout block proof. No EVM signing required for the read-only check.</p>
     <div className="studio-action-row">
      <button className="primary-link" disabled={!authenticated||!profile||!avatarEnabled||busy}>Verify NFT ownership and use as local profile reference</button>
      <button type="button" className="secondary-link" disabled={!authenticated||!profile?.avatar||busy}
       onClick={removeAvatar}>Remove local reference</button>
     </div>
    </form>
   </section>
  </div>
  <section className="creator-preflight">
   <h2>3. Holder collection share & creator discovery</h2>
   <p className="wallet-note">A verified token holder is not necessarily the collection’s creator. These are read-only collection deep links; publishing a social post always takes place separately on Looke Social with its own authorisation and moderation.</p>
   {profile?.avatar&&<p>
    <a className="secondary-link" href={ULTRA_TESTNET.explorerUrl+"/address/"+profile.avatar.collection_address}
     target="_blank" rel="noopener noreferrer">Inspect source-backed holder collection on Testnet explorer</a>
   </p>}
   <div className="studio-action-row">
    <label>Approved creator handle search<input value={search} maxLength={24} placeholder="Search signed directory"
      onChange={e=>setSearch(e.target.value.toLowerCase())}/></label>
    <button className="secondary-link" disabled={!authenticated||!creatorsEnabled||busy}
     onClick={findCreators}>Discover verified public profiles</button>
   </div>
   {directory.length?<div className="studio-assets">{directory.map(entry=>
    <article className="studio-asset" key={entry.wallet_address}>
     <strong>@{entry.handle} · {entry.display_name}</strong>
     <p>Signed profile wallet {entry.wallet_address}</p>
     {entry.collection_address&&<p>Owned NFT #{entry.avatar_token_id} in {entry.collection_address}</p>}
    </article>)}</div>:<p className="wallet-note">No publicly authorised verified creator records available. No sample users or follower counts.</p>}
  </section>
  <section className="creator-preflight">
   <h2>4. Genuine moderated social activity</h2>
   {profile?.posts.length?<div className="studio-assets">
    {profile.posts.map(post=><article className="studio-asset" key={post.post_id}>
     <p>{post.body}</p><p>Looke Social approved post · {new Date(post.created_at).toLocaleString()}</p>
     {post.approved_media_url&&<p>Approved media URL present (moderated Looke Social source)</p>}
    </article>)}
   </div>:<p className="wallet-note">No trusted, currently authorised public posts. No fabricated likes, followers, reposts or activity.</p>}
  </section>
  <section className="creator-preflight">
   <h2>5. Verified marketplace notifications for this wallet</h2>
   {notifications.length?<div className="studio-assets">{notifications.map(n=>
    <article key={n.tx_hash+n.event_kind} className="studio-asset">
     <strong>{n.event_kind.replaceAll("_"," ")} · block #{n.block_number}</strong>
     <p>Independent canonical M9 evidence: {n.source_kind}</p>
     <a href={ULTRA_TESTNET.explorerUrl+"/tx/"+n.tx_hash} target="_blank" rel="noopener noreferrer">
      Inspect independently attested Testnet transaction</a>
    </article>)}</div>:<p className="wallet-note">No independently verified market transactions or wallet notifications. This is not evidence of zero network activity.</p>}
  </section>
  <p className="wallet-note" role="status">{message}</p>
  <p className="wallet-note"><Link href="/market/operations">Verified read-only orderbook</Link> · <Link href="/explore">Indexed NFT collections</Link> · <Link href="/portfolio">My verified ownership index</Link></p>
 </section>;
}
