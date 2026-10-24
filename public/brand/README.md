# ブランド画像の差し替え先

いま入っているのはビルドを通すための**プレースホルダ**です。同じパス・同じファイル名で上書きしてください（コード側の変更は不要）。

| パス | サイズ | 用途 |
|---|---|---|
| `public/brand/logo.png` | 720×192 px（透過PNG。表示は約 180×48＝2x。デザイン上の基準は 360×96） | ヘッダー左上の横長ワードマーク＋マーク |
| `public/brand/mark.png` | 512×512 px（正方形） | ファビコン／apple-touch-icon |
| `public/og.png` | 1200×630 px | OGP／Twitterカード（`https://darari-nu.com/subsidy-watch/og.png` で参照） |
| `public/icons/deadline.png` | 128×128 px（透過） | カードの「締切まで」ラベル横（16px表示） |
| `public/icons/amount.png` | 128×128 px（透過） | カードの「補助上限」ラベル横（16px表示） |
| `public/icons/area.png` | 128×128 px（透過） | カードの地域チップ列の先頭（16px表示） |
| `public/icons/search.png` | 128×128 px（透過） | 検索ボックス内（20px表示） |
| `public/icons/new.png` | 128×128 px（透過） | 予約（現状未使用。新着表示に使う想定） |

配色: 背景 `#F7F5F0` / インク `#1A1A1A` / 補足 `#6B6B6B` / アクセント（深緑）`#1F5C4A` / 締切アクセント（朱）`#C8452D`。
小さいアイコンは16〜20pxで表示されるため、細い線や小さい文字は避けてください。
