const day = (date) => Date.parse(`${date}T00:00:00Z`);
export const todayInJapan = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

export const validPreviousJgrants = (records, today) =>
  records.filter((record) => record.source === "jgrants" && record.end >= today);

// 蓄積から作ったJ-Net21を正とし、持ち越しの古いJ-Net21は混ぜない。
export function mergeCollected(collected, jnetRecords) {
  const records = new Map();
  for (const record of [...jnetRecords, ...collected.filter((x) => x.source === "jgrants")]) {
    if (!records.has(record.id)) records.set(record.id, record);
  }
  return [...records.values()];
}

export function classifyStatus(record, today) {
  if (record.start && record.start > today) return "upcoming";
  if (record.end && (day(record.end) - day(today)) / 86_400_000 <= 30) return "closing_soon";
  const age = (day(today) - day(record.first_seen)) / 86_400_000;
  return age >= 0 && age <= 7 ? "new" : "open";
}

export const upcomingLabel = (start) => `受付前（${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}〜）`;
export const subsidyCounts = (records) => ({
  open: records.filter((x) => x.status !== "upcoming").length,
  closing: records.filter((x) => x.end !== null && x.status === "closing_soon").length,
  upcoming: records.filter((x) => x.status === "upcoming").length
});
