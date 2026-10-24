import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { parseJnet21Rss, mergeJnetItems } from "./lib/jnet21.mjs";

const ROOT=new URL("../",import.meta.url), CONFIG=new URL("config/sources.yaml",ROOT), STORE=new URL("data/jnet21_items.json",ROOT);
const config=parse(await readFile(CONFIG,"utf8")), source=config.sources.find(x=>x.id==="jnet21"&&x.enabled);
if(!source){console.log("collect_jnet21: 無効のためスキップ");process.exit(0);}
try {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
  let response;
  try { for(let attempt=0;attempt<3;attempt++){try{response=await fetch(source.url,{headers:{"User-Agent":"subsidy-watch/1.0 (+https://github.com/) ",Accept:"application/rss+xml, application/xml, text/xml"},signal:controller.signal}); if(!response.ok)throw new Error(`HTTP ${response.status}`);break;}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,500*2**attempt));}} } finally {clearTimeout(timer);}
  const items=parseJnet21Rss(await response.text(),source.include_keywords);
  let old=[];try{old=JSON.parse(await readFile(STORE,"utf8"));}catch{}
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  await mkdir(new URL("data/",ROOT),{recursive:true});await writeFile(STORE,`${JSON.stringify(mergeJnetItems(old,items,day),null,2)}\n`);
  console.log(`collect_jnet21: ${items.length}件取得、蓄積${mergeJnetItems(old,items,day).length}件`);
} catch(error) { console.warn(`collect_jnet21: 取得失敗（既存データを保持）: ${error.message}`); }
