import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { normalizeAreas, passesScreening } from "./lib/areas.mjs";
import { activeJnetRecords } from "./lib/jnet21.mjs";

const ROOT = new URL("../", import.meta.url);
const COLLECTED_PATH = new URL(".cache/collected.json", ROOT);
const DATA_PATH = new URL("data/subsidies.json", ROOT);
const META_PATH = new URL("data/meta.json", ROOT);
const DAY_MS = 86_400_000;

const todayInJapan = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
const readJson = async (url, fallback) => {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; }
};

const utcDay = (date) => Date.parse(`${date}T00:00:00Z`);
const today = todayInJapan();
const todayMs = utcDay(today);
const collected = JSON.parse(await readFile(COLLECTED_PATH, "utf8"));
const config = parse(await readFile(new URL("config/sources.yaml", ROOT), "utf8"));
const screening = config.screening ?? {};
const jnetItems = await readJson(new URL("data/jnet21_items.json", ROOT), []);
const extracted = await readJson(new URL("data/jnet21_extracted.json", ROOT), {});
const summariesPath = new URL("data/summaries.json", ROOT);
const summaries = await readJson(summariesPath, {});
const todayJapan = todayInJapan();
const jnetRecords = activeJnetRecords(jnetItems, extracted, todayJapan, screening);

// 前回データの持ち越し分（areas 未付与）もここで正規化し、設定変更も反映する
const withAreas = [...collected, ...jnetRecords].map((record) => {
  const { areas, flags } = normalizeAreas(record, screening);
  const { area_flags: _drop, ...rest } = record;
  return { ...rest, areas, ...(flags.length > 0 ? { area_flags: flags } : {}) };
});

const classified = withAreas
  .filter((record) => record.end === null
    ? record.source === "jnet21" && (todayMs - utcDay(record.first_seen)) / DAY_MS <= 45
    : utcDay(record.end) >= todayMs)
  .filter((record) => passesScreening(record.areas, screening))
  .map((record) => {
    const daysUntilDeadline = record.end ? Math.floor((utcDay(record.end) - todayMs) / DAY_MS) : null;
    const daysSinceFirstSeen = Math.floor(
      (todayMs - utcDay(record.first_seen)) / DAY_MS
    );
    const status =
      daysUntilDeadline !== null && daysUntilDeadline <= 30
        ? "closing_soon"
        : daysSinceFirstSeen >= 0 && daysSinceFirstSeen <= 7
          ? "new"
          : "open";
    return { ...record, status };
  })
  .sort(
    (a, b) =>
      (a.end ?? "9999-12-31").localeCompare(b.end ?? "9999-12-31", "ja") ||
      a.title.localeCompare(b.title, "ja")
  );

for (const [id, value] of Object.entries(extracted)) {
  if (value.who) summaries[id] = { hash: value.hash, who: value.who, what: value.what, amount: value.amount, note: value.note, model: value.model ?? "claude-haiku-5-5", at: value.at ?? new Date().toISOString() };
}
await writeFile(summariesPath, `${JSON.stringify(summaries, null, 2)}\n`);

await writeFile(DATA_PATH, `${JSON.stringify(classified, null, 2)}\n`);

const meta = JSON.parse(await readFile(META_PATH, "utf8"));
await writeFile(
  META_PATH,
  `${JSON.stringify({ ...meta, count: classified.length }, null, 2)}\n`
);

console.log(
  `classify: ${classified.length}件（期限切れ・地域スクリーニングで${collected.length - classified.length}件を除外）`
);
