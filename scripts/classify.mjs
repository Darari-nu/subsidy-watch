import { readFile, writeFile } from "node:fs/promises";

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

const classified = collected
  .filter((record) => utcDay(record.end) >= todayMs)
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
  `classify: ${classified.length}件（期限切れ${collected.length - classified.length}件を除外）`
);
