import Link from "next/link";
import { isAddress } from "viem";
import { curatedCollections } from "@/lib/server/curation";
import FreePublicMintFlow from "@/components/FreePublicMintFlow";
export const dynamic="force-dynamic";
export default async function MintPage({searchParams}:{searchParams:Promise<{collection?:string}>}){
 const query=await searchParams;
 const address=query.collection||"";
 if(!isAddress(address,{strict:false}))return <section className="curated-mint-blocked"><h1>Choose an official NFT collection</h1><p>Enter through a deployed Ultra EVM Testnet collection. Free minting is controlled by its creator-owned smart contract.</p><Link href="/explore">Browse collections →</Link></section>;
 let drop;
 try {drop=(await curatedCollections(false,address.toLowerCase()))[0];}
 catch {return <section className="curated-mint-blocked"><h1>Unable to verify collection</h1><p>The Ultra EVM Testnet contract or collection record could not be verified. No mint transaction can be submitted.</p><Link href="/explore">← Collections</Link></section>;}
 if(!drop)return <section className="curated-mint-blocked"><h1>Collection not found</h1><p>This NFT contract has not been registered on LookeNFT.</p><Link href="/explore">← Collections</Link></section>;
 if(!drop.mintAvailable)return <section className="curated-mint-blocked"><h1>Enable free mint on Ultra Testnet</h1><p>There is no active free public mint phase verified for this contract right now. LookeNFT admin approval is not required. The collection owner can open one using their connected Ultra Testnet wallet and pay only Testnet gas.</p><Link href={"/collection/"+drop.address}>Manage Collection → Enable free mint</Link></section>;
 return <FreePublicMintFlow collection={drop.address} phaseId={drop.phaseId}/>;
}
