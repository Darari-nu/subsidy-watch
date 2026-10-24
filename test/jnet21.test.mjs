import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseJnet21Rss, parseJapaneseDate, cleanExtraction, mergeJnetItems, jnetRecord, extractPending, activeJnetRecords, fetchArticleText, safeArticleUrl, extractionUsage } from "../scripts/lib/jnet21.mjs";

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
  const old={...item,id:"jn-1",article_number:"1",first_seen:"2026-10-01"};
  const expired={...item,id:"jn-2",article_number:"2"};
  const retained=activeJnetRecords([item,item,old,expired],{
    [item.id]:{prefecture:"香川県",municipality:"観音寺市",deadline:null,start:null,max_limit:null},
    [old.id]:{prefecture:"香川県",municipality:null,deadline:null,start:null,max_limit:null},
    [expired.id]:{prefecture:"香川県",municipality:null,deadline:"2026-10-23",start:null,max_limit:null}
  },"2026-12-08");
  assert.equal(retained.length,1);assert.equal(retained[0].id,item.id);
  const aged={...item,first_seen:"2026-10-24"};
  assert.equal(activeJnetRecords([aged],{[item.id]:{prefecture:"香川県",deadline:null,start:null,max_limit:null}},"2026-12-09").length,0);
});

const today = "2026-10-24";
const options = {today, fetchImpl:async()=>({ok:true,text:async()=>"記事の本文"})};
const itemFor = (n, extra={}) => ({...parseJnet21Rss(xml)[0], id:`jn-${n}`,article_number:String(n),first_seen:today,...extra});
const extraction = {prefecture:"熊本県",municipality:null,deadline:"2026-11-09",start:null,max_limit:null,who:"対象",what:"資機材",amount:"不明",note:"不明"};
const response = (value=extraction) => ({content:[{type:"text",text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:20}});

test("記事取得が成功→失敗→成功でも再課金せず本文を保持する",async()=>{
  let calls=0;
  const client={messages:{create:async()=>{calls++;return response();}}};
  const item=itemFor(1), cache={};
  await extractPending([item],cache,client,options);
  const saved={...cache[item.id]};
  await extractPending([item],cache,client,{...options,fetchImpl:async()=>{throw new Error("offline");}});
  assert.deepEqual(cache[item.id],saved);
  await extractPending([item],cache,client,options);
  assert.equal(calls,1);
  assert.equal(cache[item.id].page_text,"記事の本文");
});

test("新着を優先し、期限切れと45日超の記事には取得も抽出もしない",async()=>{
  const expired=itemFor(1), aged=itemFor(2,{first_seen:"2026-09-01"});
  const newest=itemFor(3,{date:"2026-10-24T09:00:00+09:00"});
  const cache={[expired.id]:{...extraction,deadline:"2026-10-23"}};
  const fetched=[];
  const result=await extractPending([expired,aged,itemFor(4),newest],cache,{messages:{create:async()=>response()}},{...options,maxPerRun:1,fetchImpl:async url=>{fetched.push(url);return {ok:true,text:async()=>"本文"};}});
  assert.equal(result.succeeded,1);
  assert.deepEqual(fetched,["https://j-net21.smrj.go.jp/snavi/articles/3"]);
  const inactive=await extractPending([expired,aged],cache,{messages:{create:async()=>{assert.fail("期限外の記事を抽出した");}}},{...options,fetchImpl:async()=>{assert.fail("期限外の記事を取得した");}});
  assert.equal(inactive.attempted,0);
});

for(const [name,error] of [
  ["401",Object.assign(new Error("unauthorized"),{status:401})],
  ["残高不足",Object.assign(new Error("credit balance too low"),{status:400})],
  ["429",Object.assign(new Error("rate limited"),{status:429})],
  ["通信例外",new Error("offline")]
]) test(`${name}でも途中の成功キャッシュと使用量・件数を保持する`,async()=>{
  let calls=0;
  const cache={};
  const result=await extractPending([itemFor(1),itemFor(2),itemFor(3)],cache,{messages:{create:async()=>{if(++calls===2)throw error;return response();}}},options);
  assert.ok(cache["jn-1"]);assert.equal(cache["jn-2"],undefined);
  assert.equal(calls,2);
  const log=extractionUsage(result);
  assert.equal(log.attempted,2);assert.equal(log.summarized,1);assert.equal(log.api_failed,1);
  assert.equal(log.parse_failed,0);assert.equal(log.input_tokens,10);assert.equal(log.output_tokens,20);
  assert.ok(log.stop_reason);
});

test("6件成功を6件と記録し、解析失敗だけでは成功件数を増やさない",async()=>{
  const success=await extractPending(Array.from({length:6},(_,i)=>itemFor(i+1)),{},{messages:{create:async()=>response()}},options);
  assert.equal(extractionUsage(success).summarized,6);
  assert.equal(success.attempted,6);
  const failure=await extractPending([itemFor(9)],{},{messages:{create:async()=>({content:[{type:"text",text:"壊れたJSON"}],usage:{input_tokens:10,output_tokens:3}})}},options);
  assert.equal(extractionUsage(failure).summarized,0);
  assert.equal(failure.parse_failed,1);assert.equal(failure.input_tokens,10);
});

test("不正日付・欠落・解釈不能をnullと区別し有効なキャッシュを保持する",async()=>{
  for(const value of ["2027-02-30","令和9年2月30日","不明",undefined,23,""]){
    assert.equal(cleanExtraction({...extraction,deadline:value},itemFor(1)),null);
    assert.equal(cleanExtraction({...extraction,start:value},itemFor(1)),null);
  }
  assert.ok(cleanExtraction({...extraction,deadline:null,start:null},itemFor(1)));
  const cache={"jn-1":{...extraction,hash:"previous",page_text:"旧本文"}};
  const saved={...cache["jn-1"]};
  const result=await extractPending([itemFor(1)],cache,{messages:{create:async()=>response({...extraction,deadline:"2027-02-30"})}},options);
  assert.equal(result.parse_failed,1);assert.deepEqual(cache["jn-1"],saved);
});

test("不正URLを拒否し、公開URLは記事番号から組み立てる",async()=>{
  let fetched=0;
  for(const url of ["javascript:alert(1)//123","https://evil.example/snavi/articles/123","http://j-net21.smrj.go.jp/snavi/articles/123","https://j-net21.smrj.go.jp.evil.example/snavi/articles/123","https://user@j-net21.smrj.go.jp/snavi/articles/123","https://j-net21.smrj.go.jp/other/123"]){
    assert.equal(safeArticleUrl(url),null);
    assert.equal(await fetchArticleText(url,async()=>{fetched++;}),null);
    assert.equal(parseJnet21Rss(`<item><link>${url}</link><dc:subject>補助金</dc:subject></item>`).length,0);
  }
  assert.equal(fetched,0);
  const item=itemFor(123,{link:"javascript:alert(1)//123"});
  assert.equal(jnetRecord(item,extraction,today).source_url,"https://j-net21.smrj.go.jp/snavi/articles/123");
});

test("リダイレクトを手動で検査し、同ホストの記事パスだけ追う",async()=>{
  for(const destination of ["https://evil.example/snavi/articles/2","http://j-net21.smrj.go.jp/snavi/articles/2","/other/2"]){
    let calls=0;
    assert.equal(await fetchArticleText("https://j-net21.smrj.go.jp/snavi/articles/1",async(_url,init)=>{
      calls++;assert.equal(init.redirect,"manual");return {status:302,headers:new Headers({location:destination})};
    }),null);
    assert.equal(calls,1);
  }
  const urls=[];
  assert.equal(await fetchArticleText("https://j-net21.smrj.go.jp/snavi/articles/1",async url=>{
    urls.push(url);return urls.length===1?{status:302,headers:new Headers({location:"/snavi/articles/2"})}:{ok:true,text:async()=>"本文"};
  }),"本文");
  assert.equal(urls[1],"https://j-net21.smrj.go.jp/snavi/articles/2");
});
