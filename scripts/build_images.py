"""購入記録で使う画像の住所（docs/data/piyo-images.json）を作る。生成 AI もキーも使わない。

- ぴよりんの画像: 公式サイトの「ぴよりん図鑑」（https://piyorin.com/detail/）の名前と画像。1 日に 1 回だけ読み直す。
- クッキー缶などの画像: 公式のプレスリリース（PR TIMES）の代表画像（og:image）。
  予定（events.json）の元のリリースと、ニュース（news.json）の公式・プレスリリースのクッキー缶の記事から。
  一度取った住所は覚えておき、新しいリリースだけ読む（1 回に 25 件まで）。
画像そのものはリポジトリに写さない。ページは公式のサーバーの画像をそのまま表示する。
"""
import html
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from news_store import write_json

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "piyo-images.json"
ZUKAN = "https://piyorin.com/detail/"
UA = "Mozilla/5.0 (piyorin-news-watch; +https://github.com/)"
JST = timezone(timedelta(hours=9))
MAX_PAGES = 30
MAX_RELEASES = 25
IMG_OK = re.compile(r"^https://(piyorin\.com/wp/wp-content/uploads/|prcdn\.freetls\.fastly\.net/release_image/)[^\s\"'<>]+$")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def clean(s):
    s = re.sub(r"<br\s*/?>", "", s or "")
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def key(name):
    """名前を比べる形にする（全角半角・空白をそろえる）"""
    return re.sub(r"[\s・･]", "", unicodedata.normalize("NFKC", name or "")).lower()


def parse_zukan(page):
    """図鑑の 1 ページから {name, en, img, date, tags} を取り出す"""
    out = []
    for m in re.finditer(r'<div data-mfp-src="#post-(\d+)" class="post-item"(.*?)</div>\s*<div id="post-\1"(.*?)(?=<div class="post-item-wrapper">|</main>|$)', page, re.S):
        pid, head, pop = m.group(1), m.group(2), m.group(3)
        img = re.search(r'data-src="([^"]+)"', head)
        name = re.search(r'<h3 class="post-item__ttl01">(.*?)</h3>', head, re.S)
        if not img or not name:
            continue
        en = re.search(r'<p class="post-item__en">(.*?)</p>', head, re.S)
        date = re.search(r'<p class="date">(.*?)</p>', pop, re.S)
        tags = [clean(t).lstrip("#") for t in re.findall(r"<li><span>(.*?)</span></li>", pop, re.S)]
        u = html.unescape(img.group(1))
        if not IMG_OK.match(u):
            continue
        out.append({"id": "z" + pid, "name": re.sub(r"\s+(?=[（(])", "", clean(name.group(1))), "en": clean(en.group(1)) if en else "",
                    "img": u, "date": clean(date.group(1)) if date else "", "tags": tags[:6]})
    return out


def fetch_zukan():
    items, seen = [], set()
    for n in range(1, MAX_PAGES + 1):
        url = ZUKAN if n == 1 else f"{ZUKAN}page/{n}/"
        try:
            page = get(url)
        except Exception as e:  # 404 で最後のページ
            if n == 1:
                raise
            break
        got = [x for x in parse_zukan(page) if x["id"] not in seen]
        if not got:
            break
        for x in got:
            seen.add(x["id"])
        items += got
        if f'/detail/page/{n + 1}/' not in page:
            break
    return items


def exists(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200 and (r.headers.get("Content-Type") or "").startswith("image/")
    except Exception:
        return False


THUMB_SIZES = ("300x300", "300x200", "300x236", "300x225", "300x199", "300x201", "300x194", "300x169", "300x212")


def zukan_thumb(img):
    """WordPress が作る小さい画像（一覧の札に使う）。見つからなければ元の画像"""
    m = re.match(r"^(.*?)(-\d+x\d+)?(\.(?:png|jpe?g|webp))$", img)
    if not m:
        return img
    for size in THUMB_SIZES:
        u = f"{m.group(1)}-{size}{m.group(3)}"
        if exists(u):
            return u
    return img


def og_image(page):
    m = re.search(r'<meta property="og:image" content="([^"]+)"', page)
    if not m:
        return None
    u = html.unescape(m.group(1))
    u = re.sub(r"\?.*$", "", u)  # 大きさの指定を外す（ページで ?width= を付けて小さくする）
    return u if IMG_OK.match(u) else None


def release_image_any(urls):
    """いくつかの住所を順に試す（PR TIMES を先に）"""
    seen = []
    for u in sorted([u for u in urls if u], key=lambda u: "prtimes.jp" not in u):
        if u in seen:
            continue
        seen.append(u)
        img = release_image(u)
        if img:
            return img
    return None


def release_image(url):
    """リリースの代表画像（PR TIMES の og:image）。公式のお知らせなら、中にある PR TIMES の住所から"""
    if not url:
        return None
    if "prtimes.jp/main/html/rd/p/" in url:
        return og_image(get(url))
    if re.match(r"^https://piyorin\.com/news/p\d+/?$", url):
        page = get(url)
        pr = re.search(r'href="(https://prtimes\.jp/main/html/rd/p/[0-9.]+\.html)"', page)
        if pr:
            return og_image(get(pr.group(1)))
        return None  # PR TIMES の無いお知らせは、本文の画像を取り違えやすいので使わない
    return None


def cookie_name(title):
    """クッキー缶のリリースの題名から商品名を作る（自由入力で直せる）"""
    t = unicodedata.normalize("NFKC", title or "")
    m = (re.search(r"「([^」]*(?:ver\.|版)[^」]*)」", t) or re.search(r"[（(]([^）)]*ver\.[^）)]*)[）)]", t)
         or re.search(r"に([^「」、。！!]{1,12}?ver\.)が", t) or re.search(r"に「?([^「」、。！!にの]{1,8}?(?:限定|特別)版)", t))
    if "シェ・シバタ" in t:
        n = re.search(r"第\s*([0-9０-９一二三四五]+)\s*弾", t)
        return "ぴよりんクッキー缶（シェ・シバタ" + (f" 第{n.group(1)}弾" if n else "") + "）"
    if m:
        v = m.group(1).replace("限定版", "限定").strip()
        if "クッキー缶" in v:
            return v
        return f"ひよりの手作りクッキー缶（{v}）"
    if re.search(r"秋", t) and "限定" in t:
        return "ひよりの手作りクッキー缶（秋限定）"
    return "ひよりの手作りクッキー缶"


def load(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def candidates(events, news):
    """画像を探すリリース：{key, cat, title, date, url}"""
    out = []
    by_id = {n.get("id"): n for n in news if isinstance(n, dict)} if isinstance(news, list) else {}

    def pr_links(n):
        return [r.get("url") for r in (n or {}).get("related") or [] if "prtimes.jp/main/html/rd/p/" in (r.get("url") or "")]

    for e in events if isinstance(events, list) else []:
        t = e.get("title") or ""
        if e.get("kind") not in ("sale", "release") or not e.get("url"):
            continue
        cat = "cookie" if "クッキー缶" in t else ("piyorin" if "ぴよりん" in t and e.get("kind") == "sale" else "goods")
        src = by_id.get(e.get("src"))
        out.append({"key": e.get("id"), "cat": cat, "title": t, "date": e.get("start") or "", "url": e["url"], "from": "event",
                    "alts": pr_links(src) + ([src.get("url")] if src else [])})
    for n in news if isinstance(news, list) else []:
        t = n.get("title") or ""
        if "クッキー缶" not in t or n.get("cat") not in ("official", "press"):
            continue
        url = n.get("url") or ""
        out.append({"key": n.get("id"), "cat": "cookie", "title": t, "date": n.get("date") or "", "url": url, "alts": pr_links(n),
                    "from": "news", "name": cookie_name(t)})
    return out


def main():
    now = datetime.now(JST)
    old = load(OUT, {})
    out = {"note": "購入記録の画像の住所。ぴよりんはぴよりん図鑑、クッキー缶などは公式のプレスリリースの代表画像。画像は公式のサーバーのものをそのまま表示する。",
           "zukanSource": ZUKAN, "zukanChecked": old.get("zukanChecked"), "zukan": old.get("zukan") or [],
           "releases": old.get("releases") or {}}
    # 図鑑は 1 日 1 回
    last = old.get("zukanChecked")
    if not last or (now - datetime.fromisoformat(last)) > timedelta(hours=20) or "--zukan" in sys.argv:
        try:
            z = fetch_zukan()
            if len(z) >= 10:  # 読み取りが崩れたときは前のまま
                known = {x["img"]: x["thumb"] for x in out["zukan"] if x.get("thumb") and x["thumb"] != x["img"]}
                for x in z:  # 小さい画像は一度見つけたら覚えておく
                    x["thumb"] = known.get(x["img"]) or zukan_thumb(x["img"])
                out["zukan"], out["zukanChecked"] = z, now.isoformat(timespec="seconds")
                print(f"図鑑: {len(z)} 件")
            else:
                print(f"図鑑: {len(z)} 件しか読めなかったので前のまま", file=sys.stderr)
        except Exception as e:
            print(f"図鑑を読めませんでした: {e}", file=sys.stderr)
    # リリースの代表画像（新しいものだけ）
    rel = out["releases"]
    todo = [c for c in candidates(load(DATA / "events.json", []), load(DATA / "news.json", [])) if c["key"] and c["key"] not in rel]
    todo.sort(key=lambda c: c["date"], reverse=True)
    limit = 10**6 if "--all" in sys.argv else MAX_RELEASES
    for c in todo[:limit]:
        try:
            img = release_image_any([c["url"], *c.get("alts", [])])
        except Exception as e:
            print(f"リリースを読めませんでした {c['url']}: {e}", file=sys.stderr)
            continue  # 次の更新でもう一度
        entry = {"cat": c["cat"], "title": c["title"][:120], "date": c["date"], "url": c["url"], "img": img, "from": c["from"]}
        if c.get("name"):
            entry["name"] = c["name"]
        rel[c["key"]] = entry
    print(f"リリース: {sum(1 for v in rel.values() if v.get('img'))} 件に画像（新しく {min(len(todo), limit)} 件を読んだ）")
    write_json(OUT, out)


if __name__ == "__main__":
    main()
