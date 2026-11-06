import { NextRequest } from "next/server";
import { curatedCollections, requireOperator, releaseMintEnabled, validateCoverUrl, verifyOperatorCollection } from "@/lib/server/curation";
import { getDb } from "@/lib/server/db";
import { ApiError, apiFailure, guardMutation, noStore, parseBody } from "@/lib/server/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  try{
    await requireOperator(request);
    return noStore({collections:await curatedCollections(false),mintReleaseOpen:releaseMintEnabled()});
  }catch(e){return apiFailure(e);}
}
export async function POST(request:NextRequest){
  try{
    guardMutation(request);
    const wallet=await requireOperator(request);
    const body=await parseBody(request,5000);
    if(Object.keys(body).some(x=>!["address","title","description","coverUrl","phaseId"].includes(x)))
      throw new ApiError(400,"Unsupported collection field");
    if(typeof body.address!=="string")throw new ApiError(400,"Contract address required");
    const title=typeof body.title==="string"?body.title.trim():"";
    const description=typeof body.description==="string"?body.description.trim():"";
    if(title.length<2||title.length>90||description.length>1200)
      throw new ApiError(400,"Invalid collection title or description");
    const phase=typeof body.phaseId==="string"?body.phaseId:"1";
    if(!/^(?:[1-9]|[1-9][0-9])$|^100$/.test(phase))throw new ApiError(400,"Mint phase must be between 1 and 100");
    const coverUrl=validateCoverUrl(body.coverUrl);
    const verified=await verifyOperatorCollection(body.address,wallet);
    const r=await getDb().query(
      `INSERT INTO looke_curated_collections
        (contract_address,operator_wallet,title,description,cover_url,mint_phase_id)
       VALUES($1,$2,$3,$4,$5,$6::bigint)
       ON CONFLICT(chain_id,contract_address) DO NOTHING
       RETURNING contract_address`,
      [verified.address,wallet,title,description,coverUrl,phase]
    );
    if(r.rowCount!==1)throw new ApiError(409,"Collection is already registered; publishing is a separate action");
    return noStore({created:true,address:verified.address,status:"draft",mintAvailable:false},201);
  }catch(e){return apiFailure(e);}
}
export async function PATCH(request:NextRequest){
  try{
    guardMutation(request);
    const wallet=await requireOperator(request);
    const body=await parseBody(request,1500);
    if(typeof body.address!=="string"||typeof body.action!=="string"||
      Object.keys(body).some(x=>!["address","action"].includes(x)))
      throw new ApiError(400,"Only address and action are allowed");
    if(!["publish","unpublish","enableMint","disableMint"].includes(body.action))
      throw new ApiError(400,"Invalid catalogue action");
    const existing=await curatedCollections(false,body.address.toLowerCase());
    if(!existing.length)throw new ApiError(404,"Unknown curated collection");
    if(body.action==="publish"||body.action==="enableMint")
      await verifyOperatorCollection(body.address,wallet);
    if(body.action==="enableMint"&&!releaseMintEnabled())
      throw new ApiError(409,"Minting cannot be enabled while the independent release and M12 financial gates are closed");
    const next=body.action==="publish" ? "status='published',published_at=coalesce(published_at,now())"
      :body.action==="unpublish" ? "status='draft',mint_enabled=FALSE,published_at=NULL"
      :body.action==="enableMint" ? "mint_enabled=TRUE"
      : "mint_enabled=FALSE";
    if(body.action==="enableMint"&&existing[0].status!=="published")
      throw new ApiError(409,"Publish collection before opening mint");
    // The SQL fragment comes exclusively from the fixed action map above.
    await getDb().query(
      "UPDATE looke_curated_collections SET "+next+",updated_at=now() WHERE chain_id=18881 AND contract_address=$1 AND operator_wallet=$2",
      [body.address.toLowerCase(),wallet]
    );
    return noStore({updated:true,address:body.address.toLowerCase(),action:body.action,
      collections:await curatedCollections(false,body.address.toLowerCase())});
  }catch(e){return apiFailure(e);}
}
