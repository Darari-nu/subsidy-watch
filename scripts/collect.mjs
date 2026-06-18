import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  buildPublicUrl,
  fetchSubsidiesByKeyword,
  fetchSubsidyDetail
} from "./lib/jgrants.mjs";

const ROOT = new URL("../", import.meta.url);
const CONFIG_PATH = new URL("config/sources.yaml", ROOT);
const DATA_PATH = new URL("data/subsidies.json", ROOT);
const META_PATH = new URL("data/meta.json", ROOT);
const CACHE_DIR = new URL(".cache/", ROOT);
const COLLECTED_PATH = new URL(".cache/collected.json", ROOT);

const readJson = async (url, fallback) => {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
};

const dateOnly = (value) => {
  if (!value) return null;
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
};

const asText = (value, fallback) => {
  if (Array.isArray(value)) {
    const text = value.filter(Boolean).join("、").trim();
    return text || fallback;
  }
  const text = String(value ?? "").trim();
  return text || fallback;
};

const asAmount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : null;
};

const decodeHtml = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const extractOfficialUrl = (detail) => {
  if (!detail) return null;
  const html = decodeHtml(String(detail));
  const candidates = [
    ...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"'<>]+)["']/gi),
    ...html.matchAll(/(?<!["'=])(https?:\/\/[^\s<>"']+)/gi)
  ].map((match) => match[1].replace(/[),.;]+$/, ""));

  return (
    candidates.find((url) => {
      try {
        const host = new URL(url).hostname;
        return !host.endsWith("jgrants-portal.go.jp");
      } catch {
        return false;
      }
    }) ?? null
  );
};

const todayInJapan = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const config = parse(await readFile(CONFIG_PATH, "utf8"));
const source = config.sources.find(
  (item) => item.id === "jgrants" && item.type === "api" && item.enabled
);

if (!source) {
  throw new Error("有効なjGrantsソースがconfig/sources.yamlにありません");
}

const previous = await readJson(DATA_PATH, []);
const previousById = new Map(previous.map((record) => [record.id, record]));
const resultsById = new Map();
const errors = [];
let successfulKeywords = 0;

for (const keyword of source.keywords) {
  try {
    const payload = await fetchSubsidiesByKeyword(keyword, {
      apiBase: source.base_url
    });
    successfulKeywords += 1;
    for (const item of payload.result) {
      if (item?.id) resultsById.set(String(item.id), item);
    }
    console.log(`collect: "${keyword}" ${payload.result.length}件`);
  } catch (error) {
    const message = `"${keyword}": ${error.message}`;
    errors.push(message);
    console.warn(`collect: skip ${message}`);
  }
}

const today = todayInJapan();
const collected = [];
let detailFailures = 0;

for (const item of resultsById.values()) {
  const id = String(item.id);
  const old = previousById.get(id);
  let officialUrl = old?.official_url ?? null;
  let catchPhrase = old?.catch ?? asText(item.subsidy_catch_phrase, "");

  if (!old) {
    try {
      const detail = await fetchSubsidyDetail(id, {
        apiBase: source.base_url
      });
      officialUrl = extractOfficialUrl(detail?.detail);
      catchPhrase = asText(
        detail?.subsidy_catch_phrase ?? item.subsidy_catch_phrase,
        ""
      );
    } catch (error) {
      detailFailures += 1;
      errors.push(`詳細 ${id}: ${error.message}`);
      console.warn(`collect: detail skip ${id}: ${error.message}`);
    }
  }

  const end = dateOnly(item.acceptance_end_datetime);
  if (!end) {
    errors.push(`${id}: 締切日がないため除外`);
    continue;
  }

  collected.push({
    id,
    title: asText(item.title, "名称未設定"),
    max_limit: asAmount(item.subsidy_max_limit),
    area: asText(item.target_area_search, "全国"),
    employees: asText(item.target_number_of_employees, "規模指定なし"),
    start: dateOnly(item.acceptance_start_datetime),
    end,
    status: old?.status ?? "open",
    source: "jgrants",
    jgrants_url: buildPublicUrl(id, source.public_base_url),
    official_url: officialUrl,
    catch: catchPhrase,
    first_seen: old?.first_seen ?? today
  });
}

if (successfulKeywords === 0) {
  collected.push(...previous);
  errors.push("全キーワードの取得に失敗したため、前回データを保持しました");
}

await mkdir(CACHE_DIR, { recursive: true });
await writeFile(COLLECTED_PATH, `${JSON.stringify(collected, null, 2)}\n`);

const status =
  successfulKeywords === 0
    ? "failed"
    : errors.length > 0 || detailFailures > 0
      ? "partial"
      : "ok";

await writeFile(
  META_PATH,
  `${JSON.stringify(
    {
      last_sweep: new Date().toISOString(),
      status,
      count: collected.length,
      errors
    },
    null,
    2
  )}\n`
);

console.log(
  `collect: ${collected.length}件を収集（重複排除後）、status=${status}`
);
