#!/usr/bin/env python3
"""ぴよりん関連ニュースを集め、最新500件と年別保管庫に保存する。

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
import copy
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
from news_store import page_html, read_news, request_url, write_news

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
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
    req = urllib.request.Request(request_url(url), headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or "utf-8"
    return page_html(url, raw.decode(charset, errors="replace"))


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
    t = re.sub(r"\s*[|｜][^|｜]{1,30}$", "", t)  # 末尾の「｜媒体名」（比べるときだけ外す）
    return re.sub(r"[\s\W_]+", "", t)


def stem(title: str) -> str:
    """途中で切れた見出し（「…」「...」で終わる）の、残っている前半。"""
    return norm(re.sub(r"\s*(?:\.\.\.|…)$", "", title))


def truncated(title: str) -> bool:
    return title.endswith(("...", "…"))


# 見出しの末尾に付く掲載サイトの名前（表示から外す）。普通の「｜」を使った見出しは残す。
MEDIA_SUFFIX = re.compile(r"\s*[|｜]\s*[^|｜]{0,30}(?:ニュース|NEWS|News|新聞|さんデジ|グルメとフード|公式ウェブサイト|のプレスリリース)$")


def clean_title(title: str) -> str:
    """写真ページの飾りと末尾の掲載サイト名だけを外す。普通の見出し末尾の日付は残す。"""
    t = title.strip()
    prefix = (r"^(?:[＜<]?\s*画像\s*\d+\s*/\s*\d+\s*[＞>]|【画像】|画像・写真\s*[|｜]|写真・図版[（(]\d+枚目[）)]\s*[|｜]"
              r"|(?:写真|画像)\s*\d+\s*/\s*\d+\s*[|｜])\s*")
    t = re.sub(r"^HOME\s+PR\s+TIMES\s+", "", t)  # 掲載サイトのパンくずが見出しに入ったもの
    cleaned = re.sub(prefix, "", t)
    if cleaned != t:
        cleaned = re.sub(r"\s+(?:\d+\s*/\s*\d+|\d+枚目)$", "", cleaned)
    stripped = MEDIA_SUFFIX.sub("", cleaned)
    return (stripped if len(stripped) >= 6 else cleaned).strip()


# Google ニュースは長い見出しを「...」で切る。記事のページの題名で補う（同じ書き出しのときだけ）
TRUNCATED = re.compile(r"\s*(?:\.\.\.|…)$")
# ページの題名の終わりに付く掲載サイト名（「 - Yahoo!ニュース」「:山陽新聞デジタル｜さんデジ」「（静岡放送（SBS））」）
SITE_TAIL = re.compile(r"\s+[-–—]\s+[^-–—]{1,30}$|\s*[:：]\s*[^:：]{0,30}(?:新聞|デジタル|ニュース|NEWS)[^:：]{0,20}$")
MEDIA_PAREN = re.compile(r"\s*（[^（）]*(?:（[^（）]*）[^（）]*)?）$")
MEDIA_WORD = re.compile(r"放送|新聞|テレビ|ニュース|NEWS|SBS|CBC|中京|メ[~〜～]テレ")


def page_title(page: str) -> str:
    m = (re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', page, re.I)
         or re.search(r'<meta[^>]+content="([^"]*)"[^>]+property="og:title"', page, re.I)
         or re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I))
    return re.sub(r"\s+", " ", html.unescape(m.group(1))).strip() if m else ""


def full_title(title: str, page: str) -> str | None:
    """「...」で切れた見出しを、ページの題名で補う。書き出しが同じで、補ったほうが長いときだけ。"""
    if not TRUNCATED.search(title):
        return None
    head, t = TRUNCATED.sub("", title), SITE_TAIL.sub("", page_title(page))
    tail = MEDIA_PAREN.search(t)
    if tail and MEDIA_WORD.search(tail.group(0)):
        t = t[:tail.start()]
    t = clean_title(t)
    key = lambda s: re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", s))
    return t if len(key(t)) > len(key(head)) and key(t).startswith(key(head)) else None


# 公式サイトの一覧では、リンクの中に分類の札（店舗・限定商品など）と「記事を見る」が入る（2026年9月末から）
OFFICIAL_LABEL = re.compile(r"^(?:NEW\s*|(?:お知らせ|イベント|新商品|グッズ|店舗|限定商品|おでかけ情報)(?:\s+|(?=[「『【])))")


def official_title(title: str) -> str:
    """公式サイトの記事の見出しから、分類の札と「記事を見る」を外す。"""
    t = re.sub(r"\s*記事を見る$", "", title.strip())
    while (m := OFFICIAL_LABEL.match(t)) and len(t) - m.end() >= 6:
        t = t[m.end():]
    return t.strip()


def article_key(url: str) -> str:
    """媒体ごとの記事IDで識別。未知のphoto URLは推測しない。"""
    p = urlparse(url)
    host = (p.hostname or "").lower()
    patterns = {
        "news.livedoor.com": r"/article/(?:detail|image_detail)/(\d+)/?",
        "www.oricon.co.jp": r"/news/(\d+)/(?:full/|photo/\d+/|comment/)?",
        "www.sankei.com": r"/article/([^/]+)/(?:photo/[^/]+/)?",
        "dot.asahi.com": r"/articles/(?:photo|-)/(\d+)/?",
        "www.fashion-press.net": r"/news/(?:gallery/)?(\d+)(?:/\d+)?/?",
    }
    m = re.fullmatch(patterns.get(host, r"(?!)"), p.path)
    return host + ":" + m.group(1) if m else url


def article_keys(item: dict) -> set[str]:
    return {"title:" + norm(item["title"])} | {
        "url:" + article_key(r["url"])
        for r in [item] + item.get("related", [])
    }


def is_relay(url: str) -> bool:
    """Googleニュースの中継URL。"""
    return "news.google.com" in url


def direct_sources(item: dict, extra: list[dict] = ()) -> set[str]:
    links = [item] + item.get("related", []) + list(extra)
    return {r["source"] for r in links if not is_relay(r["url"])}


def absorb(first: dict, other: dict) -> None:
    """代表記事のID・判定を維持し、まとめた記事のIDと元リンクを残す。"""
    aliases = set(first.get("merged_ids", [])) | set(other.get("merged_ids", []))
    if other.get("id"):
        aliases.add(other["id"])
    aliases.discard(first["id"])
    if aliases:
        first["merged_ids"] = sorted(aliases)
    seen = {first["url"]} | {r["url"] for r in first.get("related", [])}
    links = [other] + other.get("related", [])
    direct = direct_sources(first, links)
    for r in links:
        # 同じ媒体の元記事があるときは、Googleニュース経由の同じ記事を「ほか◯件」に足さない
        if r["url"] not in seen and not (is_relay(r["url"]) and r["source"] in direct):
            first.setdefault("related", []).append({"source": r["source"], "url": r["url"]})
            seen.add(r["url"])
    # 公式の記事は関連判定の対象外なので、まとめた記事の判定で隠さない
    if "jg" not in first and "jg" in other and first.get("cat") != "official":
        first["jg"] = copy.deepcopy(other["jg"])


def prune_relays(item: dict) -> None:
    """保存済みの「ほか◯件」から、同じ媒体の元記事と重なるGoogleニュース経由のリンクを外す。"""
    related = item.get("related", [])
    direct = direct_sources(item)
    kept = [r for r in related if not (is_relay(r["url"]) and r["source"] in direct)]
    if len(kept) != len(related):
        item["related"] = kept


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
    title_el = re.compile(r'<(h\d|p)\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>(.*?)</\1>', re.S)
    date_el = re.compile(r'class="[^"]*\bdate\b[^"]*"[^>]*>(.*?)</', re.S)
    for m in re.finditer(r'<a\b[^>]*href="((?:https://piyorin\.com)?/news/p\d+/?)"[^>]*>(.*?)</a>', page, re.S):
        url = urljoin(OFFICIAL_URL, m.group(1))
        if url in seen:
            continue
        # 見出しと日付の要素があればそれを使う（分類の札や「記事を見る」を見出しに混ぜない）
        te, de = title_el.search(m.group(2)), date_el.search(m.group(2))
        text = re.sub(r"\s+", " ", strip_tags(te.group(2) if te else m.group(2)))
        dm = (date_re.search(strip_tags(de.group(1))) if de else None) or date_re.search(text) \
            or date_re.search(page[max(0, m.start() - 600): m.end() + 300])
        title = official_title(date_re.sub("", text).strip(" 　|-"))
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
    """見出し・記事URLのどちらでつながる場合も、同じグループにまとめる。"""
    items = copy.deepcopy(existing)
    parents = list(range(len(items)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    seen = {}
    for i, item in enumerate(items):
        item["title"] = clean_title(item["title"])
        if item.get("cat") == "official":
            item["title"] = official_title(item["title"])
        for key in article_keys(item):
            if key in seen:
                parents[root(i)] = root(seen[key])
            seen[key] = i
    # 途中で切れた見出しは、前半が同じで日付が近い（7日以内）記事にまとめる
    full = [(norm(it["title"]), j) for j, it in enumerate(items) if not truncated(it["title"])]
    for i, item in enumerate(items):
        head = stem(item["title"]) if truncated(item["title"]) else ""
        if len(head) < 12:
            continue
        near = [(gap, j) for t, j in full if t.startswith(head)
                and (gap := abs((datetime.fromisoformat(items[j]["date"]) - datetime.fromisoformat(item["date"])).days)) <= 7]
        if near:
            parents[root(i)] = root(min(near)[1])
    groups = {}
    for i, item in enumerate(items):
        groups.setdefault(root(i), []).append(item)
    order = {"official": 0, "press": 1, "media": 2}
    result = []
    for group in groups.values():
        # 元からある通常記事を優先。同一URLの見出し違いは長い見出しを残す。
        group.sort(key=lambda n: (order.get(n["cat"], 9),
                   bool(re.search(r"/(?:image_detail|photo|comment)/", n["url"])),
                   n["date"], -len(n["title"])))
        first = group[0]
        if truncated(first["title"]):
            head = stem(first["title"])
            complete = [n["title"] for n in group if not truncated(n["title"])
                        and (n["url"] == first["url"] or norm(n["title"]).startswith(head))]
            if complete:
                first["title"] = max(complete, key=len)
        for other in group[1:]:
            absorb(first, other)
        prune_relays(first)
        result.append(first)
    return result


def merge(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], int]:
    existing = dedupe(existing)
    by_key = {key: n for n in existing for key in article_keys(n)}
    added = 0
    order = {"official": 0, "press": 1, "media": 2}
    for it in sorted(copy.deepcopy(incoming), key=lambda x: order.get(x["cat"], 9)):
        it["title"] = clean_title(it["title"])
        if it.get("cat") == "official":
            it["title"] = official_title(it["title"])
        keys = article_keys(it)
        # URLを先に照合し、同じ写真が違う見出しで配信されても再追加しない。
        twin = next((by_key[k] for k in sorted(keys, reverse=True) if k in by_key), None)
        if twin is not None:
            # 新着のURLと見出しが別々の既存グループに一致する場合も接続する。
            others = {id(by_key[k]): by_key[k] for k in keys if k in by_key and by_key[k] is not twin}
            for other in others.values():
                absorb(twin, other)
            if others:
                existing = [n for n in existing if id(n) not in others]
                by_key = {k: twin if id(n) in others else n for k, n in by_key.items()}
            absorb(twin, it)
            for key in keys:
                by_key[key] = twin
            continue
        it = {"id": make_id(it), **it, "related": it.get("related", [])}
        existing.append(it)
        for key in keys:
            by_key[key] = it
        added += 1
    existing = dedupe(existing)
    existing.sort(key=lambda n: (n["date"], n["cat"] == "official"), reverse=True)
    return existing, added


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


def verify(item: dict) -> tuple[dict, str | None, str | None, str | None]:
    """元記事の住所・掲載日・（見出しが「...」で切れていれば）補った見出し。"""
    url = direct_url(item)
    if not url:
        return item, None, None, None
    url = article_url(url)
    try:
        page = fetch(url)
        return item, url, published_date(page), full_title(item["title"], page)
    except Exception:
        return item, url, None, None


def verify_dates(items: list[dict]) -> int:
    limit = (datetime.now(JST).date() - timedelta(days=VERIFY_DAYS)).isoformat()
    todo = [n for n in items if n.get("cat") != "official" and n.get("date", "") >= limit
            and n.get("dv", 0) < DATE_CHECK_VERSION and n.get("tries", 0) < 3][:VERIFY_MAX]
    fixed = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for item, url, real, title in ex.map(verify, todo):
            if not url:  # 元記事が分からなかったものは次回もう一度（3回まで）
                item["tries"] = item.get("tries", 0) + 1
                continue
            item["dv"] = DATE_CHECK_VERSION
            item.pop("tries", None)
            item.pop("checked", None)
            item["url"] = url  # 元記事のURLに置き換える
            if title:
                print(f"見出しを補う: {item['title'][:30]} → {title[:40]}")
                item["title"] = title
            if real and abs((datetime.fromisoformat(real) - datetime.fromisoformat(item["date"])).days) > 3:
                print(f"日付を修正: {item['date']} → {real} {item['title'][:40]}")
                item["date"] = real
                fixed += 1
    print(f"掲載日の確認 {len(todo)}件（修正 {fixed}件）")
    return fixed


def main() -> int:
    t0 = time.time()
    existing = read_news(DATA)
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
    write_news(DATA, merged, MAX_ITEMS)
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
