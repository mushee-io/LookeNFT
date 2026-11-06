import Link from "next/link";
import { isAddress } from "viem";
import { curatedCollections } from "@/lib/server/curation";
import CuratedMintFlow from "@/components/CuratedMintFlow";
export const dynamic="force-dynamic";
export default async function MintPage({searchParams}:{searchParams:Promise<{collection?:string}>}){
 const query=await searchParams;
 const address=query.collection||"";
 if(!isAddress(address,{strict:false}))return <section className="curated-mint-blocked"><h1>Choose an official NFT collection</h1><p>Minting is available only from a LookeNFT-published drop.</p><Link href="/explore">Browse collections →</Link></section>;
 let drop;
 try {drop=(await curatedCollections(true,address.toLowerCase()))[0];}
 catch {return <section className="curated-mint-blocked"><h1>Mint service unavailable</h1><p>Unable to verify the official collection registry. No mint transaction can be started here.</p><Link href="/explore">← Collections</Link></section>;}
 if(!drop||!drop.mintAvailable)return <section className="curated-mint-blocked"><h1>Minting is not open</h1><p>This collection is not published or has not been approved for wallet-signed Testnet minting.</p><Link href="/explore">← Official collections</Link></section>;
 return <CuratedMintFlow collection={drop.address} phaseId={drop.phaseId}/>;
}
