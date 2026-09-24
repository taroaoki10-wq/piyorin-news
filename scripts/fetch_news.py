#!/usr/bin/env python3
"""ぴよりん関連ニュースを集めて docs/data/news.json に追記する。

情報源
  - ぴよりん公式サイト「お知らせ」ページ（HTMLから記事リンクを読み取り）
  - PR TIMES（ジェイアール東海フードサービスの会社別RSS）
  - Googleニュース（「ぴよりん」の検索結果RSS）

標準ライブラリだけで動くので、pip install は不要です。
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote, urljoin

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
NEWS_FILE = DATA / "news.json"
META_FILE = DATA / "meta.json"
MAX_ITEMS = 400
KEYWORDS = ("ぴよりん", "ピヨリン", "piyorin")

OFFICIAL_URL = "https://piyorin.com/news/"
PRTIMES_URL = "https://prtimes.jp/companyrdf.php?company_id=124425"
GNEWS_URL = "https://news.google.com/rss/search?q=" + quote("ぴよりん") + "&hl=ja&gl=JP&ceid=JP:ja"

UA = "Mozilla/5.0 (piyorin-news-watch; +https://github.com/)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def today() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def to_jst_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)  # RFC 822 (RSS 2.0)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))  # ISO 8601 (RDF)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt.astimezone(JST).strftime("%Y-%m-%d")


def norm(title: str) -> str:
    """重複判定用に、記号や空白を取り除いたタイトル。"""
    t = unicodedata.normalize("NFKC", title).lower()
    return re.sub(r"[\s\W_]+", "", t)


def has_keyword(text: str) -> bool:
    low = text.lower()
    return any(k.lower() in low for k in KEYWORDS)


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).strip()


# ---------- 情報源ごとの取得 ----------

def from_official() -> list[dict]:
    page = fetch(OFFICIAL_URL)
    items, seen = [], set()
    date_re = re.compile(r"(20\d{2})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})")
    for m in re.finditer(r'<a\b[^>]*href="((?:https://piyorin\.com)?/news/p\d+/?)"[^>]*>(.*?)</a>', page, re.S):
        url = urljoin(OFFICIAL_URL, m.group(1))
        if url in seen:
            continue
        # リンク内のテキストから日付を除いたものをタイトルにする
        inner = m.group(2)
        text = re.sub(r"\s+", " ", strip_tags(inner))
        dm = date_re.search(text) or date_re.search(page[max(0, m.start() - 600): m.end() + 300])
        title = date_re.sub("", text).strip(" 　|-")
        # 「NEW」やカテゴリ名だけが前に付く場合を取り除く
        title = re.sub(r"^(NEW|お知らせ|イベント|新商品|グッズ)\s*", "", title)
        if len(title) < 6:
            continue
        seen.add(url)
        date = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}" if dm else today()
        items.append({"date": date, "cat": "official", "title": title,
                      "source": "ぴよりん公式サイト", "url": url})
    return items


def _rss_items(xml_text: str):
    root = ET.fromstring(xml_text)
    for el in root.iter():
        if el.tag.split("}")[-1] == "item":
            yield {c.tag.split("}")[-1]: c for c in el}


def from_prtimes() -> list[dict]:
    items = []
    for f in _rss_items(fetch(PRTIMES_URL)):
        title = (f.get("title").text or "").strip() if f.get("title") is not None else ""
        link = (f.get("link").text or "").strip() if f.get("link") is not None else ""
        desc = f.get("description").text if f.get("description") is not None else ""
        if not title or not link or not has_keyword(title + (desc or "")):
            continue
        date = to_jst_date(f["date"].text if "date" in f else None) or today()
        items.append({"date": date, "cat": "press", "title": title, "source": "PR TIMES", "url": link})
    return items


def from_google_news() -> list[dict]:
    items = []
    for f in _rss_items(fetch(GNEWS_URL)):
        title = (f["title"].text or "").strip() if "title" in f else ""
        link = (f["link"].text or "").strip() if "link" in f else ""
        source = (f["source"].text or "").strip() if "source" in f else ""
        if not title or not link:
            continue
        # Googleニュースのタイトル末尾の「 - 媒体名」を外す
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)].strip()
        if not has_keyword(title):
            continue
        cat = "press" if "PR TIMES" in source else "media"
        date = to_jst_date(f["pubDate"].text if "pubDate" in f else None) or today()
        items.append({"date": date, "cat": cat, "title": title, "source": source or "Googleニュース", "url": link})
    return items


# ---------- 統合 ----------

def make_id(item: dict) -> str:
    m = re.search(r"/news/p(\d+)", item["url"])
    if m and item["cat"] == "official":
        return f"official-p{m.group(1)}"
    return "n" + item["date"].replace("-", "") + "-" + hashlib.sha1(item["url"].encode()).hexdigest()[:8]


def merge(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], int]:
    by_url = {n["url"]: n for n in existing}
    for n in existing:
        for r in n.get("related", []):
            by_url.setdefault(r["url"], n)
    by_title = {norm(n["title"]): n for n in existing}
    added = 0
    # 公式 → プレス → メディアの順に処理して、同じ話題は公式側にまとめる
    order = {"official": 0, "press": 1, "media": 2}
    for it in sorted(incoming, key=lambda x: order.get(x["cat"], 9)):
        if it["url"] in by_url:
            continue
        key = norm(it["title"])
        twin = by_title.get(key)
        if twin:
            twin.setdefault("related", []).append({"source": it["source"], "url": it["url"]})
            by_url[it["url"]] = twin
            continue
        it = {"id": make_id(it), **it, "related": []}
        existing.append(it)
        by_url[it["url"]] = it
        by_title[key] = it
        added += 1
    existing.sort(key=lambda n: (n["date"], n["cat"] == "official"), reverse=True)
    return existing[:MAX_ITEMS], added


def main() -> int:
    before = NEWS_FILE.read_text(encoding="utf-8") if NEWS_FILE.exists() else "[]"
    existing = json.loads(before)
    incoming, errors = [], []
    for name, fn in (("公式サイト", from_official), ("PR TIMES", from_prtimes), ("Googleニュース", from_google_news)):
        try:
            got = fn()
            print(f"{name}: {len(got)}件取得")
            incoming += got
        except Exception as e:  # 1つの情報源が落ちても他は続ける
            errors.append(f"{name}: {e}")
            print(f"{name}: 取得失敗 {e}", file=sys.stderr)

    merged, added = merge(existing, incoming)
    print(f"新規 {added}件 / 合計 {len(merged)}件")
    after = json.dumps(merged, ensure_ascii=False, indent=1) + "\n"
    if after != before:
        NEWS_FILE.write_text(after, encoding="utf-8")
    META_FILE.write_text(json.dumps({
        "updatedAt": datetime.now(JST).isoformat(timespec="minutes"),
        "errors": errors,
    }, ensure_ascii=False) + "\n", encoding="utf-8")
    # すべての情報源が失敗したときだけ失敗扱いにする
    return 1 if len(errors) == 3 else 0


if __name__ == "__main__":
    sys.exit(main())
