import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { appOrigin, guardMutation, ApiError } from "../lib/server/http";

const preview = "https://looke-a1b2c3-mushee-ios-projects.vercel.app";
test("preview wallet sign-in uses the exact assigned Vercel origin",()=>{
 const req = new NextRequest(preview+"/api/auth/challenge",{method:"POST",headers:{
   origin:preview,"content-type":"application/json"
 },body:"{}"});
 assert.equal(appOrigin(req).origin,preview);
 assert.doesNotThrow(()=>guardMutation(req));
});
test("production hostname remains valid, including a URL with a path",()=>{
 const req=new NextRequest("https://looke-ss.vercel.app/api/auth/verify",{method:"POST",headers:{
 origin:"https://looke-ss.vercel.app","content-type":"application/json"
 },body:"{}"});
 assert.equal(appOrigin(req).origin,"https://looke-ss.vercel.app");
 assert.doesNotThrow(()=>guardMutation(req));
});
test("arbitrary third-party Vercel domains and forged origins fail closed",()=>{
 const rogue=new NextRequest("https://some-other-app.vercel.app/api/auth/challenge",{method:"POST",headers:{
 origin:"https://some-other-app.vercel.app","content-type":"application/json"
 },body:"{}"});
 assert.throws(()=>guardMutation(rogue),(e:unknown)=>e instanceof ApiError&&e.status===403);
 const forged=new NextRequest(preview+"/api/auth/challenge",{method:"POST",headers:{
 origin:"https://malicious.example","content-type":"application/json"
 },body:"{}"});
 assert.throws(()=>guardMutation(forged),(e:unknown)=>e instanceof ApiError&&e.status===403);
});
test("cross-origin text/plain or missing browser Origin headers remain rejected",()=>{
 const missing=new NextRequest(preview+"/api/auth/challenge",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
 assert.throws(()=>guardMutation(missing),(e:unknown)=>e instanceof ApiError&&e.status===403);
 const plain=new NextRequest(preview+"/api/auth/challenge",{method:"POST",headers:{
 origin:preview,"content-type":"text/plain"
 },body:"{}"});
 assert.throws(()=>guardMutation(plain),(e:unknown)=>e instanceof ApiError&&e.status===415);
});
