# ぴよりんニュース

ぴよりんの公式発表・プレスリリース・メディア記事を自動で集めて表示するページです。
GitHub Actions が3時間ごとに情報を集め、GitHub Pages で公開します。Claude のトークンは使いません。

## しくみ

```
GitHub Actions（1時間ごと・毎時23分）
  └ scripts/fetch_news.py（7つの情報源を同時に取得）
      ├ ぴよりん公式サイト「お知らせ」
      ├ PR TIMES（ジェイアール東海フードサービス）
      ├ Googleニュース「ぴよりん」（関連度順・直近7日・直近1日）
      └ Bingニュース「ぴよりん」（関連度順・直近7日）
          ↓ 新しい記事だけ追記（同じ話題は「ほか◯件」にまとめる）
      docs/data/news.json
  └ scripts/extract_events.py
      新しい公式記事から販売期間・開催日を読み取り
        ・日付のない記事 → 何もしない
        ・日付が1つだけの記事 → パターンで読み取り（APIを使わない）
        ・日程が複数ある記事 → 日付まわりの抜粋だけをまとめて Claude API へ
          ↓
      docs/data/events.json
          ↓
GitHub Pages（docs/index.html、5分ごとに読み直し）→ Safari で表示
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `docs/index.html` | 表示ページ（ニュース／カレンダー） |
| `docs/data/news.json` | ニュース（自動で追記） |
| `docs/data/events.json` | カレンダーの予定（自動追加＋手で編集） |
| `docs/data/state.json` | 予定の読み取りが済んだ記事の記録 |
| `scripts/extract_events.py` | 予定の抽出プログラム |
| `scripts/claude_events.py` | Claude API で記事から予定を読み取る部分 |
| `docs/data/articles.json` | ページ内リーダー用の記事本文（予定の元記事） |
| `scripts/build_reader.py` | リーダー用に元記事を保存するプログラム |
| `docs/data/meta.json` | 最終更新日時 |
| `scripts/fetch_news.py` | 収集プログラム |
| `.github/workflows/update.yml` | 定期実行の設定 |

## 予定（カレンダー）の自動追加

`scripts/extract_events.py` が、公式サイトの新しいお知らせ記事を Claude API（`scripts/claude_events.py`、既定は Claude Haiku 4.5）に渡し、販売期間・開催日・キャンペーン期間などを予定として読み取って `docs/data/events.json` に追加します（`"auto": true` が付きます）。1つの記事に日程が複数あれば、それぞれ別の予定になります。確認済みの記事は `docs/data/state.json` に記録され、読み直しません。

- APIキーは GitHub の Settings → Secrets and variables → Actions に `ANTHROPIC_API_KEY` として登録します。
- キーが未登録のときは、見出しのパターンから日付を読み取る方法で動きます。
- 使ったトークン数は Actions のログ（「Claude API 使用量」）に出ます。
- モデルを変えたいときは、ワークフローの env に `CLAUDE_MODEL` を追加します。

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
