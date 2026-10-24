import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extractPending, extractionUsage } from "./lib/jnet21.mjs";
const ROOT=new URL("../",import.meta.url), ITEMS=new URL("data/jnet21_items.json",ROOT), OUT=new URL("data/jnet21_extracted.json",ROOT), USAGE=new URL("data/summary_usage.jsonl",ROOT);
const read=async(url,fallback)=>{try{return JSON.parse(await readFile(url,"utf8"));}catch{return fallback;}};
const items=await read(ITEMS,[]), cache=await read(OUT,{}), key=process.env.ANTHROPIC_API_KEY;
if(!key){console.log("extract_jnet21: ANTHROPIC_API_KEY未設定のためスキップ");process.exit(0);}
if(!items.length){console.log("extract_jnet21: 抽出対象なし");process.exit(0);}
const {default:Anthropic}=await import("@anthropic-ai/sdk"); const client=new Anthropic({apiKey:key,maxRetries:0});
const result = await extractPending(items,cache,client,{
  maxPerRun:Number.parseInt(process.env.JNET21_MAX_PER_RUN??"40",10)||40
});
await mkdir(new URL("data/",ROOT),{recursive:true});
await writeFile(OUT,`${JSON.stringify(cache,null,2)}\n`);
if(result.attempted){
  await appendFile(USAGE,`${JSON.stringify(extractionUsage(result))}\n`);
}
console.log(`extract_jnet21: 試行${result.attempted}件、成功${result.succeeded}件、解析失敗${result.parse_failed}件、API失敗${result.api_failed}件、tokens in=${result.input_tokens} out=${result.output_tokens}${result.stop_reason?`、打ち切り(${result.stop_reason})`:""}`);
