# ぴよりんニュース

ぴよりんの公式発表・プレスリリース・メディア記事を自動で集めて表示するページです。
GitHub Actions が1時間ごとに情報を集め、GitHub Pages で公開します。予定の読み取り・関連判定・ぴよのメモ作りに Claude API（Haiku）を少し使います。スマホでは、右下のボタンでマスコットの「ぴよ」を呼んでチャットできます。

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
  └ scripts/build_reader.py（リーダー用に元記事を保存）
  └ scripts/judge_relevance.py（ぴよりんと関係ある記事か判定）
  └ scripts/build_piyo.py（ぴよのメモとまとめを作り置き）
          ↓
      docs/data/piyo-memo.json・piyo-greeting.json
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
| `scripts/judge_relevance.py` | ぴよりんと関係ある記事かを判定するプログラム |
| `scripts/build_piyo.py` | ぴよのメモとまとめを作るプログラム |
| `docs/data/piyo-memo.json` | ぴよメモ（記事ごとの要点。自動で作成） |
| `docs/data/piyo-greeting.json` | ぴよが最初につぶやくまとめと質問の候補（自動で作成） |
| `docs/piyo-sprite.png` | ぴよの絵（通常・手を振る・考え中の3行） |
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

## ぴよ（スマホでチャット）

スマホの幅（620px 以下）で見ると、右下にぴよのボタンが出ます。PC の画面は変わりません。

- 押すとぴよが出てきて、最初に「最近のぴよりんニュース」のまとめをつぶやきます。入力欄の上には質問の候補が並び、押すとその質問を送ります。
- 入力欄を押すとキーボードが出て、自由に質問できます。会話は吹き出しで残り、上へスクロールして遡れます。ぴよを出している間、裏のページは動きません。
- 待っている間はまばたきし、タップすると手を振ります。入力欄の右の × でしまいます。
- まとめと質問の候補は `scripts/build_piyo.py` が自動更新のときに作り置きします（メモか予定が変わったとき・日付が変わったときだけ作り直すので、呼ぶたびの料金はかかりません）。
- 質問の答えは、ページが Claude API（Haiku 4.5）を直接呼んで作ります。ぴよメモ（`piyo-memo.json`）と予定（`events.json`）を渡すので、たいていは Web 検索なしで答えます。1回の質問で 1〜3 円ほど、「調べる」を押すと 5 円ほどです。
- メモと予定だけで答えられないときは、ぴよが「記事をくわしく読まないと分からないぴよ。調べる？」「Web で調べる？」と聞きます。「調べる」を押したときだけ、記事の本文（最大3件）を足して聞き直すか、Web 検索（最大3回）を使います。
- はじめて質問すると、Claude の API キーを入れる画面が出ます（[コンソール](https://platform.claude.com/settings/keys)で作ります）。キーはその端末のブラウザ（localStorage `piyo-key`）にだけ保存されます。解除は「ブックマーク」タブの下から。使いすぎが心配なら、コンソールで月の使用額の上限を決めておきます。
- Web 検索は、コンソールの設定で Web 検索が許可されていないと使えません。
- メモの基準を変えたら `build_piyo.py` の `MEMO_VERSION`、まとめの基準を変えたら `GREETING_VERSION` を上げます。

## 「更新」ボタン（いますぐ更新）

ページ右上の「最終更新」の隣にある「更新」ボタン（スマホはタイトルの右の丸いボタン）で、GitHub Actions の「ぴよりんニュースを更新」を今すぐ実行できます。押すと実行の終わりまで待ち（1分ほど）、終わったら画面を読み直します。

- はじめて押すと、合言葉（GitHubの細かい権限を指定できるトークン）の設定画面が出ます。リポジトリは `piyorin-news` だけ、Permissions の Actions を「Read and write」にして作り、貼り付けます。
- 合言葉はその端末のブラウザ（localStorage `piyo-run`）にだけ保存されます。ブックマーク同期の合言葉（gist用）とは別です。解除は「ブックマーク」タブの下にあるボタンから行います。
- 押すたびに予定の抽出と関連判定で Claude API が少し使われます。更新が同時に2つ走ることはありません（workflow の `concurrency`）。
- 合言葉が期限切れ・権限不足のときは、設定画面が理由つきでもう一度出ます。

## 更新の間隔を変える

`.github/workflows/update.yml` の `cron` を書き換えます（時刻は UTC）。

- 3時間ごと：`17 */3 * * *`
- 毎朝7時（日本時間）：`0 22 * * *`
