// AI要約（Claude Haiku）。キャッシュ済みは再要約しない。
// ANTHROPIC_API_KEY が無い／APIが402・認証エラー等を返したら、ログを出して正常終了（exit 0）する。
// サイトは summaries.json に無い制度の要約ブロックを出さないだけで、ビルドは常に通る。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { delay, fetchSubsidyDetail } from "./lib/jgrants.mjs";
import {
  SYSTEM_PROMPT,
  buildSourceText,
  hashSource,
  parseSummary
} from "./lib/summary.mjs";

const MODEL = process.env.SUMMARY_MODEL || "claude-haiku-5-5";
const MAX_PER_RUN = Number.parseInt(process.env.SUMMARY_MAX_PER_RUN ?? "60", 10) || 60;
const DETAIL_DELAY_MS = 600;
const MAX_CONSECUTIVE_FAILURES = 5;

const ROOT = new URL("../", import.meta.url);
const DATA_PATH = new URL("data/subsidies.json", ROOT);
const SUMMARIES_PATH = new URL("data/summaries.json", ROOT);
const USAGE_PATH = new URL("data/summary_usage.jsonl", ROOT);
const CONFIG_PATH = new URL("config/sources.yaml", ROOT);

const readJson = async (url, fallback) => {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
};

const subsidies = await readJson(DATA_PATH, []);
const cache = await readJson(SUMMARIES_PATH, {});

// 一覧から消えた制度のキャッシュは落とす（ファイルを肥大させない）
const liveIds = new Set(subsidies.map((record) => record.id));
for (const id of Object.keys(cache)) {
  if (!liveIds.has(id)) delete cache[id];
}
const save = () =>
  writeFile(SUMMARIES_PATH, `${JSON.stringify(cache, null, 2)}\n`);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  await save();
  console.log("summarize: ANTHROPIC_API_KEY が未設定のため要約をスキップします");
  process.exit(0);
}

const pending = subsidies.filter((record) => !cache[record.id]);
console.log(
  `summarize: キャッシュ済み${subsidies.length - pending.length}件 / 未要約${pending.length}件（今回の上限${MAX_PER_RUN}件）`
);
if (pending.length === 0) {
  await save();
  process.exit(0);
}

const config = parse(await readFile(CONFIG_PATH, "utf8"));
const apiBase = config.sources.find((source) => source.id === "jgrants")?.base_url;

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey });

const usage = { input_tokens: 0, output_tokens: 0 };
let summarized = 0;
let failed = 0;
let consecutiveFailures = 0;
let stopReason = null;

// 先に締切が近いものから要約する（人が先に見るのはそちら）
for (const record of pending.slice(0, MAX_PER_RUN)) {
  try {
    const detail = await fetchSubsidyDetail(record.id, {
      apiBase,
      delayMs: DETAIL_DELAY_MS
    });
    const source = buildSourceText(record, detail);
    const response = await client.messages.create({
      model: MODEL,
      // Haiku 5.5 は既定で考えてから答える（考えを切ると本文に無いことを書き足した・2026-10-24 実測）。考える分も max_tokens に含まれるので余裕を持たせる
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: source }]
    });
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const summary = parseSummary(text);
    if (!summary) throw new Error(`要約のJSONを解釈できませんでした（stop_reason=${response.stop_reason}）`);

    cache[record.id] = {
      hash: hashSource(source),
      ...summary,
      model: MODEL,
      at: new Date().toISOString()
    };
    summarized += 1;
    consecutiveFailures = 0;
    console.log(`summarize: ${record.id} ${record.title.slice(0, 24)}`);
  } catch (error) {
    failed += 1;
    consecutiveFailures += 1;
    const status = error?.status;
    console.warn(`summarize: skip ${record.id}: ${status ?? ""} ${error.message}`);
    // 課金・認証・権限の問題は何度やっても同じなので、その回の要約を打ち切る
    // 残高不足は 402 billing_error のほか、400 "credit balance is too low" で返ることもある
    const billing = error?.error?.error?.type === "billing_error" || error?.error?.type === "billing_error" || /credit balance/i.test(error?.message ?? "");
    if (status === 401 || status === 402 || status === 403 || billing) {
      stopReason = `api_status_${status}`;
      break;
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stopReason = "too_many_failures";
      break;
    }
    await delay(1000);
  }
}

await save();

if (summarized + failed > 0) {
  await mkdir(new URL("data/", ROOT), { recursive: true });
  await appendFile(
    USAGE_PATH,
    `${JSON.stringify({
      at: new Date().toISOString(),
      model: MODEL,
      summarized,
      failed,
      stop_reason: stopReason,
      ...usage
    })}\n`
  );
}

console.log(
  `summarize: ${summarized}件を要約、${failed}件失敗、tokens in=${usage.input_tokens} out=${usage.output_tokens}${stopReason ? `、打ち切り(${stopReason})` : ""}`
);
// 失敗してもサイトのビルドは止めない
process.exit(0);
