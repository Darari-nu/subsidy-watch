import { createHash } from "node:crypto";
import { htmlToText, hashSource } from "./summary.mjs";
import { PREFECTURES, normalizeAreas } from "./areas.mjs";

const decode = (s) => String(s ?? "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const tag = (xml, name) => {
  const m = String(xml).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return decode(cdata ? cdata[1] : m[1].replace(/<[^>]+>/g," ")).trim();
};

export function parseJnet21Rss(xml, includeKeywords = ["補助金", "助成金"]) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
    const x=m[1], link=tag(x,"link");
    const no=link.match(/\/(\d+)\/?(?:[?#].*)?$/)?.[1];
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
  try { const r=await fetchImpl(url,{headers:{"User-Agent":"subsidy-watch/1.0 (+https://github.com/)"},signal:AbortSignal.timeout(15000)}); if(!r.ok)return ""; return htmlToText(await r.text()).slice(0,6000); } catch { return ""; }
}

export function cleanExtraction(value, item) {
  if(!value||typeof value!=="object") return null;
  let prefecture=PREFECTURES.includes(value.prefecture)?value.prefecture:null;
  if(!prefecture && PREFECTURES.includes(item.coverage_label)) prefecture=item.coverage_label;
  if(!prefecture) return null;
  const str=(x)=>typeof x==="string"&&x.trim()?x.trim().slice(0,500):null;
  let deadline=validDate(value.deadline) ?? parseJapaneseDate(value.deadline);
  let start=validDate(value.start) ?? parseJapaneseDate(value.start);
  const limit=value.max_limit===null?null:(Number.isInteger(value.max_limit)&&value.max_limit>=0?value.max_limit:null);
  return {prefecture,municipality:str(value.municipality),deadline,start,max_limit:limit,who:str(value.who)??"不明",what:str(value.what)??"不明",amount:str(value.amount)??"不明",note:str(value.note)??"不明"};
}

export async function extractPending(items, cache, client, {model="claude-haiku-5-5",maxPerRun=40,fetchImpl=fetch,onUsage=()=>{}}={}) {
  let done=0;
  for(const item of items) {
    if(done>=maxPerRun) break;
    const page=await fetchArticleText(item.link,fetchImpl), source=buildJnetSource(item,page), hash=hashSource(source);
    if(cache[item.id]?.hash===hash) continue;
    const result=await client.messages.create({model,max_tokens:2000,system:`与えられたJ-Net21の記事テキストだけを根拠に、厳密なJSONのみ返してください。形式: {"prefecture":"都道府県","municipality":null,"deadline":"YYYY-MM-DDまたはnull","start":"YYYY-MM-DDまたはnull","max_limit":整数またはnull,"who":"対象者または不明","what":"用途または不明","amount":"金額要点または不明","note":"注意点または不明"}。推測禁止。令和N年は西暦2018+N。`,messages:[{role:"user",content:source}]});
    const usage=result.usage??{}; onUsage(usage);
    const text=result.content?.filter(x=>x.type==="text").map(x=>x.text).join("")??"";
    const match=text.match(/\{[\s\S]*\}/); let parsed; try{parsed=JSON.parse(match?.[0]??"");}catch{parsed=null;}
    const extracted=cleanExtraction(parsed,item); if(extracted) cache[item.id]={hash,...extracted,model,at:new Date().toISOString()};
    done++;
  }
  return {cache,done};
}

export function jnetRecord(item, extracted, firstSeen, screening={}) {
  const title=item.title.replace(/^【[^】]+】\s*/u,"").replace(/^補助金・助成金\s*[：:]\s*/u,"").trim();
  const normalized=normalizeAreas({area:extracted.prefecture,title:`【${extracted.prefecture}】${title}`},screening);
  return {id:item.id,title,area:extracted.prefecture,areas:normalized.areas,employees:"規模指定なし",max_limit:extracted.max_limit,start:extracted.start,end:extracted.deadline,status:"open",source:"jnet21",source_url:item.link,official_url:null,catch:"",municipality:extracted.municipality,first_seen:item.first_seen??firstSeen};
}

export function activeJnetRecords(items, extracted, today, screening={}) {
  const todayMs=Date.parse(`${today}T00:00:00Z`), seen=new Set(), records=[];
  for(const item of items){
    if(seen.has(item.id)||!extracted[item.id]) continue;
    seen.add(item.id);
    const record=jnetRecord(item,extracted[item.id],today,screening);
    if(record.end ? record.end>=today : (todayMs-Date.parse(`${record.first_seen}T00:00:00Z`))/86_400_000<=45) records.push(record);
  }
  return records;
}

export const shaSource=(text)=>createHash("sha256").update(text).digest("hex");
