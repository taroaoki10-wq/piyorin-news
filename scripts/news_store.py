"""最新記事と年別保管庫。記事ID・判定結果・関連リンクをそのまま保存する。"""
import json
import re
from pathlib import Path


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
