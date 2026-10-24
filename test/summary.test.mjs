import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSourceText,
  hashSource,
  htmlToText,
  parseSummary
} from "../scripts/lib/summary.mjs";

test("htmlToText はタグと実体参照を落とす", () => {
  const text = htmlToText("<p><strong>■目的</strong>&amp;概要</p><p>賃金&nbsp;引上げ</p>");
  assert.equal(text, "■目的 &概要\n賃金 引上げ");
});

test("parseSummary はコードフェンス付きJSONも読み、欠けた項目は不明にする", () => {
  const result = parseSummary('```json\n{"who":"中小企業","what":"設備投資","amount":"上限600万円"}\n```');
  assert.deepEqual(result, {
    who: "中小企業",
    what: "設備投資",
    amount: "上限600万円",
    note: "不明"
  });
});

test("parseSummary は壊れた出力で null", () => {
  assert.equal(parseSummary("要約できません"), null);
  assert.equal(parseSummary("{not json}"), null);
});

test("hashSource は同じ入力で同じ値、違う入力で違う値", () => {
  assert.equal(hashSource("a"), hashSource("a"));
  assert.notEqual(hashSource("a"), hashSource("b"));
});

test("buildSourceText はタイトルと詳細を含み長さを制限する", () => {
  const text = buildSourceText(
    { title: "テスト補助金" },
    { detail: `<p>${"あ".repeat(20000)}</p>`, subsidy_max_limit: 1000000 }
  );
  assert.ok(text.startsWith("制度名: テスト補助金"));
  assert.ok(text.length <= 8000);
});
