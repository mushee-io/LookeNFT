import { NextRequest, NextResponse } from "next/server";
/** Only the curated collection gallery is public-facing; legacy financial UI remains offline. */
const LEGACY = new Set(["/activity","/social-link","/portfolio","/acceptance","/final-acceptance"]);
export function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 if(LEGACY.has(path)||path==="/market"||path.startsWith("/market/")||
     path==="/offers"||path.startsWith("/offers/"))
   return NextResponse.redirect(new URL("/explore",request.url));
 return NextResponse.next();
}
export const config={matcher:["/activity","/social-link","/portfolio","/acceptance","/final-acceptance","/market/:path*","/offers/:path*"]};
