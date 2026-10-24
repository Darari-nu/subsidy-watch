import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { classifyStatus, subsidyCounts, upcomingLabel, validPreviousJgrants, mergeCollected, todayInJapan } from "../scripts/lib/classification.mjs";
import { activeJnetRecords } from "../scripts/lib/jnet21.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const schema=JSON.parse(await readFile(new URL("../schema/subsidy.schema.json",import.meta.url),"utf8"));
const ajv=new Ajv2020({strict:true});addFormats(ajv);
const validate=ajv.compile(schema);

test("受付開始前・当日・締切30日の境界と件数、schemaが一致する",()=>{
  const record={start:"2026-11-02",end:"2026-11-09",first_seen:"2026-10-24"};
  assert.equal(classifyStatus(record,"2026-10-24"),"upcoming");
  assert.equal(classifyStatus(record,"2026-11-02"),"closing_soon");
  assert.equal(upcomingLabel(record.start),"受付前（11/2〜）");
  const items=[{id:"jn-1",article_number:"1",title:"制度",first_seen:"2026-10-24"}];
  const records=activeJnetRecords(items,{"jn-1":{prefecture:"香川県",municipality:"観音寺市",deadline:record.end,start:record.start,max_limit:null}},"2026-10-24");
  assert.equal(validate(records),true,JSON.stringify(validate.errors));
  assert.equal(records[0].status,"upcoming");
  assert.deepEqual(subsidyCounts(records),{open:0,closing:0,upcoming:1});
  assert.equal(validate([{...records[0],source_url:"javascript:alert(1)//123"}]),false);
});

test("持ち越しはjGrants限定、ID統合は蓄積側J-Net21を正にする",()=>{
  const jgrants={id:"jg",source:"jgrants",end:"2027-01-01"};
  const stale={id:"jn-1",source:"jnet21",title:"旧",end:"2027-01-01"};
  const fresh={...stale,title:"蓄積"};
  assert.deepEqual(validPreviousJgrants([jgrants,stale],"2026-10-24"),[jgrants]);
  for(const collected of [[stale,jgrants],[jgrants,stale]]){
    const merged=mergeCollected(collected,[fresh,fresh]);
    assert.equal(merged.length,2);assert.equal(merged.find(x=>x.id==="jn-1").title,"蓄積");
  }
});

for(const mode of ["all-failed","partial","sudden-drop"]){
  test(`collect→classify: ${mode}でも重複せず蓄積を採用する（APIモック）`,async()=>{
    const dir=await mkdtemp(join(tmpdir(),"subsidy-audit-"));
    try{
      await cp(join(root,"scripts"),join(dir,"scripts"),{recursive:true});
      await symlink(join(root,"node_modules"),join(dir,"node_modules"));
      for(const name of ["data","config",".cache"])await mkdir(join(dir,name));
      const writeJson=async(name,data)=>writeFile(join(dir,name),JSON.stringify(data));
      const today=todayInJapan();
      const previous=Array.from({length:4},(_,i)=>({id:`jg-${i}`,source:"jgrants",title:"前回",area:"全国",areas:["全国"],end:"2099-12-31",start:null,first_seen:today}));
      previous.push({id:"jn-1",source:"jnet21",title:"古い持ち越し",end:"2099-12-31",first_seen:today});
      await writeJson("data/subsidies.json",previous);
      await writeJson("data/meta.json",{});
      await writeJson("data/jnet21_items.json",[{id:"jn-1",article_number:"1",title:"蓄積の制度",first_seen:today}]);
      await writeJson("data/jnet21_extracted.json",{"jn-1":{prefecture:"香川県",deadline:"2099-12-31",start:null,max_limit:null}});
      await writeFile(join(dir,"config/sources.yaml"),JSON.stringify({sources:[{id:"jgrants",type:"api",enabled:true,base_url:"https://mock.invalid",keywords:["one","two"]}]}));
      await writeFile(join(dir,"mock.mjs"),`let calls=0; globalThis.fetch=async()=>{ calls++; if(${JSON.stringify(mode)}==="all-failed" || (${JSON.stringify(mode)}==="partial" && calls===2))throw new Error("offline"); return {ok:true,json:async()=>({result:[{id:"jg-0",title:"更新",target_area_search:"全国",acceptance_end_datetime:"2099-12-31"}]})}; };`);
      execFileSync(process.execPath,["--import",join(dir,"mock.mjs"),join(dir,"scripts/collect.mjs")],{stdio:"pipe"});
      const collected=JSON.parse(await readFile(join(dir,".cache/collected.json"),"utf8"));
      assert.equal(collected.length,4);assert.ok(collected.every(x=>x.source==="jgrants"));
      // 古い収集キャッシュが残った場合も分類段で防御する。
      await writeJson(".cache/collected.json",[...collected,previous.at(-1),previous.at(-1)]);
      execFileSync(process.execPath,[join(dir,"scripts/classify.mjs")],{stdio:"pipe"});
      const output=JSON.parse(await readFile(join(dir,"data/subsidies.json"),"utf8"));
      assert.equal(output.length,5);assert.equal(new Set(output.map(x=>x.id)).size,5);
      assert.equal(output.find(x=>x.id==="jn-1").title,"蓄積の制度");
    }finally{await rm(dir,{recursive:true,force:true});}
  });
}
