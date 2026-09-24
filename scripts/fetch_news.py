#!/usr/bin/env python3
"""ぴよりん関連ニュースを集めて docs/data/news.json に追記する。

情報源（すべて同時に取得）
  - ぴよりん公式サイト「お知らせ」（HTMLから記事リンクを読み取り）
  - PR TIMES（ジェイアール東海フードサービスの会社別RSS）
  - Googleニュース（関連度順・直近7日・直近1日の3種類の検索RSS）
  - Bingニュース（関連度順・直近7日の2種類の検索RSS）

検索の種類を増やしているのは、1つの検索では新しい記事が上位100件から漏れることがあるため。
標準ライブラリだけで動くので、pip install は不要です。
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
NEWS_FILE = DATA / "news.json"
META_FILE = DATA / "meta.json"
MAX_ITEMS = 500
KEYWORDS = ("ぴよりん", "ピヨリン", "piyorin")
UA = "Mozilla/5.0 (piyorin-news-watch; +https://github.com/)"

OFFICIAL_URL = "https://piyorin.com/news/"
PRTIMES_URL = "https://prtimes.jp/companyrdf.php?company_id=124425"


def gnews(q: str) -> str:
    return "https://news.google.com/rss/search?q=" + quote(q) + "&hl=ja&gl=JP&ceid=JP:ja"


def bing(q: str, newest: bool = False) -> str:
    url = "https://www.bing.com/news/search?q=" + quote(q) + "&format=rss&setlang=ja&cc=JP"
    return url + ("&qft=" + quote('interval="7"') if newest else "")  # 直近7日に絞る


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=20) as r:
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
    t = re.sub(r"[(（]\s*[^)）]{1,20}\s*[)）]\s*$", "", t)  # 末尾の（媒体名）
    return re.sub(r"[\s\W_]+", "", t)


def clean_title(title: str) -> str:
    """「＜画像3 / 8＞」など、同じ記事の別ページを示す前置きを外す。"""
    return re.sub(r"^\s*[＜<]?\s*画像\s*\d+\s*/\s*\d+\s*[＞>]\s*", "", title).strip()


def has_keyword(text: str) -> bool:
    low = (text or "").lower()
    return any(k.lower() in low for k in KEYWORDS)


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s or "")).strip()


def category(source: str, url: str) -> str:
    if "piyorin.com" in url:
        return "official"
    if "PR TIMES" in source or "prtimes.jp" in url:
        return "press"
    return "media"


# ---------- 情報源ごとの読み取り ----------

def parse_official(page: str) -> list[dict]:
    items, seen = [], set()
    date_re = re.compile(r"(20\d{2})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})")
    for m in re.finditer(r'<a\b[^>]*href="((?:https://piyorin\.com)?/news/p\d+/?)"[^>]*>(.*?)</a>', page, re.S):
        url = urljoin(OFFICIAL_URL, m.group(1))
        if url in seen:
            continue
        text = re.sub(r"\s+", " ", strip_tags(m.group(2)))
        dm = date_re.search(text) or date_re.search(page[max(0, m.start() - 600): m.end() + 300])
        title = date_re.sub("", text).strip(" 　|-")
        title = re.sub(r"^(NEW|お知らせ|イベント|新商品|グッズ)\s*", "", title)
        if len(title) < 6:
            continue
        seen.add(url)
        date = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}" if dm else today()
        items.append({"date": date, "cat": "official", "title": title, "source": "ぴよりん公式サイト", "url": url})
    return items


def _rss_items(xml_text: str):
    root = ET.fromstring(xml_text)
    for el in root.iter():
        if el.tag.split("}")[-1] == "item":
            yield {c.tag.split("}")[-1]: c for c in el}


def _text(f: dict, key: str) -> str:
    el = f.get(key)
    return (el.text or "").strip() if el is not None and el.text else ""


def parse_rss(xml_text: str, kind: str) -> list[dict]:
    items = []
    for f in _rss_items(xml_text):
        title, link = _text(f, "title"), _text(f, "link")
        desc = strip_tags(_text(f, "description"))
        source = _text(f, "source") or _text(f, "Source")
        if not title or not link:
            continue
        if kind == "bing" and "apiclick" in link:  # Bingの中継URLから記事URLを取り出す
            link = parse_qs(urlparse(link).query).get("url", [link])[0]
        if kind == "prtimes":
            source = "PR TIMES"
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)].strip()
        title = clean_title(html.unescape(title))
        hay = title + (" " + desc if kind in ("bing", "prtimes") else "")
        if not has_keyword(hay):
            continue
        date = to_jst_date(_text(f, "pubDate") or _text(f, "date")) or today()
        if not source:
            source = urlparse(link).netloc.replace("www.", "")
        items.append({"date": date, "cat": category(source, link), "title": title, "source": source, "url": link})
    return items


SOURCES = [
    ("公式サイト", OFFICIAL_URL, "official"),
    ("PR TIMES", PRTIMES_URL, "prtimes"),
    ("Googleニュース", gnews("ぴよりん"), "google"),
    ("Googleニュース（7日）", gnews("ぴよりん when:7d"), "google"),
    ("Googleニュース（1日）", gnews("ぴよりん when:1d"), "google"),
    ("Bingニュース", bing("ぴよりん"), "bing"),
    ("Bingニュース（7日）", bing("ぴよりん", newest=True), "bing"),
]


def collect(src) -> tuple[str, list[dict] | None, str | None]:
    name, url, kind = src
    try:
        body = fetch(url)
        items = parse_official(body) if kind == "official" else parse_rss(body, kind)
        return name, items, None
    except Exception as e:  # 1つの情報源が落ちても他は続ける
        return name, None, f"{name}: {e}"


# ---------- 統合 ----------

def make_id(item: dict) -> str:
    m = re.search(r"/news/p(\d+)", item["url"])
    if m and item["cat"] == "official":
        return f"official-p{m.group(1)}"
    return "n" + item["date"].replace("-", "") + "-" + hashlib.sha1(item["url"].encode()).hexdigest()[:8]


def dedupe(existing: list[dict]) -> list[dict]:
    """保存済みの記事のうち、同じ記事（タイトルが同じ）を1件にまとめる。"""
    order = {"official": 0, "press": 1, "media": 2}
    kept: dict[str, dict] = {}
    for n in sorted(existing, key=lambda x: (order.get(x.get("cat"), 9), x.get("date", ""))):
        n["title"] = clean_title(n["title"])
        key = norm(n["title"])
        first = kept.get(key)
        if not first:
            kept[key] = n
            continue
        seen = {first["source"]} | {r["source"] for r in first.get("related", [])}
        for r in [{"source": n["source"], "url": n["url"]}] + n.get("related", []):
            if r["source"] not in seen:
                first.setdefault("related", []).append(r)
                seen.add(r["source"])
    return list(kept.values())


def merge(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], int]:
    existing = dedupe(existing)
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
        it["title"] = clean_title(it["title"])
        key = norm(it["title"])
        twin = by_title.get(key)
        if twin:
            if twin["url"] != it["url"] and all(r["url"] != it["url"] for r in twin.get("related", [])):
                # 同じ媒体の別URL（Google経由とBing経由など）は重ねない
                if it["source"] != twin["source"] and all(r["source"] != it["source"] for r in twin.get("related", [])):
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


# ---------- 掲載日の確認 ----------
# ニュース検索は、古い記事を「今日の記事」として返すことがある（画像ページの再掲載など）。
# 新しく入った記事は元のページを開き、ページに書かれた公開日で日付を直す。
PUBLISHED_RE = [
    r'<meta[^>]+property="article:published_time"[^>]+content="(\d{4}-\d{2}-\d{2})',
    r'<meta[^>]+content="(\d{4}-\d{2}-\d{2})[^"]*"[^>]+property="article:published_time"',
    r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})',
    r'<meta[^>]+(?:name|itemprop)="(?:pubdate|publishdate|date|datePublished)"[^>]+content="(\d{4}-\d{2}-\d{2})',
    r'<time[^>]+datetime="(\d{4}-\d{2}-\d{2})',
]
VERIFY_DAYS = 14   # 直近この日数の記事だけ確認する
VERIFY_MAX = 15    # 1回で確認する最大件数


JP_DATE_RE = [
    # 「公開日」「配信」などの近くに書かれた日付
    r"(?:公開|配信|掲載|投稿|更新)(?:日|日時)?[^0-9<]{0,12}(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})",
    # 時刻つきの日付（記事の公開日時の書き方として多い）
    r"(20\d{2})\s*[年/.]\s*(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?\s*(?:\([^)]{1,3}\)\s*)?\d{1,2}:\d{2}",
]
DATE_CHECK_VERSION = 3  # 確認方法を改善したら上げる（確認済みの記事をもう一度確認する）


def published_date(page: str) -> str | None:
    # 公開日の書き方ごとに最初の1つを取り、その中でいちばん古いものを使う
    # （再掲載の日付に引っ張られないように。関連記事の日付を拾わないよう各書き方の最初だけ見る）
    found = []
    for pat in PUBLISHED_RE:
        if found and pat.startswith("<time"):
            break  # <time> は他に手がかりがないときだけ使う
        m = re.search(pat, page, re.I)
        if m and m.group(1) >= "2005-01-01":
            found.append(m.group(1).replace("/", "-"))
    if found:
        return min(found)
    body = page[page.lower().find("<body"):] if "<body" in page.lower() else page
    for pat in JP_DATE_RE:
        m = re.search(pat, body)
        if m:
            y, mo, d = (int(x) for x in m.groups())
            if 1 <= mo <= 12 and 1 <= d <= 31:
                return f"{y}-{mo:02d}-{d:02d}"
    return None


def decode_google(url: str) -> str | None:
    """Googleニュースの中継URLから元記事のURLを取り出す。"""
    aid = urlparse(url).path.rstrip("/").split("/")[-1]
    sg = ts = None
    for base in ("https://news.google.com/articles/", "https://news.google.com/rss/articles/"):
        try:
            page = fetch(base + aid)
        except Exception:
            continue
        sg = re.search(r'data-n-a-sg="([^"]+)"', page)
        ts = re.search(r'data-n-a-ts="([^"]+)"', page)
        if sg and ts:
            break
    if not (sg and ts):
        return None
    inner = json.dumps(["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None,
                                        None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
                        aid, int(ts.group(1)), sg.group(1)])
    data = urlencode({"f.req": json.dumps([[["Fbv4je", inner, None, "generic"]]])}).encode()
    req = urllib.request.Request("https://news.google.com/_/DotsSplashUi/data/batchexecute", data=data,
                                 headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode("utf-8", errors="replace")
    for row in json.loads(body.split("\n\n", 1)[1]):
        if isinstance(row, list) and len(row) > 2 and row[0] == "wrb.fr" and row[2]:
            got = json.loads(row[2])
            if isinstance(got, list) and len(got) > 1 and str(got[1]).startswith("http"):
                return got[1]
    return None


def direct_url(item: dict) -> str | None:
    """中継URL（Googleニュース）なら元記事のURLにする。"""
    if "news.google.com" not in item["url"]:
        return item["url"]
    try:
        return decode_google(item["url"])
    except Exception:
        return None


def article_url(url: str) -> str:
    """写真ギャラリーのページ（…/image123.html など）は記事本体のURLにする。"""
    return re.sub(r"/(?:image|photo|img)\d+\.html?$", "/", url)


def verify(item: dict) -> tuple[dict, str | None, str | None]:
    url = direct_url(item)
    if not url:
        return item, None, None
    url = article_url(url)
    try:
        return item, url, published_date(fetch(url))
    except Exception:
        return item, url, None


def verify_dates(items: list[dict]) -> int:
    limit = (datetime.now(JST).date() - timedelta(days=VERIFY_DAYS)).isoformat()
    todo = [n for n in items if n.get("cat") != "official" and n.get("date", "") >= limit
            and n.get("dv", 0) < DATE_CHECK_VERSION and n.get("tries", 0) < 3][:VERIFY_MAX]
    fixed = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for item, url, real in ex.map(verify, todo):
            if not url:  # 元記事が分からなかったものは次回もう一度（3回まで）
                item["tries"] = item.get("tries", 0) + 1
                continue
            item["dv"] = DATE_CHECK_VERSION
            item.pop("tries", None)
            item.pop("checked", None)
            item["url"] = url  # 元記事のURLに置き換える
            if real and abs((datetime.fromisoformat(real) - datetime.fromisoformat(item["date"])).days) > 3:
                print(f"日付を修正: {item['date']} → {real} {item['title'][:40]}")
                item["date"] = real
                fixed += 1
    print(f"掲載日の確認 {len(todo)}件（修正 {fixed}件）")
    return fixed


def main() -> int:
    t0 = time.time()
    before = NEWS_FILE.read_text(encoding="utf-8") if NEWS_FILE.exists() else "[]"
    existing = json.loads(before)
    incoming, errors, counts = [], [], {}
    with ThreadPoolExecutor(max_workers=len(SOURCES)) as ex:
        for name, items, err in ex.map(collect, SOURCES):
            if err:
                errors.append(err)
                print(f"{name}: 取得失敗 {err}", file=sys.stderr)
                continue
            counts[name] = len(items)
            print(f"{name}: {len(items)}件取得")
            incoming += items

    merged, added = merge(existing, incoming)
    fixed = verify_dates(merged)
    if fixed:
        merged.sort(key=lambda n: (n["date"], n["cat"] == "official"), reverse=True)
    print(f"新規 {added}件 / 合計 {len(merged)}件（{time.time() - t0:.1f}秒）")
    after = json.dumps(merged, ensure_ascii=False, indent=1) + "\n"
    if after != before:
        NEWS_FILE.write_text(after, encoding="utf-8")
    META_FILE.write_text(json.dumps({
        "updatedAt": datetime.now(JST).isoformat(timespec="minutes"),
        "added": added,
        "sources": counts,
        "errors": errors,
    }, ensure_ascii=False) + "\n", encoding="utf-8")
    # すべての情報源が失敗したときだけ失敗扱いにする
    return 1 if len(errors) == len(SOURCES) else 0


if __name__ == "__main__":
    sys.exit(main())
