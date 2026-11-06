import Link from "next/link";

/**
 * The design studio is a public local preview. Real collection deployment,
 * registration and publication are protected by server-side operator checks.
 * Keep the Create navigation visible even if wallet restoration is delayed.
 */
export default function OperatorCreateNav(){
 return <Link href="/create" className="operator-create-nav">+ Create</Link>;
}
