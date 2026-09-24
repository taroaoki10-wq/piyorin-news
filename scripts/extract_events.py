#!/usr/bin/env python3
"""公式サイトの新しいお知らせ記事を読み、販売期間や開催日を
docs/data/events.json（カレンダー）に自動で追加する。

- 対象は news.json にある公式サイトの記事のうち、まだ確認していないもの
- 記事内の「販売期間」「開催日」「実施期間」などの見出しから日付を読み取る
- 手で登録した予定（auto が付いていないもの）は書き換えない
- 確認済みの記事は docs/data/state.json に記録し、次回から読み直さない
"""
from __future__ import annotations

import html
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
NEWS_FILE = DATA / "news.json"
EVENTS_FILE = DATA / "events.json"
STATE_FILE = DATA / "state.json"
UA = "Mozilla/5.0 (piyorin-news-watch; +https://github.com/)"
MAX_ARTICLES_PER_RUN = 20
LOOKBACK_DAYS = 120  # これより古い記事は読まない
# 予定ではない種類のお知らせ
SKIP_TITLE = re.compile(r"お詫び|訂正|休業|営業時間|価格改定|終了のお知らせ|採用|募集要項")

# 見出しの優先順（上ほど優先）
DATE_LABELS = [
    "販売日時", "販売期間", "販売日程", "販売日", "発売日", "販売開始日",
    "実施期間", "開催期間", "開催日時", "開催日程", "開催日", "会期",
    "出店期間", "受付期間", "予約受付期間", "期間", "日程", "日時",
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


def find_labeled(lines: list[str], labels: list[str]) -> list[tuple[str, str]]:
    """見出し行を探し、(見出し, 値テキスト) を優先順に返す。"""
    hits = []
    for pri, label in enumerate(labels):
        pat = re.compile(r"^[【\[■●◆◇▼▶☆★・\s]*" + re.escape(label) + r"(?:[】\]:：\s]+|$|(?=\d))(.*)$")
        for i, ln in enumerate(lines):
            m = pat.match(ln)
            if not m:
                continue
            value = m.group(1).strip()
            following = " ".join(lines[i + 1: i + 3])
            hits.append((pri, i, label, (value + " " + following).strip() if len(value) < 6 else value + " " + following))
    hits.sort(key=lambda h: (h[0], h[1]))
    return [(h[2], h[3]) for h in hits]


def short_title(title: str) -> str:
    quotes = re.findall(r"[「『]([^」』]{2,40})[」』]", title)
    good = [q for q in quotes if "ぴよりん" in q and len(q) >= 6]
    if good:
        return max(good, key=len)
    return re.sub(r"^【[^】]*】", "", title).strip()


def guess_kind(title: str, label: str, single_day: bool) -> str:
    hay = title + " " + label
    if re.search(r"キャンペーン|実施期間|コラボ企画|推し旅|スタンプラリー", hay):
        return "campaign"
    if re.search(r"開催|フェス|イベント|ツアー|祭|展|会期|教室|体験", hay) and "販売" not in label:
        return "event"
    if single_day and re.search(r"発売|予約|受付|販売開始|より販売|登場", hay):
        return "release"
    return "sale"


def extract(article: dict, page: str) -> dict | None:
    base = date.fromisoformat(article["date"])
    lines = html_to_lines(page)
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
    for _, value in find_labeled(lines, PLACE_LABELS):
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


def main() -> int:
    news = json.loads(NEWS_FILE.read_text(encoding="utf-8"))
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8")) if EVENTS_FILE.exists() else []
    state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.exists() else {}
    checked = set(state.get("checkedArticles", []))
    covered = {e.get("url") for e in events}  # すでに予定がある記事（手動分を含む）
    cutoff = (datetime.now(JST).date() - timedelta(days=LOOKBACK_DAYS)).isoformat()

    todo = [n for n in news if n.get("cat") == "official" and n["url"] not in checked
            and n["url"] not in covered and n.get("date", "") >= cutoff
            and not SKIP_TITLE.search(n.get("title", ""))]
    todo = todo[:MAX_ARTICLES_PER_RUN]
    added = 0
    for art in todo:
        try:
            ev = extract(art, fetch(art["url"]))
        except Exception as e:  # 1記事の失敗で止めない
            print(f"読み取り失敗 {art['url']}: {e}", file=sys.stderr)
            continue
        checked.add(art["url"])
        if ev:
            events.append(ev)
            added += 1
            print(f"予定を追加: {ev['start']}〜{ev['end']} {ev['title']}（{ev['kind']}）")
        else:
            print(f"日付なし: {art['title'][:40]}")

    events.sort(key=lambda e: (e.get("start", ""), e.get("end", "")))
    print(f"確認 {len(todo)}記事 / 予定追加 {added}件 / 予定合計 {len(events)}件")
    before = EVENTS_FILE.read_text(encoding="utf-8") if EVENTS_FILE.exists() else ""
    after = json.dumps(events, ensure_ascii=False, indent=1) + "\n"
    if after != before:
        EVENTS_FILE.write_text(after, encoding="utf-8")
    state["checkedArticles"] = sorted(checked)[-2000:]
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
