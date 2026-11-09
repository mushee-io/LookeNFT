import Link from "next/link";

/** Public Ultra EVM Testnet creator entrypoint; never sends transactions automatically. */
export default function OperatorCreateNav(){
 return <Link href="/create" className="operator-create-nav">+ Create</Link>;
}
