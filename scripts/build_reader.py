#!/usr/bin/env python3
"""ページ内のリーダーで表示するために、記事の本文を docs/data/reader/ に保存する。

- 対象：カレンダーの予定の元記事と、直近の記事（公式・プレスリリース・メディア）
- 公式サイト・プレスリリース・予定の告知ページは本文を保存する
- メディア（新聞社など）の記事は、掲載元が用意した要約（説明文と画像）だけを保存する
- 1記事1ファイル（URLのSHA-1の先頭12桁.json）。ページは開いたときだけ読み込む
- 一度保存した記事は読み直さない（対象から外れた記事は削除）。取得はすべて同時に行う
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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
EVENTS_FILE = DATA / "events.json"
NEWS_FILE = DATA / "news.json"
READER_DIR = DATA / "reader"
OLD_FILE = DATA / "articles.json"
JST = timezone(timedelta(hours=9))
NEWS_DAYS = 45    # この日数以内の記事を対象にする
NEWS_MAX = 120    # 記事の最大数
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


def reader_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def summary(url: str, page: str) -> dict:
    """掲載元が用意した説明文と画像だけを使う（記事本文は保存しない）。"""
    title = meta(page, "og:title") or clean((re.search(r"<title>(.*?)</title>", page, re.S | re.I) or [None, ""])[1])
    desc = meta(page, "og:description") or meta(page, "description")
    image = meta(page, "og:image")
    blocks = []
    if image.startswith("https://"):
        blocks.append({"t": "img", "x": image})
    if desc:
        blocks.append({"t": "p", "x": clean(desc)[:400]})
    return {"title": title, "url": url, "mode": "summary", "blocks": blocks}


def main() -> int:
    t0 = time.time()
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8")) if EVENTS_FILE.exists() else []
    news = json.loads(NEWS_FILE.read_text(encoding="utf-8")) if NEWS_FILE.exists() else []
    limit = (datetime.now(JST).date() - timedelta(days=NEWS_DAYS)).isoformat()

    targets: dict[str, tuple[str, str]] = {}  # url -> (mode, date)
    for e in events:
        if e.get("url", "").startswith("https://"):
            targets[e["url"]] = ("full", "")
    recent = [n for n in news if n.get("date", "") >= limit][:NEWS_MAX]
    for n in recent:
        for u, cat in [(n["url"], n.get("cat"))] + [(r["url"], "media") for r in n.get("related", [])]:
            if not u.startswith("https://") or "news.google.com" in u or u in targets:
                continue
            mode = "full" if cat in ("official", "press") or "piyorin.com" in u or "prtimes.jp" in u else "summary"
            targets[u] = (mode, n.get("date", ""))

    READER_DIR.mkdir(parents=True, exist_ok=True)
    wanted = {reader_id(u) + ".json" for u in targets}
    removed = 0
    for f in READER_DIR.glob("*.json"):
        if f.name not in wanted:
            f.unlink()
            removed += 1
    if OLD_FILE.exists():
        OLD_FILE.unlink()  # 以前の1ファイル方式の名残を消す
    todo = [u for u in targets if not (READER_DIR / (reader_id(u) + ".json")).exists()]

    def load(u):
        try:
            page = fetch(u)
            mode, date = targets[u]
            art = parse(u, page) if mode == "full" else summary(u, page)
            art["mode"] = mode
            art["date"] = date
            return u, art, None
        except Exception as e:
            return u, None, e

    saved = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for u, art, err in ex.map(load, todo):
            if err:
                print(f"読み取り失敗 {u}: {err}", file=sys.stderr)
                continue
            (READER_DIR / (reader_id(u) + ".json")).write_text(
                json.dumps(art, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            saved += 1
    print(f"リーダー用の記事 {len(targets)}件（新規 {saved}件・削除 {removed}件、{time.time() - t0:.1f}秒）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
