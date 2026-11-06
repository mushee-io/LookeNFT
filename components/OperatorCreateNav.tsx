"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWalletSession } from "@/components/WalletSessionProvider";

/** Never advertise public collection creation. Only a server-verified operator sees Create. */
export default function OperatorCreateNav(){
  const wallet=useWalletSession();
  const [allowed,setAllowed]=useState(false);
  useEffect(()=>{
    setAllowed(false);
    if(!wallet.authenticated || wallet.chainId!==18881)return;
    const controller=new AbortController();
    fetch("/api/admin/collections",{credentials:"same-origin",cache:"no-store",signal:controller.signal})
      .then(r=>{if(r.ok&&!controller.signal.aborted)setAllowed(true);})
      .catch(()=>{});
    return()=>controller.abort();
  },[wallet.authenticated,wallet.address,wallet.chainId]);
  return allowed?<Link href="/create" className="operator-create-nav">+ Create</Link>:null;
}
