/**
 * M11 disposable PostgreSQL full logical restore + rollback rehearsal.
 * CI/local ephemeral DB ONLY, never reads or writes operator Postgres.
 * Requires local pg_dump / pg_restore / createdb clients (PostgreSQL 16).
 * A successful local restore is NOT a protected production restore approval.
 */
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {Pool} from "pg";
const url=process.env.DATABASE_URL||"";
const parsed=new URL(url);
if(!["postgres:","postgresql:"].includes(parsed.protocol)||
   !["localhost","127.0.0.1"].includes(parsed.hostname)||
   parsed.pathname!=="/lookenft"||
   process.env.M11_LOCAL_RESTORE_REHEARSAL!=="true")
 throw Error("Full DB rehearsal restricted to opt-in disposable localhost/lookenft CI database");
const name="lookenft_m11_restore_"+randomBytes(6).toString("hex");
const root=mkdtempSync(join(tmpdir(),"lookenft-m11-"));
const dump=join(root,"scratch.backup");
function run(cmd:string,args:string[]){
 const proc=spawnSync(cmd,args,{env:process.env,encoding:"utf8",maxBuffer:5*1024*1024,timeout:110000});
 if(proc.status!==0)throw Error(cmd+" local restore failed: "+String(proc.stderr||proc.stdout).slice(0,1200));
}
const admin=new URL(url);admin.pathname="/postgres";
const target=new URL(url);target.pathname="/"+name;
let created=false,source:Pool|undefined,restored:Pool|undefined;
const details=async(pool:Pool)=>{
 const tables=await pool.query<{tablename:string}>(
  "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename");
 const data:Record<string,string>={};
 for(const row of tables.rows){
  if(!/^nft_[a-z0-9_]+$/.test(row.tablename))throw Error("Unexpected non-NFT restored table: "+row.tablename);
  const found=await pool.query("SELECT count(*)::text AS n FROM public."+row.tablename);
  data[row.tablename]=found.rows[0].n;
 }
 const constraints=await pool.query<{n:string}>(
  "SELECT count(*)::text AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace WHERE ns.nspname='public'");
 return {tables:data,constraints:constraints.rows[0].n};
};
try{
 run("pg_dump",["-Fc","--no-owner","--no-privileges","--file",dump,url]);
 run("createdb",["--maintenance-db",admin.toString(),name]);
 created=true;
 run("pg_restore",["--no-owner","--no-privileges","--exit-on-error","--dbname",target.toString(),dump]);
 source=new Pool({connectionString:url});
 restored=new Pool({connectionString:target.toString()});
 const [before,copy]=await Promise.all([details(source),details(restored)]);
 if(JSON.stringify(before)!==JSON.stringify(copy))throw Error("Restored table/constraint counts differ from source");
 if(Object.keys(before.tables).length<15)throw Error("Unexpected missing historical NFT tables");
 const client=await restored.connect();
 try{
  await client.query("BEGIN");
  const nonce=randomBytes(18).toString("hex");
  const address="0x"+randomBytes(20).toString("hex");
  const token=randomBytes(32).toString("hex");
  await client.query(
   "INSERT INTO nft_wallet_sessions(token_hash,wallet_address,chain_id,expires_at) VALUES($1,$2,18881,now()+interval '1 hour')",
   [token,address]);
  const during=await client.query(
   "SELECT count(*)::int AS n FROM nft_wallet_sessions WHERE token_hash=$1",[token]);
  if(during.rows[0].n!==1)throw Error("Scratch restore write unexpectedly unavailable");
  await client.query("ROLLBACK");
  const after=await client.query(
   "SELECT count(*)::int AS n FROM nft_wallet_sessions WHERE token_hash=$1",[token]);
  if(after.rows[0].n!==0)throw Error("Protected rollback leaked synthetic scratch session");
 }finally{client.release();}
 const [lastSource,lastCopy]=await Promise.all([details(source),details(restored)]);
 if(JSON.stringify(before)!==JSON.stringify(lastSource)||
    JSON.stringify(copy)!==JSON.stringify(lastCopy))
  throw Error("Restore rehearsal changed source or lost scratch integrity");
 console.log(JSON.stringify({status:"LOCAL_EPHEMERAL_RESTORE_AND_ROLLBACK_VERIFIED",
  tables:Object.keys(before.tables).length,constraints:before.constraints,
  sourceUnchanged:true,scratchRollbackPassed:true,
  operatorRestoreApproved:false,independentAuditApproved:false,
  noRealAccountsOrFunds:true,source:"localhost disposable CI database"}));
}catch(err){
 console.error(JSON.stringify({status:"NO_GO_RESTORE_REHEARSAL",error:err instanceof Error?err.message:"unknown"}));
 process.exitCode=1;
}finally{
 if(restored)await restored.end();
 if(source)await source.end();
 if(created)try{run("dropdb",["--maintenance-db",admin.toString(),"--if-exists",name]);}
  catch(e){console.error("Disposable scratch database cleanup failed",e);process.exitCode=1;}
 rmSync(root,{recursive:true,force:true});
}
