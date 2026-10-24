import { createHash } from "node:crypto";

export const SUMMARY_KEYS = ["who", "what", "amount", "note"];
const MAX_FIELD_LENGTH = 120;
export const MAX_SOURCE_CHARS = 8000;

const ENTITIES = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " "
};

/** jGrants の detail（HTML）をプレーンテキストにする。 */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (match) => ENTITIES[match])
    .replace(/[ \t　]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

/** 要約の元になるテキスト（タイトル＋詳細APIの主要フィールド）。 */
export function buildSourceText(record, detail) {
  const lines = [`制度名: ${record.title}`];
  const add = (label, value) => {
    const text = htmlToText(Array.isArray(value) ? value.join("、") : value);
    if (text) lines.push(`${label}: ${text}`);
  };
  add("キャッチフレーズ", detail?.subsidy_catch_phrase);
  add("目的", detail?.use_purpose);
  add("対象業種", detail?.industry);
  add("対象従業員規模", detail?.target_number_of_employees);
  add("補助率", detail?.subsidy_rate);
  if (typeof detail?.subsidy_max_limit === "number") {
    add("補助上限額(円)", String(detail.subsidy_max_limit));
  }
  add("実施機関", detail?.institution_name);
  add("詳細", detail?.detail);
  return lines.join("\n").slice(0, MAX_SOURCE_CHARS);
}

export const hashSource = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

/** モデル出力から {who,what,amount,note} を取り出す。不正なら null。 */
export function parseSummary(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const summary = {};
  for (const key of SUMMARY_KEYS) {
    const value = typeof parsed?.[key] === "string" ? parsed[key].trim() : "";
    summary[key] = (value || "不明").slice(0, MAX_FIELD_LENGTH);
  }
  return summary;
}

export const SYSTEM_PROMPT = `あなたは補助金の公開情報を要約するアシスタントです。
与えられた制度情報だけを根拠に、次のJSONだけを出力してください（前置き・説明・コードフェンスは不要）。
{"who": "対象者", "what": "何に使えるか", "amount": "金額の要点", "note": "注意点"}
ルール:
- 各項目は日本語で1文・60字以内。
- 本文に書いてあることだけを書く。推測・補足・一般論は書かない。
- 本文から分からない項目は「不明」とだけ書く。
- 金額は補助上限・補助率など本文にある数字のみ。`;
