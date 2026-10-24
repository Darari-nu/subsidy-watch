import subsidiesRaw from "../../data/subsidies.json";
import summariesRaw from "../../data/summaries.json";
import { PREFECTURES } from "../../scripts/lib/areas.mjs";

export interface Subsidy {
  id: string;
  title: string;
  max_limit: number | null;
  area: string;
  areas: string[];
  area_flags?: string[];
  employees: string;
  start: string | null;
  end: string;
  status: "new" | "closing_soon" | "open";
  source: "jgrants";
  jgrants_url: string;
  official_url: string | null;
  catch: string;
  first_seen: string;
}

export interface Summary {
  who: string;
  what: string;
  amount: string;
  note: string;
}

export { PREFECTURES };

const DAY_MS = 86_400_000;
const summaries = summariesRaw as Record<string, Summary>;

export const todayInJapan = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

export const getActiveSubsidies = (): Subsidy[] => {
  const today = todayInJapan();
  return (subsidiesRaw as Subsidy[])
    .filter((item) => item.end >= today)
    .sort((a, b) => a.end.localeCompare(b.end, "ja"));
};

export const getSummary = (id: string): Summary | null => summaries[id] ?? null;

export const daysBetween = (from: string, to: string) =>
  Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", // ビルドは UTC のランナーで走る。指定しないと1日前の日付になる
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${date}T00:00:00+09:00`));

export const formatAmount = (amount: number | null) =>
  !amount
    ? "本文参照"
    : amount >= 100_000_000
      ? `${(amount / 100_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}億円`
      : `${(amount / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}万円`;

/** 地域チップ: 全国は1つ、都道府県は最大 limit 個 + 「+N」。 */
export const areaChips = (areas: string[], limit = 3) => {
  if (areas.length === 1 && areas[0] === "全国") {
    return { chips: ["全国"], more: 0, national: true, all: areas };
  }
  return {
    chips: areas.slice(0, limit),
    more: Math.max(0, areas.length - limit),
    national: false,
    all: areas
  };
};

/** 検索用に全テキストをまとめる（Pagefind が使えない場合のフォールバック兼用）。 */
export const searchText = (subsidy: Subsidy, summary: Summary | null) =>
  [
    subsidy.title,
    subsidy.areas.join(" "),
    subsidy.area,
    subsidy.employees,
    subsidy.catch,
    summary?.who,
    summary?.what,
    summary?.amount,
    summary?.note
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC") // 全角英数（ＡＩ）と半角（AI）を同じに扱う
    .toLocaleLowerCase("ja");
