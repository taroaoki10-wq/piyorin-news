"""最新記事と年別保管庫。記事ID・判定結果・関連リンクをそのまま保存する。"""
import html
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

# 本文が読める一次情報（公式サイトのお知らせ・PR TIMES のプレスリリース・公式 X の投稿）
SOURCE_RE = re.compile(r"https://(?:piyorin\.com/news/p\d+/?|prtimes\.jp/main/html/rd/p/\d+\.\d+\.html"
                       r"|x\.com/piyorin_nagoya/status/\d+)")
# 公式 X（@piyorin_nagoya）の投稿。店舗限定の新作（ミルクティーぴよりんなど）は公式サイトに載らず X だけで知らせることがある。
# x.com のページはログインが要るので、埋め込み用の投稿データ（JSON）を読む
X_STATUS = re.compile(r"https://(?:x|twitter)\.com/piyorin_nagoya/status/(\d+)")
X_DATA = "https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=ja&token={token}"
# 丸数字（①〜⑳・㉑〜㊿など）。NFKC では「1」になり、すぐ後ろの数字とつながって「①10:00」が「110:00」になる
CIRCLED_NUM = re.compile("([\u2460-\u2473\u24ea-\u24ff\u3251-\u325f\u32b1-\u32bf])")
# MSN の記事。ページには中身が無く（ページが記事データを読み込んで出す）、そのまま読むと題名が「MSN」だけで空になる
MSN_ARTICLE = re.compile(r"https://www\.msn\.com/([a-z]{2}-[a-z]{2})/.*/ar-([A-Za-z0-9]+)")
JST = timezone(timedelta(hours=9))


def nfkc(text: str) -> str:
    """全角の英数字・記号を NFKC でそろえる。丸数字だけはそのまま残す。"""
    return "".join(p if CIRCLED_NUM.fullmatch(p) else unicodedata.normalize("NFKC", p) for p in CIRCLED_NUM.split(text))


def ascii_url(url: str) -> str:
    """住所に日本語や空白が入っていても読めるように、その部分だけ %XX に書き直す（もとからある %XX や記号はそのまま）。
    urllib は ASCII の住所しか送れず、MSN の記事（/news/other/ぴよりんがゴジラになった-…/）を「'ascii' codec」で読めなかった。"""
    if url.isascii() and not re.search(r"[\x00-\x20\x7f]", url):
        return url
    p = urlsplit(url.strip())
    host = p.netloc if p.netloc.isascii() else p.netloc.encode("idna").decode("ascii")
    safe = "/?%:@!$&'()*+,;=~"
    return urlunsplit((p.scheme, host, quote(p.path, safe=safe), quote(p.query, safe=safe), quote(p.fragment, safe=safe)))


def x_token(tweet_id: str) -> str:
    """埋め込み用の投稿データの token（X の埋め込みのスクリプトと同じ求め方：id / 1e15 * π を 36 進で書き、0 と小数点を外す）。"""
    v = int(tweet_id) / 1e15 * 3.141592653589793
    whole, frac = int(v), v - int(v)
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while whole:
        whole, r = divmod(whole, 36)
        out = digits[r] + out
    out = (out or "0") + "."
    for _ in range(12):
        frac *= 36
        out += digits[int(frac)]
        frac -= int(frac)
    return re.sub(r"0+|\.", "", out) or "0"


def x_posted(tweet_id: str) -> datetime:
    """投稿の番号に入っている投稿の時刻（読まずに新しさが分かる）。"""
    return datetime.fromtimestamp(((int(tweet_id) >> 22) + 1288834974657) / 1000, JST)


def x_text(text: str) -> str:
    """投稿の文から、t.co の住所とハッシュタグの「#」を外す。"""
    t = re.sub(r"https?://t\.co/\S+", "", text or "")
    t = re.sub(r"[#＃](?=\S)", "", t)
    return re.sub(r"[ \t　]+", " ", t).strip()


def request_url(url: str) -> str:
    """記事を読むときに送る住所。MSN の記事は、ページが読み込むのと同じ記事データ（JSON）の住所にする。
    公式 X の投稿は、埋め込み用の投稿データ（JSON）の住所にする。"""
    m = MSN_ARTICLE.match(url)
    if m:
        return f"https://assets.msn.com/content/view/v2/Detail/{m.group(1)}/{m.group(2)}"
    m = X_STATUS.match(url)
    if m:
        return X_DATA.format(id=m.group(1), token=x_token(m.group(1)))
    return ascii_url(url)


def x_page(text: str) -> str:
    """公式 X の投稿データを、ふつうの記事のページと同じ形（題名・公開日・本文）にする。"""
    d = json.loads(text)
    body = x_text(d.get("text") or "")
    try:
        published = datetime.fromisoformat(str(d.get("created_at") or "").replace("Z", "+00:00")).astimezone(JST).isoformat()
    except ValueError:
        published = ""
    title = x_title(body)
    metas = "".join(f'<meta property="{k}" content="{html.escape(v)}">' for k, v in (
        ("og:title", title), ("article:published_time", published)) if v)
    lines = "".join(f"<p>{html.escape(ln.strip())}</p>" for ln in body.split("\n") if ln.strip())
    return f"<html><head><title>{html.escape(title)}</title>{metas}</head><body><article>{lines}</article></body></html>"


# 見出しだけの行（「【お知らせ📢】」「＼新商品のお知らせ⛄／」）。この行だけでは何の話か分からないので次の行も使う
X_HEAD_ONLY = re.compile(r"^[【＼\\⋱][^】／/⋰]{0,24}[】／/⋰]$")
# 日付だけの行（「📅11月15日（日）～11月23日（月・祝）」）
X_DATE_ONLY = re.compile(r"^[^\w]*[\d０-９/／.年月日()（）・〜～~\-\s月火水木金土日祝]+$")


def x_title(body: str) -> str:
    """投稿の文からニュースの見出しを作る（最初の行。見出しだけの行なら次の行もつなぐ。長ければ 100 字で切る）。"""
    lines = [ln.strip() for ln in (body or "").split("\n") if ln.strip()]
    if not lines:
        return ""
    title, last, k = lines[0], lines[0], 1
    # 見出しだけ・短い・日付だけの行で終わっているうちは、次の行をつなぐ（3 行まで）
    while k < min(3, len(lines)) and (X_HEAD_ONLY.match(last) or len(last) < 12 or X_DATE_ONLY.match(last)):
        last = lines[k]
        title += " " + last
        k += 1
    return title[:100]


def page_html(url: str, text: str) -> str:
    """MSN の記事データを、ふつうの記事のページと同じ形（題名・説明文・画像・公開日・本文）にする。
    公式 X の投稿データも同じ形にする。ほかはそのまま返す。"""
    if X_STATUS.match(url):
        return x_page(text)
    if not MSN_ARTICLE.match(url):
        return text
    d = json.loads(text)
    title = d.get("title") or ""
    image = next((i["url"] for i in d.get("imageResources") or [] if str(i.get("url", "")).startswith("https://")), "")
    try:
        published = datetime.fromisoformat(str(d.get("publishedDateTime") or "").replace("Z", "+00:00")).astimezone(JST).isoformat()
    except ValueError:
        published = ""
    metas = "".join(f'<meta property="{k}" content="{html.escape(v)}">' for k, v in (
        ("og:title", title), ("og:description", d.get("abstract") or ""), ("og:image", image),
        ("article:published_time", published)) if v)
    return (f"<html><head><title>{html.escape(title)}</title>{metas}</head>"
            f"<body><article><h1>{html.escape(title)}</h1>{d.get('body') or ''}</article></body></html>")


def primary_sources(item: dict) -> list[str]:
    """記事と、同じ話題としてまとめた記事のうち、公式サイトと PR TIMES のURL（代表の記事を先に）。
    公式 X の投稿は、その投稿自身が代表の記事のときだけ読む。公式サイトの記事にまとめた X の投稿は表示だけ
    （まとめるたびに読んだ元の組み合わせが変わり、読み直して予定が入れ替わらないように）。"""
    urls = [item.get("url", "")] + [r.get("url", "") for r in item.get("related", [])
                                    if not X_STATUS.match(r.get("url", ""))]
    return [u for u in dict.fromkeys(urls) if u and SOURCE_RE.fullmatch(u)]


def linked_sources(text: str) -> list[str]:
    """本文に書かれた公式サイト・PR TIMES のURL（公式の記事が「詳しくは下記URL」とする場合）。"""
    return list(dict.fromkeys(m.group(0) for m in SOURCE_RE.finditer(text)))


def read_news(data: Path) -> list[dict]:
    index = data / "archive" / "index.json"
    archived = []
    if not index.exists() and any(index.parent.glob("*.json")):
        raise FileNotFoundError("年別記事があるのに保管庫の一覧がありません")
    if index.exists():
        for year in json.loads(index.read_text(encoding="utf-8"))["years"]:
            if not re.fullmatch(r"\d{4}|unknown", year):
                raise ValueError("保管庫の年が不正です")
            # 壊れた保管庫を空として扱うと消失するため、失敗時は更新を止める。
            for item in json.loads((index.parent / f"{year}.json").read_text(encoding="utf-8")):
                archived.append(item)
    current = data / "news.json"
    latest = json.loads(current.read_text(encoding="utf-8")) if current.exists() else []
    current_keys = {(item["id"], item["title"]) for item in latest}
    # 同一ファイル内の重複整理は収集側で行う。保管処理では記事を黙って捨てない。
    return [item for item in archived if (item["id"], item["title"]) not in current_keys] + latest


def write_json(path: Path, value) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=1) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".json.tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(path)


def write_news(data: Path, articles: list[dict], limit: int = 500) -> None:
    ordered = sorted(articles, key=lambda n: (n["date"], n["cat"] == "official"), reverse=True)
    years = {}
    for item in ordered[limit:]:
        year = item.get("date", "")[:4]
        if not re.fullmatch(r"\d{4}", year):
            year = "unknown"
        years.setdefault(year, []).append(item)
    archive = data / "archive"
    for year, items in years.items():
        write_json(archive / f"{year}.json", items)
    # 保管を先に書き、最新500件への切り詰めは最後に行う。
    write_json(archive / "index.json", {"years": sorted(years, reverse=True), "count": sum(map(len, years.values()))})
    write_json(data / "news.json", ordered[:limit])
    for path in archive.glob("*.json"):
        if path.stem != "index" and path.stem not in years:
            path.unlink()
