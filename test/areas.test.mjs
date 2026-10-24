import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PREFECTURES,
  normalizeAreas,
  parseAreaField,
  passesScreening,
  titlePrefixPrefecture
} from "../scripts/lib/areas.mjs";

// 実データ（data/subsidies.json の raw area は正規化後も保持される）
const data = JSON.parse(
  await readFile(new URL("./fixtures/areas.json", import.meta.url), "utf8")
);
const count = (record) => record.area.split(" / ").length;

test("全国はそのまま全国", () => {
  const record = data.find((item) => item.area === "全国");
  assert.deepEqual(normalizeAreas(record).areas, ["全国"]);
});

test("単一都道府県はそのまま", () => {
  const result = normalizeAreas({ area: "長野県", title: "長野県の補助金" });
  assert.deepEqual(result.areas, ["長野県"]);
  assert.deepEqual(result.flags, []);
});

test("実データ: 【鹿児島】は鹿児島県と一致、フラグなし", () => {
  const record = data.find((item) => item.id === "a0WJ200000CDe6bMAD");
  const result = normalizeAreas(record);
  assert.deepEqual(result.areas, ["鹿児島県"]);
  assert.deepEqual(result.flags, []);
});

test("タイトル接頭辞が area と食い違えば接頭辞を優先する", () => {
  const result = normalizeAreas({
    area: "全国",
    title: "【鹿児島】令和８年度中小企業最低賃金引上げ支援対策費補助金"
  });
  assert.deepEqual(result.areas, ["鹿児島県"]);
  assert.ok(result.flags.includes("title_prefix_override"));
});

test("接頭辞の略称・市区町村付きも都道府県に解決する", () => {
  assert.equal(titlePrefixPrefecture("【京都】補助金"), "京都府");
  assert.equal(titlePrefixPrefecture("【東京】補助金"), "東京都");
  assert.equal(titlePrefixPrefecture("【長野県茅野市】補助金"), "長野県");
  assert.equal(titlePrefixPrefecture("【三重県　鈴鹿市】補助金"), "三重県");
  assert.equal(titlePrefixPrefecture("[北海道]補助金"), "北海道");
});

test("県名でない接頭辞は無視する（年度・省庁・市名・公募回）", () => {
  for (const label of ["令和８年度", "経済産業省", "久留米市", "３次公募", "事前着手"]) {
    assert.equal(titlePrefixPrefecture(`【${label}】補助金`), null, label);
  }
});

test("実データ: 47県リストは全国に集約", () => {
  const record = data.find((item) => count(item) === 47);
  assert.ok(record, "47件リストの実データがある");
  const result = normalizeAreas(record);
  assert.deepEqual(result.areas, ["全国"]);
  assert.ok(result.flags.includes("expanded_to_national"));
});

test("実データ: 全国+都道府県48件も全国", () => {
  const record = data.find((item) => count(item) >= 48);
  assert.ok(record);
  assert.deepEqual(normalizeAreas(record).areas, ["全国"]);
});

test("実データ: 8県・15県の限定リストは県の配列として保持（JIS順）", () => {
  const eight = data.find((item) => count(item) === 8 && !item.area.includes("全国"));
  const result = normalizeAreas(eight);
  assert.equal(result.areas.length, 8);
  const order = result.areas.map((name) => PREFECTURES.indexOf(name));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));

  const fifteen = data.find((item) => count(item) === 15);
  assert.equal(normalizeAreas(fifteen).areas.length, 15);
});

test("地方名は都道府県に展開する", () => {
  assert.equal(parseAreaField("九州・沖縄地方").prefectures.length, 8);
  assert.ok(parseAreaField("九州・沖縄地方").prefectures.includes("沖縄県"));
  assert.equal(parseAreaField("四国地方").prefectures.length, 4);
});

test("都道府県でない値は捨ててフラグを立てる", () => {
  const result = normalizeAreas({ area: "長野県 / 火星 / 海外", title: "補助金" });
  assert.deepEqual(result.areas, ["長野県"]);
  assert.ok(result.flags.includes("invalid_area:火星"));
  assert.ok(result.flags.includes("invalid_area:海外"));
});

test("有効値が無ければ全国にしてフラグ", () => {
  const result = normalizeAreas({ area: "火星", title: "補助金" });
  assert.deepEqual(result.areas, ["全国"]);
  assert.ok(result.flags.includes("no_valid_area"));
});

test("実データ: 全レコードが正規化後に有効な値だけを持つ", () => {
  const valid = new Set([...PREFECTURES, "全国"]);
  for (const record of data) {
    const { areas } = normalizeAreas(record);
    assert.ok(areas.length > 0, record.id);
    assert.ok(areas.every((name) => valid.has(name)), `${record.id}: ${areas}`);
  }
});

test("スクリーニング: 既定は全件残す", () => {
  assert.equal(passesScreening(["東京都"], {}), true);
  assert.equal(passesScreening(["全国"], { include_areas: [], exclude_areas: [] }), true);
});

test("スクリーニング: include は全国+長野県のように絞れる", () => {
  const screening = { include_areas: ["全国", "長野県"] };
  assert.equal(passesScreening(["全国"], screening), true);
  assert.equal(passesScreening(["長野県"], screening), true);
  assert.equal(passesScreening(["東京都", "長野県"], screening), true);
  assert.equal(passesScreening(["東京都"], screening), false);
});

test("スクリーニング: exclude は全ての地域が除外対象のときだけ落とす", () => {
  const screening = { exclude_areas: ["東京都"] };
  assert.equal(passesScreening(["東京都"], screening), false);
  assert.equal(passesScreening(["東京都", "神奈川県"], screening), true);
});
