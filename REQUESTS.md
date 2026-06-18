# REQUESTS.md — 補助金ウォッチ（subsidy-watch）実装仕様 v1.0

> 実装AI（Codex/Claude Code）への一撃実装仕様。汎用「自動ウォッチサイト製造キット」テンプレを補助金分野に当てはめたもの。
> ai-reg-atlasの姉妹サイト。**ただしLLMは使わない（v1）**＝jGrants APIが構造化データをくれるため要約不要。APIキー不要・認証不要。

## 0. これは何か
日本の中小企業向け補助金・助成金の「いま受付中・締切が近いもの」を、毎日自動で集めて一覧する**締切ダッシュボード**。データはjGrants（デジタル庁の公式オープンAPI）等から取得し、DBもサーバーも使わず GitHub上のJSON＋Actions＋静的サイト(Astro)で完全自動運用。

提供価値：**「どの補助金が・誰向けに・いくらで・いつまでか」が一目でわかり、締切が近い順に並ぶ。**

主ユーザー：中小企業の経営者・経理・補助金担当／申請支援する士業。

## 1. 作らないもの（Non-Goals）
- ❌ LLM要約（v1では使わない。jGrants APIが構造化済み）
- ❌ 課金・会員・ログイン・申請機能（jGrants本体やめる、リンクするだけ）
- ❌ DB・サーバーサイド処理
- ❌ 全補助金の網羅保証（jGrants登録分＋指定RSS分。免責明記）

## 2. データソース（全て検証済み・実URL取得可）
| ソース | 種別 | 取得方法 | 備考 |
|---|---|---|---|
| **jGrants 公開API** | デジタル庁公式 | REST/JSON | **主軸**。締切/金額/対象が構造化。下記§3 |
| J-Net21 支援情報 | 中小機構RSS | `https://j-net21.smrj.go.jp/snavi/support/support.xml` | 自治体網羅。v1は任意（締切/金額はdescriptionからテキスト抽出が要るため後回し可） |
| ミラサポplus | 中企庁RSS | `https://mirasapo-plus.go.jp/feed/` | 国の主要補助金。同上 |
| 厚労省 新着 | 厚労省RSS | `https://www.mhlw.go.jp/stf/news.rdf` | 雇用系助成金。タイトルに「助成金/補助金」含むものだけ |

**v1の必須実装は jGrants API のみ**。RSS3本は `config/sources.yaml` に定義だけ用意し、取り込みは任意（実装余力があればtキーワードフィルタ＋実URLリンクのみ、締切/金額は"本文参照"でよい）。**ソースの追加はconfigに1ブロックで足せる構造にする**（テンプレの拡張性要件）。

## 3. jGrants API 仕様（検証済み）
- 一覧: `GET https://api.jgrants-portal.go.jp/exp/v1/public/subsidies?keyword={kw}&sort=created_date&order=DESC&acceptance=1`
  - `keyword` は**必須**（日本語はURLエンコード）。全件取得できないため、**複数の広いキーワードで引いてidで重複排除**する。キーワード集合は config に置く（既定: 事業, 支援, 補助, 中小, IT, ものづくり, 設備, 雇用, 省エネ, 創業）。
  - `acceptance=1`＝受付中のみ。レスポンス `result[]` の主フィールド：`id, title, subsidy_max_limit, target_area_search, target_number_of_employees, acceptance_start_datetime, acceptance_end_datetime`。
- 詳細: `GET https://api.jgrants-portal.go.jp/exp/v1/public/subsidies/id/{id}` → `result[0].detail`(HTML本文・**参照ホームページの実URL含む**), `subsidy_catch_phrase` 等。詳細は全件は重いので**新規id分だけ**取得（前回id集合と差分）。
- 公開ページ: `https://www.jgrants-portal.go.jp/subsidy/{id}`（各カードのリンク先）。
- 礼儀：User-Agent明示、リクエスト間に小さなdelay、失敗は当該キーワードをスキップして継続。

## 4. データ設計（DBレス）
```
config/sources.yaml      # キーワード集合・RSSソース定義（追加はここに1ブロック）
data/subsidies.json      # 受付中の補助金（正規化レコードの配列・毎日上書き）
data/meta.json           # { last_sweep: ISO8601, status: ok|partial|failed, count }
schema/subsidy.schema.json
```
正規化レコード（1補助金）：
```json
{
  "id": "a0WJ...",
  "title": "【青森県】…補助金",
  "max_limit": 4000000,
  "area": "青森県",
  "employees": "900名以下",
  "start": "2026-04-17",
  "end": "2026-06-19",
  "status": "open",            // new | closing_soon | open （§5）
  "source": "jgrants",
  "jgrants_url": "https://www.jgrants-portal.go.jp/subsidy/a0WJ...",
  "official_url": "https://www.pref.aomori.lg.jp/...",  // 詳細APIのdetailから抽出（無ければnull）
  "catch": "事業のデジタル変革に…",
  "first_seen": "2026-06-18"   // 初検知日（new判定用・前回データから引き継ぐ）
}
```

## 5. ステータス分類（LLM不要・日付計算のみ）
- `closing_soon`：締切(`end`)が今日から **30日以内**
- `new`：`first_seen` が **7日以内**（前回 data/subsidies.json に無かったid）
- `open`：それ以外の受付中
- 締切超過（`end` < 今日）は除外（acceptance=1で基本来ないが念のため）
- **§6教訓**：日付は取得日でなく `acceptance_end_datetime` 等の実日付を使う。`first_seen` は前回データから引き継ぎ、新規idだけ今日の日付（収集日でなく"初出"を保持）。

## 6. サイト（Astro静的・GitHub Pages）
- **トップ＝締切ダッシュボード**：補助金カードを**締切が近い順**に並べる。
  - カード：タイトル／締切（残り日数バッジ）／上限額／対象地域・規模／`new`・`closing_soon`バッジ／「jGrants」「公式ページ」リンク
  - `closing_soon`は赤系、`new`は金系のアクセント。締切超過は出さない。
- **フィルタ（クライアントJS・DBレス）**：地域／従業員規模／金額帯／フリーワード（title部分一致）。
- ヘッダーに最終巡回時刻・件数。フッターに免責（「本サイトはjGrants等の公開情報の自動集約であり、申請可否・最新性を保証しません。必ず公式ページで確認を」）＋「データ出典：jGrants(デジタル庁)」。
- スマホ最適化（カード1列）。
- デザインは派手にせず**実務的・見やすさ最優先**（締切ダッシュボードらしく）。AI感の回避：均一カードの繰り返しを避け、締切間近は明確に強調。

## 7. パイプライン（GitHub Actions 日次）
```
1. collect: config のキーワードでjGrants一覧を引く→idで重複排除→受付中レコード化
2. enrich:  新規idのみ詳細APIでofficial_url等を補完（前回との差分）
3. classify: 日付からstatus付与、first_seen引き継ぎ
4. validate: schemaでJSON検証（失敗ならcommitしない）
5. commit:  data/ を "chore(data): sweep YYYY-MM-DD" でcommit
6. build & deploy: Astroビルド→ actions/deploy-pages（**同一ワークフロー内で完結**）
```
- cron 日次（例 `0 21 * * *`＝JST朝6時）＋ workflow_dispatch。
- `concurrency` グループ設定。新着ゼロでも meta.json 更新（停止防止）。
- **APIキー・シークレットは一切不要**（jGrantsは公開）。

## 8. リポ構成
```
subsidy-watch/
├ .github/workflows/ pipeline.yml（日次）, ci.yml（PR:schema+build）
├ config/sources.yaml
├ data/ subsidies.json, meta.json
├ schema/subsidy.schema.json
├ scripts/ collect.mjs, classify.mjs, validate.mjs, lib/jgrants.mjs
├ src/ (Astro: layout, index.astro=ダッシュボード, components: Card, Filters, Footer), about.astro
├ public/ robots.txt, favicon
├ astro.config.mjs, package.json, README.md
```

## 9. §6 実戦の教訓（テンプレv0.2より・必ず守る）
- 出典は実URLのみ（jGrants公開ページ＋official_url）。アグリゲーター不使用。
- 構造化APIなのでLLM要約しない＝幻覚リスク無し。RSSを将来足す時のみ本文パースを慎重に。
- 日付は実日付（締切）で扱い、収集日でソートしない。first_seenで"新着"を正しく出す。
- 重複はidで排除（複数キーワードで重複取得するため必須）。
- API失敗は当該キーワードskip＋継続。「正常終了≠正常監視」：取得ゼロや失敗は meta.status に反映。
- ソース追加は config 1ブロック（スキーマ検証つき）。

## 10. 受け入れ基準
- [ ] jGrantsから受付中補助金が取得でき、締切が近い順に並ぶ
- [ ] new/closing_soonバッジ・地域/規模/金額/フリーワードのフィルタが動く
- [ ] 各カードがjGrants公開ページ＆official_urlに飛べる
- [ ] schema検証・Astroビルドが通る
- [ ] APIキー無しで `npm run sweep`（collect→classify→validate）と `npm run build` が動く
- [ ] スマホで1列・締切間近が赤で目立つ
- [ ] 免責・出典・最終巡回時刻が表示される
