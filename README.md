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
| `docs/data/reader/` | ページ内リーダー用の記事（1記事1ファイル。メディア記事は掲載元の要約のみ） |
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

## 関係ない記事の判定・削除

`scripts/judge_relevance.py` が、公式以外の記事（プレスリリース・メディア）がぴよりんに関係あるかを Claude（既定は Haiku 4.5）で判定し、`news.json` の各記事に `jg`（`ok`・`why`）を書き込みます。判定済みの記事は読み直しません（1回の更新で最大90件、新しい記事から）。

- 画面では、`ok: false` の記事はニュース一覧に出さず、「削除済み」に移します。「削除済み」から記事を読んだり「元に戻す」ことができます。
- 一覧の記事にカーソルを合わせると出るごみ箱ボタン（スマホは常に表示）や、リーダー右上のボタンで、手動でも削除できます。直後に「元に戻す」も押せます。
- 削除と元に戻した記録はブラウザ（localStorage `piyo-del`）に保存され、ブックマークの同期を設定していれば、同じ非公開 gist の `piyorin-hidden.json` に保存されて端末間で共有されます。
- 判定の基準を変えたときは `JUDGE_VERSION` を上げます。すべての記事をもう一度判定したいときは、Actions の「Run workflow」で `rejudge` にチェックを入れます。
- APIキー（`ANTHROPIC_API_KEY`）が無いときは判定せず、記事はそのまま表示されます。

## 更新の間隔を変える

`.github/workflows/update.yml` の `cron` を書き換えます（時刻は UTC）。

- 3時間ごと：`17 */3 * * *`
- 毎朝7時（日本時間）：`0 22 * * *`
