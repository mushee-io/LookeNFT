import {test} from "node:test";
import assert from "node:assert/strict";
import { zipStore, utf8 } from "../lib/generative/zip";
test("creates a ZIP with valid local/central/end signatures",async()=>{
 const blob=zipStore([
  {name:"metadata/00001.json",bytes:utf8('{"name":"Ultra Punks #1"}')},
  {name:"README.txt",bytes:utf8("Local preview export")}
 ]);
 const data=new DataView(await blob.arrayBuffer());
 assert.equal(data.getUint32(0,true),0x04034b50);
 assert.equal(data.getUint32(blob.size-22,true),0x06054b50);
 assert.equal(data.getUint16(blob.size-22+8,true),2);
 assert.ok(blob.size > 100);
});
test("prevents duplicate or traversing filenames",()=>{
 assert.throws(()=>zipStore([{name:"../steal.txt",bytes:utf8("x")}]));
 assert.throws(()=>zipStore([{name:"a.txt",bytes:utf8("1")},{name:"a.txt",bytes:utf8("2")}]));
});
