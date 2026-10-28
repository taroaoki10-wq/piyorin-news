#!/usr/bin/env python3
"""公式サイトのお知らせと PR TIMES のプレスリリースを読み、販売期間や開催日を
docs/data/events.json（カレンダー）に自動で追加する。

- 対象は news.json の公式・プレスリリースの記事。同じ話題としてまとめた公式サイトと
  PR TIMES の記事、公式の記事が「詳しくは下記URL」として載せた PR TIMES の記事もあわせて読む
  （公式の記事には日付が書かれず、PR TIMES にだけ書かれていることがあるため）
- 本文だけを読む。投稿日・分類の札・関連記事の一覧（別の記事の日付）は読まない
- 記事の「読んだ元の組み合わせ」を docs/data/state.json に記録し、新しい元（PR TIMES など）が
  加わったとき、または読み取り方の版（EXTRACT_VERSION）を上げたときは読み直して、
  その記事の自動の予定を入れ替える
- 手で登録した予定（auto が付いていないもの）は書き換えない
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from claude_events import claude_events_batch, snippet
from news_store import linked_sources, primary_sources

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
NEWS_FILE = DATA / "news.json"
EVENTS_FILE = DATA / "events.json"
STATE_FILE = DATA / "state.json"
UA = "Mozilla/5.0 (piyorin-news-watch; +https://github.com/)"
MAX_ARTICLES_PER_RUN = 20
LOOKBACK_DAYS = 120  # これより古い記事は読まない
EXTRACT_VERSION = 3  # 読み取り方を変えたら上げる（期間内の記事を読み直し、自動の予定を入れ替える）
# 本文の終わり。ここから下は関連記事の一覧などで、別の記事の日付が並ぶ
STOP_LINE = re.compile(r"^(?:お知らせカテゴリ|関連記事|SHARE\b|このプレスリリースには|プレスリリース素材|一覧に戻る|お知らせ一覧)")
# 予定ではない行（公式サイトの投稿日と分類の札、PR TIMES の配信日時）
META_LINE = re.compile(r"^(?:\d{4}\.\d{1,2}\.\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}時\d{2}分"
                       r"|NEW|店舗|限定商品|おでかけ情報|お知らせ|イベント|新商品|グッズ)$")
# 予定ではない種類のお知らせ
SKIP_TITLE = re.compile(r"お詫び|訂正|休業|営業時間|価格改定|終了のお知らせ|採用|募集要項")

# 見出しの優先順（上ほど優先）
DATE_LABELS = [
    "販売日時", "販売期間", "販売日程", "販売日", "発売日", "販売開始日",
    "実施期間", "開催期間", "開催日時", "開催日程", "開催日", "会期",
    "出店期間", "受付期間", "予約受付期間", "ツアー実施日", "実施日", "運行日", "期間", "日程", "日時",
]
PLACE_LABELS = ["販売場所", "開催場所", "出店場所", "会場", "販売店舗", "場所", "引換場所"]

SEP = r"\s*(?:\([^)]{1,6}\))?\s*(?:~|〜|-|－|―|から|・|、|,)\s*"
FULL = r"(?:(20\d{2})\s*[年./]\s*)?(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?"
DAY_ONLY = r"(\d{1,2})\s*(?:日|(?=\())"
RANGE_RE = re.compile(FULL + r"(?:" + SEP + r"(?:" + FULL + r"|" + DAY_ONLY + r"))?")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", errors="replace")


def html_to_lines(page: str) -> list[str]:
    """本文らしき部分をテキスト行にする。"""
    m = re.search(r"<(article|main)\b.*?</\1>", page, re.S | re.I)
    body = m.group(0) if m else page
    body = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", body, flags=re.S | re.I)
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    body = re.sub(r"</?(p|div|h\d|li|tr|dt|dd|th|td|section|table|ul|ol|dl|figure)\b[^>]*>", "\n", body, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", body))
    lines = []
    for ln in text.split("\n"):
        ln = unicodedata.normalize("NFKC", re.sub(r"[ \t　]+", " ", ln)).strip()
        if ln:
            lines.append(ln)
    return lines


def article_lines(page: str) -> list[str]:
    """本文の行だけを返す（投稿日・分類の札を除き、関連記事の一覧より前で止める）。"""
    out = []
    for ln in html_to_lines(page):
        if STOP_LINE.match(ln):
            break
        if not META_LINE.match(ln):
            out.append(ln)
    return out


def _mkdate(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def in_window(r: tuple[date, date], base: date) -> bool:
    """記事の日付から大きく離れたもの（過去の実績の紹介など）は除く。"""
    return base - timedelta(days=30) <= r[0] <= base + timedelta(days=400)


def parse_range(text: str, base: date) -> tuple[date, date] | None:
    """文字列中の最初の妥当な日付（範囲）を読む。年がなければ記事の日付から補う。"""
    for m in RANGE_RE.finditer(text):
        y1, m1, d1, y2, m2, d2, d_only = m.groups()
        mo, dy = int(m1), int(d1)
        if not (1 <= mo <= 12 and 1 <= dy <= 31):
            continue
        # 「10:00」「1/2ぴよ」などの誤検出を避ける
        tail = text[m.end(): m.end() + 1]
        if tail == ":":
            continue
        year = int(y1) if y1 else base.year
        if not y1 and mo < base.month - 6:
            year += 1
        start = _mkdate(year, mo, dy)
        if not start:
            continue
        end = start
        if m2 and d2:
            ey = int(y2) if y2 else year
            end = _mkdate(ey, int(m2), int(d2)) or start
            if end < start and not y2:
                end = _mkdate(ey + 1, int(m2), int(d2)) or start
        elif d_only:
            end = _mkdate(year, mo, int(d_only)) or start
        if end < start or (end - start).days > 200:
            end = start
        if in_window((start, end), base):
            return start, end
    return None


def find_labeled(lines: list[str], labels: list[str], extra: int = 2) -> list[tuple[str, str]]:
    """見出し行を探し、(見出し, 値テキスト) を優先順に返す。extra は続けて読む行数。"""
    hits = []
    for pri, label in enumerate(labels):
        pat = re.compile(r"^[【\[■●◆◇▼▶☆★・\s]*" + re.escape(label) + r"(?:[】\]:：\s]+|$|(?=\d))(.*)$")
        for i, ln in enumerate(lines):
            m = pat.match(ln)
            if not m:
                continue
            value = m.group(1).strip()
            following = " ".join(lines[i + 1: i + 1 + extra])
            if extra == 1 and len(value) >= 2:
                text = value  # 場所は見出しと同じ行の値だけを使う
            elif extra == 1:
                text = lines[i + 1] if i + 1 < len(lines) else ""
            else:
                text = (value + " " + following).strip()
            hits.append((pri, i, label, text))
    hits.sort(key=lambda h: (h[0], h[1]))
    return [(h[2], h[3]) for h in hits]


def short_title(title: str) -> str:
    quotes = re.findall(r"[「『]([^」』]{2,40})[」』]", title)
    good = [q for q in quotes if "ぴよりん" in q and len(q) >= 6
            and not re.fullmatch(r"ぴよりん\s*(village|アトリエ|shop|ショップ|カフェ|MARKET).*", q, re.I)]
    if good:
        return max(good, key=len)
    return re.sub(r"^【[^】]*】", "", title).strip()


def guess_kind(title: str, label: str, single_day: bool) -> str:
    hay = title + " " + label
    if re.search(r"キャンペーン|実施期間|コラボ企画|推し旅|スタンプラリー", hay):
        return "campaign"
    if re.search(r"開催|フェス|イベント|ツアー|祭|展|会期|教室|体験|実施日|運行|乗車", hay) and "販売" not in label:
        return "event"
    if single_day and re.search(r"発売|予約|受付|販売開始|より販売|登場", hay):
        return "release"
    return "sale"


def extract(article: dict, lines: list[str]) -> dict | None:
    base = date.fromisoformat(article["date"])
    found = None
    for label, value in find_labeled(lines, DATE_LABELS):
        r = parse_range(value, base)
        if r:
            found = (label, r)
            break
    if not found:
        # 見出しがない記事は、本文冒頭の文から読む
        lead = " ".join(l for l in lines[:12] if "ぴよりん" in l or "販売" in l or "開催" in l)
        r = parse_range(lead, base)
        if r:
            found = ("本文", r)
    if not found:
        return None
    label, (start, end) = found
    place = ""
    for _, value in find_labeled(lines, PLACE_LABELS, extra=1):
        place = re.split(r"\s*[※(]|\s{2,}|URL|TEL", value)[0].strip(" :：")
        if place:
            break
    if not place:
        # 見出しがなければ、タイトル中の「ぴよりん」以外のかぎかっこ（会場名のことが多い）を使う
        others = [q for q in re.findall(r"「([^」]{2,20})」", article["title"]) if "ぴよりん" not in q]
        place = others[-1] if others else ""
    return {
        "id": "auto-" + re.sub(r"\W", "", article["id"])[-24:],
        "title": short_title(article["title"]),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "place": place[:40],
        "kind": guess_kind(article["title"], label, start == end),
        "url": article["url"],
        "auto": True,
    }


def count_ranges(text: str, base: date) -> int:
    """抜粋に出てくる、記事の時期に合う日付（範囲）の数。"""
    found = set()
    for m in RANGE_RE.finditer(text):
        r = parse_range(m.group(0), base)
        if r:
            found.add(r)
    return len(found)


def similar(a: str, b: str) -> bool:
    """予定の名前が似ているか（片方がもう片方を含む、または2文字ずつの並びが半分以上重なる）。"""
    na, nb = (re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", x)).lower() for x in (a, b))
    if not na or not nb:
        return False
    if na in nb or nb in na:
        return True
    ga, gb = ({x[i:i + 2] for i in range(len(x) - 1)} for x in (na, nb))
    return len(ga & gb) / max(1, len(ga | gb)) >= 0.5


def same_name(a: str, b: str) -> bool:
    na, nb = (re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", x)).lower() for x in (a, b))
    return bool(na) and na == nb


def drop_duplicates(events: list[dict]) -> list[dict]:
    """別々の記事から読んだ同じ予定（期間が同じで名前が似ている自動の予定）と、
    手で登録した予定と期間も名前も同じ自動の予定は1つにする（手で登録した予定を残す）。"""
    manual = [e for e in events if not e.get("auto")]
    kept = []
    for e in events:
        end = e.get("end") or e.get("start")

        def same_span(k):
            return k.get("start") == e.get("start") and (k.get("end") or k.get("start")) == end

        if e.get("auto") and (
                any(same_span(k) and same_name(k.get("title", ""), e.get("title", "")) for k in manual)
                or any(k.get("auto") and k.get("src", k.get("url")) != e.get("src", e.get("url"))
                       and same_span(k) and similar(k.get("title", ""), e.get("title", "")) for k in kept)):
            print(f"重なる予定を外す: {e['start']}〜{end} {e.get('title', '')}")
            continue
        kept.append(e)
    return kept


def read_pages(urls) -> dict[str, list[str] | None]:
    """URLごとの本文の行（読めなかったものは None）。"""
    def load(u):
        try:
            return u, article_lines(fetch(u))
        except Exception as e:
            print(f"読み取り失敗 {u}: {e}", file=sys.stderr)
            return u, None

    with ThreadPoolExecutor(max_workers=8) as ex:
        return dict(ex.map(load, sorted(urls)))


def basis(item: dict) -> str:
    """読んだ元の組み合わせ。これが変わったら読み直す。"""
    return f"v{EXTRACT_VERSION} " + " ".join(primary_sources(item))


def main() -> int:
    t0 = time.time()
    news = json.loads(NEWS_FILE.read_text(encoding="utf-8"))
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8")) if EVENTS_FILE.exists() else []
    state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.exists() else {}
    done = state.get("items") if isinstance(state.get("items"), dict) else {}
    manual = {e.get("url") for e in events if not e.get("auto")}  # 手で予定を登録した記事は読まない
    cutoff = (datetime.now(JST).date() - timedelta(days=LOOKBACK_DAYS)).isoformat()

    # 手で登録した予定（Claude に渡し、同じ予定を出さないようにする）
    known = [e for e in events if not e.get("auto") and (e.get("end") or e.get("start", "")) >= cutoff]
    todo = [n for n in news if n.get("cat") in ("official", "press") and n.get("date", "") >= cutoff
            and not SKIP_TITLE.search(n.get("title", ""))
            and not (isinstance(n.get("jg"), dict) and n["jg"].get("ok") is False)
            and primary_sources(n) and not manual.intersection(primary_sources(n))
            and done.get(n["id"]) != basis(n)][:MAX_ARTICLES_PER_RUN]
    if not todo:
        print(f"新しく読む記事なし（{time.time() - t0:.1f}秒）")
        return 0

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    pages = read_pages({u for n in todo for u in primary_sources(n)})
    linked = {u for lines in pages.values() if lines for u in linked_sources("\n".join(lines))} - set(pages)
    pages.update(read_pages(linked))

    results: dict[str, list[dict]] = {}
    sources: dict[str, list[str]] = {}
    ask: list[tuple[dict, str]] = []
    for art in todo:
        own = primary_sources(art)
        srcs = list(dict.fromkeys(own + [u for s in own for u in linked_sources("\n".join(pages.get(s) or []))]))
        if any(pages.get(u) is None for u in srcs):  # 読めなかった元がある記事は次回もう一度読む
            continue
        sources[art["id"]] = srcs
        lines = [ln for u in srcs for ln in pages[u]]
        text = "\n\n".join(t for t in (snippet(pages[u]) for u in srcs) if t)
        base = date.fromisoformat(art["date"])
        n = count_ranges(text, base)
        if n == 0:
            results[art["id"]] = []  # 日付がない記事はAPIに送らない
            continue
        if api_key:  # 予定の名前を短く分かりやすくするため、日付がある記事は Claude に読ませる
            ask.append((art, text))
        else:  # APIキーが無いときは見出しのパターンで読む
            one = extract(art, lines)
            results[art["id"]] = [one] if one else []

    tokens = {"input_tokens": 0, "output_tokens": 0}
    for i in range(0, len(ask), 8):  # 8記事ずつまとめて1回で読ませる
        chunk = ask[i:i + 8]
        try:
            found, usage = claude_events_batch(chunk, api_key, known)
        except Exception as e:  # APIが失敗した記事は次回もう一度読む
            print(f"Claude API 失敗: {e}", file=sys.stderr)
            continue
        for k in tokens:
            tokens[k] += usage.get(k, 0)
        for j, (art, _) in enumerate(chunk):
            results[art["id"]] = found.get(j, [])

    added = 0
    for art in todo:
        if art["id"] not in results:
            continue
        # この記事から前に読んだ自動の予定を、今回読んだ予定に入れ替える
        ids, srcs = {art["id"], *art.get("merged_ids", [])}, set(sources[art["id"]])
        old = [e for e in events if e.get("auto") and (e.get("src") in ids or (not e.get("src") and e.get("url") in srcs))]
        found = results[art["id"]]
        if not found:
            # 読み直して何も見つからないときは、前の予定を消さずに残す（ページの作りが変わったときに予定を失わないため）
            print(f"予定なし: {art['title'][:40]}" + (f"（前の予定 {len(old)}件は残す）" if old else ""))
            old = []
        events = [e for e in events if not any(e is o for o in old)]
        base_id = "auto-" + re.sub(r"\W", "", art["id"])[-24:]
        for n, ev in enumerate(found):
            ev = {"id": base_id if n == 0 else f"{base_id}-{n + 1}", **{k: v for k, v in ev.items() if k != "id"},
                  "url": art["url"], "src": art["id"], "auto": True}
            events.append(ev)
            added += 1
            print(f"予定を{'入れ替え' if old else '追加'}: {ev['start']}〜{ev['end']} {ev['title']}（{ev['kind']}）")
        for e in old:
            if not any(f["start"] == e["start"] and f["end"] == e.get("end") and f["title"] == e["title"] for f in found):
                print(f"前の予定を外す: {e['start']}〜{e.get('end')} {e['title']}")
        done[art["id"]] = basis(art)

    events.sort(key=lambda e: (e.get("start", ""), e.get("end", "")))
    events = drop_duplicates(events)
    print(f"確認 {len(results)}記事（うちAPI {len(ask)}記事）/ 予定 {added}件 / 予定合計 {len(events)}件（{time.time() - t0:.1f}秒）")
    if tokens["input_tokens"]:
        print(f"Claude API 使用量: 入力 {tokens['input_tokens']} / 出力 {tokens['output_tokens']} トークン")
    before = EVENTS_FILE.read_text(encoding="utf-8") if EVENTS_FILE.exists() else ""
    after = json.dumps(events, ensure_ascii=False, indent=1) + "\n"
    if after != before:
        EVENTS_FILE.write_text(after, encoding="utf-8")
    known = {n["id"] for n in news}
    state = {"items": {k: v for k, v in sorted(done.items()) if k in known}}
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
