# ぴよりんニュース

ぴよりんの公式発表・プレスリリース・メディア記事を自動で集めて表示するページです。
GitHub Actions が3時間ごとに情報を集め、GitHub Pages で公開します。Claude のトークンは使いません。

## しくみ

```
GitHub Actions（3時間ごと）
  └ scripts/fetch_news.py
      ├ ぴよりん公式サイト「お知らせ」
      ├ PR TIMES（ジェイアール東海フードサービス）
      └ Googleニュース「ぴよりん」
          ↓ 新しい記事だけ追記
      docs/data/news.json
          ↓
GitHub Pages（docs/index.html）→ Safari で表示
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `docs/index.html` | 表示ページ（ニュース／カレンダー） |
| `docs/data/news.json` | ニュース（自動で追記） |
| `docs/data/events.json` | カレンダーの予定（手で編集） |
| `docs/data/meta.json` | 最終更新日時 |
| `scripts/fetch_news.py` | 収集プログラム |
| `.github/workflows/update.yml` | 定期実行の設定 |

## 予定（カレンダー）の追加

予定はニュースから自動で正しく読み取るのが難しいため、`docs/data/events.json` を GitHub の画面で直接編集します（ファイルを開いて鉛筆アイコン → 編集 → Commit changes）。

```json
{
 "id": "e-好きな英数字",
 "title": "予定の名前",
 "start": "2026-10-01",
 "end": "2026-10-04",
 "place": "場所",
 "kind": "sale",
 "url": "https://..."
}
```

`kind` は次のどれかです。

- `sale`：限定販売（黄）
- `event`：イベント（青）
- `campaign`：キャンペーン（緑）
- `release`：発売・受付開始（枠線）

## 更新の間隔を変える

`.github/workflows/update.yml` の `cron` を書き換えます（時刻は UTC）。

- 3時間ごと：`17 */3 * * *`
- 毎朝7時（日本時間）：`0 22 * * *`
