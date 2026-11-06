"use client";
import Link from "next/link";
import { useWalletSession } from "@/components/WalletSessionProvider";

/**
 * Authenticated wallets can TRY the local, unpersisted editor, but creation,
 * database registration and publication remain server-side operator-only.
 */
export default function OperatorCreateNav(){
 const wallet=useWalletSession();
 return wallet.authenticated&&wallet.chainId===18881
  ? <Link href="/create" className="operator-create-nav">+ Create</Link>
  : null;
}
