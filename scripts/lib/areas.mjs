// 対象地域の正規化とスクリーニング。
// jGrants の target_area_search は「全国」「単一都道府県」「 / 区切りの長い都道府県リスト」
// 「地方名」が混在し、タイトル先頭の【鹿児島】等と食い違うことがある。
// 正規化後は areas = 都道府県名の配列（JIS順） もしくは ["全国"] に揃える。

export const NATIONAL = "全国";

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

const PREF_INDEX = new Map(PREFECTURES.map((name, index) => [name, index]));

// 「鹿児島」「京都」など接尾辞なしの略称 → 正式名
const SHORT_NAMES = new Map(
  PREFECTURES.map((name) => [
    name === "北海道" ? name : name.slice(0, -1),
    name
  ])
);

export const REGIONS = {
  北海道地方: ["北海道"],
  東北地方: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  "関東・甲信越地方": [
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "山梨県", "長野県"
  ],
  "東海・北陸地方": [
    "富山県", "石川県", "福井県", "岐阜県", "静岡県", "愛知県", "三重県"
  ],
  近畿地方: ["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
  中国地方: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  四国地方: ["徳島県", "香川県", "愛媛県", "高知県"],
  "九州・沖縄地方": [
    "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
    "沖縄県"
  ]
};

export const DEFAULT_SCREENING = {
  include_areas: [],
  exclude_areas: [],
  national_threshold: 40,
  title_prefix_wins: true
};

const sortPrefectures = (names) =>
  [...new Set(names)].sort((a, b) => PREF_INDEX.get(a) - PREF_INDEX.get(b));

/** 生の area 文字列を分解する。 */
export function parseAreaField(raw) {
  const prefectures = [];
  const invalid = [];
  let national = false;
  const tokens = String(raw ?? "")
    .split(/\s*[\/、,，]\s*/u)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === NATIONAL) national = true;
    else if (PREF_INDEX.has(token)) prefectures.push(token);
    else if (REGIONS[token]) prefectures.push(...REGIONS[token]);
    else invalid.push(token);
  }
  return { national, prefectures: sortPrefectures(prefectures), invalid };
}

/**
 * タイトル先頭の【…】/[…] が単一の都道府県を指していればその正式名を返す。
 * 「【鹿児島】」「【長野県茅野市】」「【三重県　鈴鹿市】」は対象。
 * 「【令和８年度】」「【経済産業省】」「【久留米市】」のように県名でないものは null。
 */
export function titlePrefixPrefecture(title) {
  const match = String(title ?? "").match(/^\s*[【\[［]([^】\]］]{1,20})[】\]］]/u);
  if (!match) return null;
  const label = match[1].trim();
  if (PREF_INDEX.has(label)) return label;
  if (SHORT_NAMES.has(label)) return SHORT_NAMES.get(label);
  for (const name of PREFECTURES) {
    if (label.startsWith(name)) return name;
  }
  return null;
}

/**
 * @returns {{ areas: string[], flags: string[] }}
 * flags: title_prefix_override / invalid_area:<値> / no_valid_area / expanded_to_national
 */
export function normalizeAreas({ area, title }, screening = {}) {
  const options = { ...DEFAULT_SCREENING, ...screening };
  const flags = [];
  const { national, prefectures, invalid } = parseAreaField(area);

  for (const value of invalid) flags.push(`invalid_area:${value}`);

  let areas;
  if (national || prefectures.length >= options.national_threshold) {
    areas = [NATIONAL];
    if (prefectures.length >= options.national_threshold) {
      flags.push("expanded_to_national");
    }
  } else if (prefectures.length > 0) {
    areas = prefectures;
  } else {
    areas = [NATIONAL];
    flags.push("no_valid_area");
  }

  const prefix = options.title_prefix_wins ? titlePrefixPrefecture(title) : null;
  if (prefix && !(areas.length === 1 && areas[0] === prefix)) {
    areas = [prefix];
    flags.push("title_prefix_override");
  }

  return { areas, flags: [...new Set(flags)] };
}

/** screening 設定に照らして残すか判定する。既定（空配列）は全件残す。 */
export function passesScreening(areas, screening = {}) {
  const include = screening.include_areas ?? [];
  const exclude = new Set(screening.exclude_areas ?? []);
  if (include.length > 0 && !areas.some((area) => include.includes(area))) {
    return false;
  }
  if (exclude.size > 0 && areas.every((area) => exclude.has(area))) {
    return false;
  }
  return true;
}
