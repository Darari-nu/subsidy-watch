import { createHash } from "node:crypto";
import { htmlToText, hashSource } from "./summary.mjs";
import { PREFECTURES, normalizeAreas } from "./areas.mjs";
import { classifyStatus, todayInJapan } from "./classification.mjs";

const decode = (s) => String(s ?? "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const tag = (xml, name) => {
  const m = String(xml).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return decode(cdata ? cdata[1] : m[1].replace(/<[^>]+>/g," ")).trim();
};

const ARTICLE_BASE = "https://j-net21.smrj.go.jp/snavi/articles/";
export const articleUrl = (number) => /^\d+$/.test(String(number ?? "")) ? `${ARTICLE_BASE}${number}` : null;
export function safeArticleUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://j-net21.smrj.go.jp" || url.username || url.password) return null;
    const number = url.pathname.match(/^\/snavi\/articles\/(\d+)\/?$/)?.[1];
    return number && !url.search && !url.hash ? articleUrl(number) : null;
  } catch { return null; }
}

export function parseJnet21Rss(xml, includeKeywords = ["補助金", "助成金"]) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
    const x=m[1], link=safeArticleUrl(tag(x,"link"));
    const no=link?.split("/").at(-1);
    const coverage=x.match(/<dc:coverage\b[^>]*>([\s\S]*?)<\/dc:coverage>/i)?.[1] ?? "";
    return { id:no ? `jn-${no}` : null, article_number:no, title:tag(x,"title"), link, description:tag(x,"description"), subject:tag(x,"dc:subject"), coverage_value:tag(coverage,"rdf:value"), coverage_label:tag(coverage,"rdf:label"), date:tag(x,"dc:date") };
  }).filter((item)=>item.id && includeKeywords.some((word)=>item.subject.split(/\s+-\s+/u).at(-1)?.includes(word)));
}

export function mergeJnetItems(oldItems, freshItems, firstSeen) {
  const map=new Map(oldItems.map((x)=>[x.id,x]));
  for (const item of freshItems) map.set(item.id,{...map.get(item.id),...item,first_seen:map.get(item.id)?.first_seen ?? firstSeen});
  return [...map.values()];
}

export function parseJapaneseDate(text) {
  const m=String(text??"").match(/令和\s*([元\d０-９]+)年\s*(\d{1,2}|[０-９]{1,2})月\s*(\d{1,2}|[０-９]{1,2})日/u);
  if (!m) return null;
  const n=m[1]==="元"?1:Number(m[1].replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)));
  const nums=[m[2],m[3]].map((v)=>Number(v.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))));
  return validDate(`${2018+n}-${String(nums[0]).padStart(2,"0")}-${String(nums[1]).padStart(2,"0")}`);
}
export function validDate(value) {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value ? value : null;
}

export function buildJnetSource(item, pageText="") {
  return [`制度名: ${item.title}`,`本文: ${htmlToText(item.description)}`,pageText?`記事ページ本文: ${htmlToText(pageText).slice(0,6000)}`:""].filter(Boolean).join("\n").slice(0,12000);
}
export async function fetchArticleText(url, fetchImpl=fetch) {
  let current = safeArticleUrl(url);
  if (!current) return null;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const r = await fetchImpl(current, {redirect:"manual", headers:{"User-Agent":"subsidy-watch/1.0 (+https://github.com/)"}, signal:AbortSignal.timeout(15000)});
      if ([301,302,303,307,308].includes(r.status)) {
        const location = r.headers?.get("location");
        current = location && safeArticleUrl(new URL(location, current).href);
        if (!current) return null;
        continue;
      }
      if (!r.ok || (r.url && !safeArticleUrl(r.url))) return null;
      return htmlToText(await r.text()).slice(0,6000);
    }
  } catch { /* 取得失敗は空本文による更新と区別する */ }
  return null;
}

export function cleanExtraction(value, item) {
  if(!value||typeof value!=="object") return null;
  let prefecture=PREFECTURES.includes(value.prefecture)?value.prefecture:null;
  if(!prefecture && PREFECTURES.includes(item.coverage_label)) prefecture=item.coverage_label;
  if(!prefecture) return null;
  const str=(x)=>typeof x==="string"&&x.trim()?x.trim().slice(0,500):null;
  let deadline=validDate(value.deadline) ?? parseJapaneseDate(value.deadline);
  let start=validDate(value.start) ?? parseJapaneseDate(value.start);
  if ((value.deadline !== null && !deadline) || (value.start !== null && !start)) return null;
  if (start && deadline && start > deadline) return null;
  const limit=value.max_limit===null?null:(Number.isInteger(value.max_limit)&&value.max_limit>=0?value.max_limit:null);
  return {prefecture,municipality:str(value.municipality),deadline,start,max_limit:limit,who:str(value.who)??"不明",what:str(value.what)??"不明",amount:str(value.amount)??"不明",note:str(value.note)??"不明"};
}

export async function extractPending(items, cache, client, {model="claude-haiku-5-5",maxPerRun=40,fetchImpl=fetch,onUsage=()=>{},today=todayInJapan()}={}) {
  const stats = {attempted:0, succeeded:0, parse_failed:0, api_failed:0, input_tokens:0, output_tokens:0, stop_reason:null};
  const ordered = [...new Map(items.map(item => [item.id, item])).values()]
    .sort((a,b) => (b.date ?? b.first_seen ?? "").localeCompare(a.date ?? a.first_seen ?? ""));
  for (const item of ordered) {
    if (stats.attempted >= maxPerRun) break;
    const old = cache[item.id];
    if (old?.deadline && old.deadline < today) continue;
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${item.first_seen ?? item.date?.slice(0,10) ?? today}T00:00:00Z`)) / 86_400_000;
    if (!old?.deadline && age > 45) continue;
    const url = articleUrl(item.article_number);
    if (!url || item.id !== `jn-${item.article_number}`) continue;
    const fetched = await fetchArticleText(url, fetchImpl);
    // 障害時は既存の本文も抽出も保持し、再課金しない。
    if (fetched === null && old) continue;
    const page = fetched ?? "";
    const source = buildJnetSource(item, page), hash = hashSource(source);
    if (old?.hash === hash) {
      cache[item.id] = {...old, page_text:page};
      continue;
    }
    stats.attempted++;
    try {
      const result=await client.messages.create({model,max_tokens:2000,system:`与えられたJ-Net21の記事テキストだけを根拠に、厳密なJSONのみ返してください。形式: {"prefecture":"都道府県","municipality":null,"deadline":"YYYY-MM-DDまたはnull","start":"YYYY-MM-DDまたはnull","max_limit":整数またはnull,"who":"対象者または不明","what":"用途または不明","amount":"金額要点または不明","note":"注意点または不明"}。推測禁止。令和N年は西暦2018+N。`,messages:[{role:"user",content:source}]});

      const usage = result.usage ?? {};
      stats.input_tokens += usage.input_tokens ?? 0;
      stats.output_tokens += usage.output_tokens ?? 0;
      onUsage(usage);
      const text = result.content?.filter(x=>x.type==="text").map(x=>x.text).join("") ?? "";
      let parsed;
      try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { parsed = null; }
      const extracted = cleanExtraction(parsed,item);
      if (!extracted) { stats.parse_failed++; continue; }
      cache[item.id] = {hash,...extracted,page_text:page,model,at:new Date().toISOString()};
      stats.succeeded++;
    } catch (error) {
      stats.api_failed++;
      const billing = /credit balance|billing/i.test(error?.message ?? "") || [error?.error?.error?.type,error?.error?.type].includes("billing_error");
      stats.stop_reason = billing ? "api_status_billing" : `api_status_${error?.status ?? "error"}`;
      break;
    }
  }
  return {cache,done:stats.attempted,...stats};
}

export function jnetRecord(item, extracted, firstSeen, screening={}) {
  const title=item.title.replace(/^【[^】]+】\s*/u,"").replace(/^補助金・助成金\s*[：:]\s*/u,"").trim();
  const normalized=normalizeAreas({area:extracted.prefecture,title:`【${extracted.prefecture}】${title}`},screening);
  return {id:item.id,title,area:extracted.prefecture,areas:normalized.areas,employees:"規模指定なし",max_limit:extracted.max_limit,start:extracted.start,end:extracted.deadline,status:classifyStatus({start:extracted.start,end:extracted.deadline,first_seen:item.first_seen??firstSeen},firstSeen),source:"jnet21",source_url:articleUrl(item.article_number),official_url:null,catch:"",municipality:extracted.municipality,first_seen:item.first_seen??firstSeen};
}

export function activeJnetRecords(items, extracted, today, screening={}) {
  const todayMs=Date.parse(`${today}T00:00:00Z`), seen=new Set(), records=[];
  for(const item of items){
    if(seen.has(item.id)||!extracted[item.id] || !articleUrl(item.article_number) || item.id !== `jn-${item.article_number}` ) continue;
    const clean = cleanExtraction(extracted[item.id],item);
    if (!clean) continue;
    seen.add(item.id);
    const record=jnetRecord(item,clean,today,screening);
    if(record.end ? record.end>=today : (todayMs-Date.parse(`${record.first_seen}T00:00:00Z`))/86_400_000<=45) records.push(record);
  }
  return records;
}

export const shaSource=(text)=>createHash("sha256").update(text).digest("hex");

export function extractionUsage(result) {
  return {
    at:new Date().toISOString(),model:"claude-haiku-5-5",source:"jnet21",
    attempted:result.attempted,summarized:result.succeeded,succeeded:result.succeeded,
    parse_failed:result.parse_failed,api_failed:result.api_failed,
    failed:result.parse_failed+result.api_failed,stop_reason:result.stop_reason,
    input_tokens:result.input_tokens,output_tokens:result.output_tokens
  };
}
