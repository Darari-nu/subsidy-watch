import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extractPending } from "./lib/jnet21.mjs";
const ROOT=new URL("../",import.meta.url), ITEMS=new URL("data/jnet21_items.json",ROOT), OUT=new URL("data/jnet21_extracted.json",ROOT), USAGE=new URL("data/summary_usage.jsonl",ROOT);
const read=async(url,fallback)=>{try{return JSON.parse(await readFile(url,"utf8"));}catch{return fallback;}};
const items=await read(ITEMS,[]), cache=await read(OUT,{}), key=process.env.ANTHROPIC_API_KEY;
if(!key){console.log("extract_jnet21: ANTHROPIC_API_KEY未設定のためスキップ");process.exit(0);}
if(!items.length){console.log("extract_jnet21: 抽出対象なし");process.exit(0);}
const {default:Anthropic}=await import("@anthropic-ai/sdk"); const client=new Anthropic({apiKey:key});
let input=0,output=0,failed=0,stopReason=null;
try { const result=await extractPending(items,cache,client,{maxPerRun:Number.parseInt(process.env.JNET21_MAX_PER_RUN??"40",10)||40,onUsage:u=>{input+=u.input_tokens??0;output+=u.output_tokens??0;}});Object.assign(cache,result.cache); }
catch(error){failed++;console.warn(`extract_jnet21: ${error.message}`);const status=error?.status,billing=error?.error?.error?.type==="billing_error"||error?.error?.type==="billing_error"||/credit balance/i.test(error?.message??"");if(status===401||status===402||status===403||billing)stopReason=`api_status_${status??"billing"}`;}
await mkdir(new URL("data/",ROOT),{recursive:true});await writeFile(OUT,`${JSON.stringify(cache,null,2)}\n`);
if(input||output||failed){await appendFile(USAGE,`${JSON.stringify({at:new Date().toISOString(),model:"claude-haiku-5-5",source:"jnet21",summarized:input||output?1:0,failed,stop_reason:stopReason,input_tokens:input,output_tokens:output})}\n`);}
console.log(`extract_jnet21: キャッシュ${Object.keys(cache).length}件、tokens in=${input} out=${output}${stopReason?`、打ち切り(${stopReason})`:""}`);
