"""最新記事と年別保管庫。記事ID・判定結果・関連リンクをそのまま保存する。"""
import json
import re
import unicodedata
from pathlib import Path

# 本文が読める一次情報（公式サイトのお知らせ・PR TIMES のプレスリリース）
SOURCE_RE = re.compile(r"https://(?:piyorin\.com/news/p\d+/?|prtimes\.jp/main/html/rd/p/\d+\.\d+\.html)")
# 丸数字（①〜⑳・㉑〜㊿など）。NFKC では「1」になり、すぐ後ろの数字とつながって「①10:00」が「110:00」になる
CIRCLED_NUM = re.compile("([\u2460-\u2473\u24ea-\u24ff\u3251-\u325f\u32b1-\u32bf])")


def nfkc(text: str) -> str:
    """全角の英数字・記号を NFKC でそろえる。丸数字だけはそのまま残す。"""
    return "".join(p if CIRCLED_NUM.fullmatch(p) else unicodedata.normalize("NFKC", p) for p in CIRCLED_NUM.split(text))


def primary_sources(item: dict) -> list[str]:
    """記事と、同じ話題としてまとめた記事のうち、公式サイトと PR TIMES のURL（代表の記事を先に）。"""
    urls = [item.get("url", "")] + [r.get("url", "") for r in item.get("related", [])]
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
