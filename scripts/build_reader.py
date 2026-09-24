#!/usr/bin/env python3
"""カレンダーの予定の元記事を読み、ページ内のリーダーで表示できるように
docs/data/articles.json に本文を保存する。

- 予定（events.json）から参照されている記事だけを対象にする
- 一度保存した記事は読み直さない（予定から外れた記事は削除）
- 取得はすべて同時に行う
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
EVENTS_FILE = DATA / "events.json"
NEWS_FILE = DATA / "news.json"
READER_FILE = DATA / "articles.json"
UA = "Mozilla/5.0 (piyorin-news-watch; +https://github.com/)"
MAX_BLOCKS = 120
STOP_WORDS = ("一覧に戻る", "お知らせ一覧", "一覧へ戻る", "BACK TO", "関連記事", "SHARE", "シェアする")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", errors="replace")


def clean(s: str) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    return unicodedata.normalize("NFKC", re.sub(r"[ \t　\r\n]+", " ", s)).strip()


def meta(page: str, prop: str) -> str:
    m = re.search(r'<meta[^>]+(?:property|name)="' + re.escape(prop) + r'"[^>]+content="([^"]*)"', page, re.I) \
        or re.search(r'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + re.escape(prop) + r'"', page, re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def parse(url: str, page: str) -> dict:
    """本文を見出し・段落・箇条書き・画像のブロックに分ける。"""
    title = meta(page, "og:title") or clean((re.search(r"<title>(.*?)</title>", page, re.S | re.I) or [None, ""])[1])
    image = meta(page, "og:image")
    m = re.search(r"<article\b.*?</article>", page, re.S | re.I) or re.search(r"<main\b.*?</main>", page, re.S | re.I)
    body = m.group(0) if m else page
    body = re.sub(r"<(script|style|noscript|nav|header|footer|form|aside|svg)\b.*?</\1>", " ", body, flags=re.S | re.I)
    tokens = re.split(r"(<h[1-4]\b[^>]*>.*?</h[1-4]>|<img\b[^>]*>|<li\b[^>]*>.*?</li>|<br\s*/?>|</?(?:p|div|tr|dt|dd|th|td|section|table|figure)\b[^>]*>)",
                      body, flags=re.S | re.I)
    blocks, seen_img = [], set()
    for t in tokens:
        if not t or not t.strip():
            continue
        low = t[:4].lower()
        if low.startswith("<h"):
            text = clean(t)
            if text and text != title:
                blocks.append({"t": "h", "x": text[:120]})
        elif low.startswith("<img"):
            src = re.search(r'\s(?:data-src|src)="([^"]+)"', t)
            if src:
                u = urljoin(url, html.unescape(src.group(1)))
                if u.startswith("https://") and u not in seen_img and not re.search(r"logo|icon|sprite|\.svg", u, re.I):
                    seen_img.add(u)
                    blocks.append({"t": "img", "x": u})
        elif low.startswith("<li"):
            text = clean(t)
            if text:
                blocks.append({"t": "li", "x": text[:400]})
        elif re.fullmatch(r"\s*<[^>]+>\s*", t):
            continue
        else:
            text = clean(t)
            if len(text) >= 2:
                if any(w in text for w in STOP_WORDS) and len(text) < 30:
                    break
                blocks.append({"t": "p", "x": text[:600]})
        if len(blocks) >= MAX_BLOCKS:
            break
    # 同じ文が続けて出る場合は1つにする
    out = []
    for b in blocks:
        if not out or out[-1] != b:
            out.append(b)
    if image and image not in seen_img:
        out.insert(0, {"t": "img", "x": image})
    return {"title": title, "url": url, "blocks": out}


def main() -> int:
    t0 = time.time()
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8")) if EVENTS_FILE.exists() else []
    news = json.loads(NEWS_FILE.read_text(encoding="utf-8")) if NEWS_FILE.exists() else []
    dates = {n["url"]: n.get("date", "") for n in news}
    store = json.loads(READER_FILE.read_text(encoding="utf-8")) if READER_FILE.exists() else {}
    wanted = {e["url"] for e in events if e.get("url", "").startswith("https://")}
    store = {u: v for u, v in store.items() if u in wanted}
    todo = sorted(u for u in wanted if u not in store)

    def load(u):
        try:
            return u, parse(u, fetch(u)), None
        except Exception as e:
            return u, None, e

    with ThreadPoolExecutor(max_workers=8) as ex:
        for u, art, err in ex.map(load, todo):
            if err:
                print(f"読み取り失敗 {u}: {err}", file=sys.stderr)
                continue
            art["date"] = dates.get(u, "")
            store[u] = art
            print(f"保存: {art['title'][:40]}（{len(art['blocks'])}ブロック）")

    before = READER_FILE.read_text(encoding="utf-8") if READER_FILE.exists() else ""
    after = json.dumps(store, ensure_ascii=False, separators=(",", ":")) + "\n"
    if after != before:
        READER_FILE.write_text(after, encoding="utf-8")
    print(f"リーダー用の記事 {len(store)}件（新規 {len(todo)}件、{time.time() - t0:.1f}秒）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
