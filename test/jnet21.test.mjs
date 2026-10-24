import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseJnet21Rss, parseJapaneseDate, cleanExtraction, mergeJnetItems, jnetRecord, extractPending, activeJnetRecords } from "../scripts/lib/jnet21.mjs";

const xml=await readFile(new URL("./fixtures/jnet21.xml",import.meta.url),"utf8");
test("J-Net21 fixtureから補助金情報だけ解析して市町村を保持する",()=>{
  const items=parseJnet21Rss(xml);
  assert.equal(items.length,6);
  assert.equal(items.find(x=>x.id==="jn-194685").coverage_label,"香川県");
  assert.equal(items.some(x=>x.id==="jn-194696"),false);
});
test("令和年月日を西暦へ変換し、不正な日付は拒否する",()=>{
  assert.equal(parseJapaneseDate("申請期限：令和8年11月9日（月曜日）"),"2026-11-09");
  assert.equal(parseJapaneseDate("令和9年2月30日"),null);
});
test("抽出結果を検証し、coverageを都道府県の補完に使う",()=>{
  const item=parseJnet21Rss(xml)[1];
  const result=cleanExtraction({prefecture:"未知",municipality:"観音寺市",deadline:"令和9年1月29日",start:null,max_limit:"不明",who:"対象",what:"事業",amount:"不明",note:"不明"},item);
  assert.equal(result.prefecture,"香川県");
  assert.equal(result.deadline,"2027-01-29");
  assert.equal(result.max_limit,null);
});
test("AI抽出をモックし、未処理項目だけキャッシュする",async()=>{
  const item={...parseJnet21Rss(xml)[0],description:"<b>申請期限：令和8年11月9日</b>"};
  let calls=0;
  const client={messages:{create:async()=>{calls++;return {content:[{type:"text",text:JSON.stringify({prefecture:"熊本県",municipality:null,deadline:"2026-11-09",start:null,max_limit:null,who:"不明",what:"資機材",amount:"不明",note:"不明"})}],usage:{input_tokens:10,output_tokens:20}};}}};
  const first=await extractPending([item],{},client,{fetchImpl:async()=>({ok:false}),onUsage:()=>{}});
  const second=await extractPending([item],first.cache,client,{fetchImpl:async()=>({ok:false})});
  assert.equal(calls,1);assert.ok(second.cache[item.id]);
});
test("蓄積はid重複を統合し初回検知日を維持する",()=>{
  const one={id:"jn-1",first_seen:"2026-10-01",title:"旧"};
  const merged=mergeJnetItems([one],[{id:"jn-1",title:"新"},{id:"jn-2",title:"追加"}],"2026-10-24");
  assert.equal(merged.length,2);assert.equal(merged[0].title,"新");assert.equal(merged[0].first_seen,"2026-10-01");
});
test("締切なしは45日まで残り、締切切れと重複を合流時に除く",()=>{
  const item=parseJnet21Rss(xml)[1];
  const record=jnetRecord(item,{prefecture:"香川県",municipality:"観音寺市",deadline:null,start:null,max_limit:null,who:"不明",what:"不明",amount:"不明",note:"不明"},"2026-10-24");
  assert.equal(record.end,null);assert.equal(record.municipality,"観音寺市");
  const old={...item,id:"jn-old",first_seen:"2026-10-01"};
  const expired={...item,id:"jn-expired"};
  const retained=activeJnetRecords([item,item,old,expired],{
    [item.id]:{prefecture:"香川県",municipality:"観音寺市",deadline:null,start:null,max_limit:null},
    [old.id]:{prefecture:"香川県",municipality:null,deadline:null,start:null,max_limit:null},
    [expired.id]:{prefecture:"香川県",municipality:null,deadline:"2026-10-23",start:null,max_limit:null}
  },"2026-12-08");
  assert.equal(retained.length,1);assert.equal(retained[0].id,item.id);
  const aged={...item,first_seen:"2026-10-24"};
  assert.equal(activeJnetRecords([aged],{[item.id]:{prefecture:"香川県",deadline:null,start:null,max_limit:null}},"2026-12-09").length,0);
});
