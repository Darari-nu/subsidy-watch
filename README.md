# 補助金ウォッチ

中小企業向けの受付中補助金を、締切が近い順に表示する静的ダッシュボードです。jGrants（デジタル庁）の公開APIを毎日巡回し、GitHub上のJSONを更新してAstroサイトをGitHub Pagesへ配布します。

APIキー、データベース、サーバーサイド処理は不要です。

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
| `npm run classify` | 期限切れを除外し、締切・初回検知日からステータスを付け、締切順に並べる |
| `npm run validate` | 補助金JSONとソース設定をJSON Schemaで検証する |
| `npm run sweep` | `collect` → `classify` → `validate` を順番に実行する |
| `npm run dev` | Astro開発サーバーを起動する |
| `npm run build` | 型・構文検査後に静的サイトを生成する |
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
- `data/meta.json`: 最終巡回時刻、取得状態、件数、取得エラー
- `schema/subsidy.schema.json`: 補助金レコードのJSON Schema
- `schema/sources.schema.json`: ソース設定のJSON Schema

収集時に一部キーワードや詳細APIが失敗しても、成功分は処理を継続し、`data/meta.json` の `status` を `partial` にします。全キーワードが失敗した場合は前回データを保持したまま `failed` を記録し、古い公開データを誤って空配列で上書きしません。

## 自動更新

`.github/workflows/pipeline.yml` は毎日 UTC 21:00（JST 6:00）と手動実行で、収集、分類、検証、データコミット、Astroビルド、GitHub Pages配布を同一ワークフロー内で行います。シークレットは不要です。

Pull Requestでは `.github/workflows/ci.yml` がスキーマ検証とAstroビルドを実行します。

## 免責

本サイトは公開情報の自動集約であり、申請可否・情報の完全性・最新性を保証しません。必ずjGrantsおよび各制度の公式ページで最新情報を確認してください。
