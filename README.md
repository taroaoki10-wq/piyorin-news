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
  └ scripts/extract_events.py
      公式記事から販売期間・開催日を読み取り
          ↓
      docs/data/events.json
          ↓
GitHub Pages（docs/index.html）→ Safari で表示
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `docs/index.html` | 表示ページ（ニュース／カレンダー） |
| `docs/data/news.json` | ニュース（自動で追記） |
| `docs/data/events.json` | カレンダーの予定（自動追加＋手で編集） |
| `docs/data/state.json` | 予定の読み取りが済んだ記事の記録 |
| `scripts/extract_events.py` | 予定の抽出プログラム |
| `docs/data/meta.json` | 最終更新日時 |
| `scripts/fetch_news.py` | 収集プログラム |
| `.github/workflows/update.yml` | 定期実行の設定 |

## 予定（カレンダー）の自動追加

`scripts/extract_events.py` が、公式サイトの新しいお知らせ記事を読み、「販売期間」「開催日」「実施期間」などの見出しや本文冒頭から日付を読み取って `docs/data/events.json` に追加します（`"auto": true` が付きます）。確認済みの記事は `docs/data/state.json` に記録され、読み直しません。

読み取りを間違えた予定は、`events.json` で直接直してください。直した予定から `"auto": true` を消すと、手で登録した予定として扱われます。予定を手で追加することもできます（ファイルを開いて鉛筆アイコン → 編集 → Commit changes）。

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
