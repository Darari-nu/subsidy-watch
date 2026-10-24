# 補助金ウォッチ

中小企業向けの受付中補助金を、締切が近い順に表示する静的ダッシュボードです。jGrants（デジタル庁）の公開APIを毎日巡回し、GitHub上のJSONを更新してAstroサイトをGitHub Pagesへ配布します。

データベース、サーバーサイド処理は不要です。AI要約を使う場合のみ Anthropic APIキーが必要です（任意）。

## 公開URL

- **本番**: https://darari-nu.com/subsidy-watch/
- 実体: https://darari-nu.github.io/subsidy-watch/

配信は GitHub Pages（`.github/workflows/pipeline.yml` が日次でビルド＆デプロイ）。
`darari-nu.com/subsidy-watch/` は別リポジトリ `Darari-nu/ai-kaizen-hub` の
Pages Function（`functions/subsidy-watch/[[path]].js`）が GitHub Pages を
透過中継したもの。**このリポジトリに push すれば両方に反映される。**

darari-nu.com 側のパスが `/subsidy` ではなく `/subsidy-watch` なのは、Astro が
`base='/subsidy-watch'` でビルドしていてアセットが絶対パスで書かれているため。
**パスを縮めるとアセットが全て404になる**ので、base を変えない限りここは変えないこと。

なお darari-nu.com 配下の他4本（atlas / uchinoko / bucho / sengoku）は中継先が
Cloudflare Pages で、GitHub Pages を中継しているのはこのサイトだけ。

## ローカルセットアップ

必要環境は Node.js 20.18 以上です。

```bash
npm install
npm run sweep
npm run dev
```

本番相当の静的ビルドは次で確認できます。

```bash
npm run build
npm run preview
```

## GitHub Pagesで公開する

以下は新規リポジトリを作る場合の例です。リポジトリ名は `subsidy-watch` を想定しています。

```bash
gh repo create subsidy-watch --public --source=. --remote=origin --push
gh api --method POST repos/{owner}/subsidy-watch/pages \
  -f build_type=workflow
```

GitHubのリポジトリ画面から設定する場合は、`Settings` → `Pages` → `Build and deployment` のSourceを `GitHub Actions` にします。その後 `.github/workflows/pipeline.yml` を手動実行するか、日次実行を待ちます。

プロジェクトページ用のベースパスは、Actions内でリポジトリ名から自動設定されます。独自ドメイン等で変更する場合は、ビルド時に `SITE_URL` と `BASE_PATH` を指定してください。

## npm scripts

| コマンド | 役割 |
|---|---|
| `npm run collect` | 設定済みキーワードでjGrants一覧を取得し、ID重複排除と新規詳細補完を行う |
| `npm run classify` | 対象地域の正規化（`areas`）・地域スクリーニング・期限切れ除外・ステータス付与・締切順ソート |
| `npm run summarize` | Claude Haiku で未要約の制度をAI要約する（`ANTHROPIC_API_KEY` が無ければスキップ） |
| `npm run validate` | 補助金JSON・要約JSON・ソース設定をJSON Schemaで検証する |
| `npm run sweep` | `collect` → `classify` → `summarize` → `validate` を順番に実行する |
| `npm test` | 地域正規化・要約ヘルパーの単体テスト（`node:test`） |
| `npm run dev` | Astro開発サーバーを起動する（Pagefind検索は無く、画面内の部分一致で代用） |
| `npm run build` | `astro build` のあと `pagefind --site dist` で全文検索インデックス（`dist/pagefind/`）を生成する |
| `npm run preview` | ビルド済みサイトをローカル表示する |

## データソースを追加する

ソース定義は [`config/sources.yaml`](config/sources.yaml) に1ブロック追加します。RSSは将来取り込み用の定義で、現在の収集処理は `jgrants` タイプのみを対象にしています。

```yaml
  - id: example-rss
    type: rss
    enabled: false
    name: 追加する公式RSS
    url: https://example.go.jp/feed.xml
    include_keywords:
      - 補助金
      - 助成金
```

追加後は必ず次を実行し、設定スキーマに適合することを確認してください。

```bash
npm run validate
```

## データ構成

- `data/subsidies.json`: 受付中補助金の正規化レコード
- `data/summaries.json`: AI要約キャッシュ（補助金IDをキーに `who/what/amount/note`＋元テキストのハッシュ。1制度1回だけ要約）
- `data/summary_usage.jsonl`: 要約の実行ごとのトークン使用量
- `data/meta.json`: 最終巡回時刻、取得状態、件数、取得エラー
- `schema/subsidy.schema.json`: 補助金レコードのJSON Schema
- `schema/sources.schema.json`: ソース設定のJSON Schema
- `schema/summaries.schema.json`: 要約キャッシュのJSON Schema
- `scripts/lib/areas.mjs`: 対象地域の正規化・スクリーニング（`test/areas.test.mjs` に実データ由来のテスト）
- `src/pages/s/[id].astro`: 制度ごとの詳細ページ（Pagefindの検索対象。一覧ページは対象外）
- `public/brand/README.md`: ロゴ・OGP・アイコン画像のパス/サイズ一覧（現状はプレースホルダ）

### 対象地域の正規化とスクリーニング

jGrantsの `target_area_search` は「全国」「単一県」「 / 区切りの多数県」「地方名」が混在し、タイトルの【鹿児島】等と食い違うことがあります。`classify` で次の `areas`（都道府県名のJIS順配列、または `["全国"]`）に揃えます（元の文字列は `area` に残ります）。

- 40県以上（`national_threshold`）または「全国」を含む → `["全国"]`
- タイトル先頭の【…】が単一の都道府県（略称・市区町村付き含む）なら、`area` と食い違ってもそちらを優先（`area_flags` に `title_prefix_override`）
- 地方名（「九州・沖縄地方」等）は都道府県に展開、都道府県でない値は捨てて `area_flags` に `invalid_area:値`

`config/sources.yaml` の `screening` で取り込み対象を絞れます（既定は空＝全件）。例: `include_areas: ["全国", "長野県"]`。

画面の地域フィルタは「全国のみ」＋47都道府県（北海道→沖縄県）。県を選ぶと、その県を含む制度に加えて全国対象の制度も表示します（「全国対象も含める」で切替。選択は localStorage に記憶）。

### 検索（Pagefind）

`npm run build` が `dist/pagefind/` を生成し、一覧ページが `{base}pagefind/pagefind.js` を読み込みます。インデックス対象は制度ごとの詳細ページ（タイトル・地域・キャッチ・AI要約）で、日本語の部分一致（例「設備投」→「設備投資」）が効きます。地域・規模・金額の絞り込みは検索結果と組み合わせて動きます。

### AI要約

`ANTHROPIC_API_KEY`（GitHub Secrets）がある場合のみ、`claude-haiku-5-5` で未要約の制度を1回の実行あたり `SUMMARY_MAX_PER_RUN`（既定60）件まで要約します。キー未設定・APIエラー・402は警告ログだけで正常終了し、要約ブロックが出ないだけでサイトは通常どおりビルドされます。

収集時に一部キーワードや詳細APIが失敗しても、成功分は処理を継続し、`data/meta.json` の `status` を `partial` にします。全キーワードが失敗した場合は前回データを保持したまま `failed` を記録し、古い公開データを誤って空配列で上書きしません。

## 自動更新

`.github/workflows/pipeline.yml` は毎日 UTC 21:00（JST 6:00）と手動実行で、収集、分類、検証、データコミット、Astroビルド、GitHub Pages配布を同一ワークフロー内で行います。`ANTHROPIC_API_KEY` シークレットを設定するとAI要約が有効になります（未設定でも動作）。

Pull Requestでは `.github/workflows/ci.yml` がスキーマ検証とAstroビルドを実行します。

## 改訂履歴

構成やデプロイ先を変えたら、ここに1行足すこと。

| 日付 | 変更 |
|---|---|
| 2026-06-18 | 初版。GitHub Pages で公開開始 |
| 2026-09-04 | darari-nu.com/subsidy-watch/ での配信を追加（ai-kaizen-hub の Pages Function で中継）。公開URLをREADMEに明記 |
| 2026-10-24 | Pagefindによる全文検索、Claude HaikuによるAI要約（`summarize.mjs`）、対象地域の正規化・スクリーニング（`areas`）、エディトリアル調UI再設計（並び替え・地域フィルタ・OGP・詳細ページ）を追加 |

## 免責

本サイトは公開情報の自動集約であり、申請可否・情報の完全性・最新性を保証しません。必ずjGrantsおよび各制度の公式ページで最新情報を確認してください。
