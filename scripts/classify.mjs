import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { normalizeAreas, passesScreening } from "./lib/areas.mjs";

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

const utcDay = (date) => Date.parse(`${date}T00:00:00Z`);
const today = todayInJapan();
const todayMs = utcDay(today);
const collected = JSON.parse(await readFile(COLLECTED_PATH, "utf8"));

const config = parse(
  await readFile(new URL("config/sources.yaml", ROOT), "utf8")
);
const screening = config.screening ?? {};

// 前回データの持ち越し分（areas 未付与）もここで正規化し、設定変更も反映する
const withAreas = collected.map((record) => {
  const { areas, flags } = normalizeAreas(record, screening);
  const { area_flags: _drop, ...rest } = record;
  return { ...rest, areas, ...(flags.length > 0 ? { area_flags: flags } : {}) };
});

const classified = withAreas
  .filter((record) => utcDay(record.end) >= todayMs)
  .filter((record) => passesScreening(record.areas, screening))
  .map((record) => {
    const daysUntilDeadline = Math.floor((utcDay(record.end) - todayMs) / DAY_MS);
    const daysSinceFirstSeen = Math.floor(
      (todayMs - utcDay(record.first_seen)) / DAY_MS
    );
    const status =
      daysUntilDeadline <= 30
        ? "closing_soon"
        : daysSinceFirstSeen >= 0 && daysSinceFirstSeen <= 7
          ? "new"
          : "open";
    return { ...record, status };
  })
  .sort(
    (a, b) =>
      a.end.localeCompare(b.end, "ja") ||
      a.title.localeCompare(b.title, "ja")
  );

await writeFile(DATA_PATH, `${JSON.stringify(classified, null, 2)}\n`);

const meta = JSON.parse(await readFile(META_PATH, "utf8"));
await writeFile(
  META_PATH,
  `${JSON.stringify({ ...meta, count: classified.length }, null, 2)}\n`
);

console.log(
  `classify: ${classified.length}件（期限切れ・地域スクリーニングで${collected.length - classified.length}件を除外）`
);
