#!/usr/bin/env python3
"""削除から学ぶ（2026-11-23）：画面で「関係ない記事」として削除した記録を集め、学習の帳面 docs/data/learn.json に書く。

- 削除の記録は、ブックマークの同期と同じ secret gist の piyorin-hidden.json（{v, updated, items:{記事ID:{t, on}}}）。
  Mac の定期の更新（scripts/update_local.py）が、ログイン済みの gh で読む。GitHub Actions は gist を読めないので何もしない。
- on:true（削除）は「関係ない」の例、on:false（元に戻した）は「関係ある」の例。
- 記事は 500 件を越えると archive へ出たり統合されたりするので、帳面に題・掲載元・URL を写しておく（前の帳面の例も残す）。
- 帳面は画面（docs/piyo-learn.js）が似た記事を隠すのに使い、scripts/judge_relevance.py が Claude の判定の例に使う。
- 読めないとき（gh が無い・同期を設定していない・通信できない）は、前の帳面をそのまま残して終える（失敗にしない）。

試し：PIYO_HIDDEN_JSON=<ファイル> で gist の代わりにファイルを読む。PIYO_GIST=<id> で gist を決める。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
LEARN_FILE = DATA / "learn.json"
HIDDEN = "piyorin-hidden.json"
MAX_DEL = 300   # 帳面に残す「関係ない」の例の数（新しい順）
MAX_KEEP = 150  # 「関係ある」の例の数


def gh_json(path: str):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=40)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip()[:200])
    return json.loads(r.stdout)


def read_records() -> dict | None:
    """削除の記録 {記事ID:{t, on}} を返す。読めなければ None。"""
    path = os.environ.get("PIYO_HIDDEN_JSON")
    try:
        if path:
            raw = Path(path).read_text(encoding="utf-8")
        else:
            gid = os.environ.get("PIYO_GIST", "").strip()
            if not gid:
                for page in range(1, 11):
                    lst = gh_json(f"/gists?per_page=100&page={page}")
                    hit = next((g for g in lst if HIDDEN in (g.get("files") or {})), None)
                    if hit:
                        gid = hit["id"]
                        break
                    if len(lst) < 100:
                        break
            if not gid:
                print("削除から学ぶ: 同期の gist が見つかりません（画面で同期を設定すると使えます）")
                return None
            f = (gh_json(f"/gists/{gid}").get("files") or {}).get(HIDDEN) or {}
            raw = f.get("content") or "{}"
            if f.get("truncated") and f.get("raw_url"):
                r = subprocess.run(["gh", "api", f["raw_url"]], capture_output=True, text=True, timeout=40)
                raw = r.stdout if not r.returncode else raw
        items = (json.loads(raw) or {}).get("items")
    except (OSError, ValueError, RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"削除から学ぶ: 削除の記録を読めません（{e}）。前の帳面のまま使います")
        return None
    if not isinstance(items, dict):
        return {}
    return {k: v for k, v in items.items()
            if isinstance(v, dict) and isinstance(v.get("on"), bool) and isinstance(v.get("t"), (int, float))}


def all_news() -> list[dict]:
    out = []
    files = [DATA / "news.json", *sorted((DATA / "archive").glob("*.json"))]
    for f in files:
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out += j if isinstance(j, list) else (j.get("news") or j.get("items") or [] if isinstance(j, dict) else [])
    return [n for n in out if isinstance(n, dict) and n.get("id")]


def build(records: dict, news: list[dict], old: dict) -> dict:
    by_id: dict[str, dict] = {}
    for n in news:
        for i in [n["id"], *(n.get("merged_ids") or [])]:
            by_id.setdefault(i, n)
    # 前の帳面の例（記事が消えていても題が分かる）
    known = {}
    for kind in ("del", "keep"):
        for e in old.get(kind) or []:
            if isinstance(e, dict) and e.get("id") and e.get("title"):
                known[e["id"]] = dict(e, on=(kind == "del"))
    # 記事ごとに、いちばん新しい操作を使う（統合された ID もまとめる）
    latest: dict[str, dict] = {}
    for rid, r in records.items():
        n = by_id.get(rid)
        if n is not None and n.get("cat") == "official":
            continue
        k = known.get(rid)
        if n is None and k is None:
            continue  # 題が分からない記録は使わない
        key = n["id"] if n else rid
        e = {"id": key, "title": (n or k)["title"], "source": (n or k).get("source", ""),
             "url": (n or k).get("url", ""), "t": int(r["t"]), "on": r["on"]}
        if key not in latest or latest[key]["t"] < e["t"]:
            latest[key] = e
    # 同期先から消えた古い例も残す（画面は 90 日たった記録を消すため）
    for rid, e in known.items():
        n = by_id.get(rid)
        key = n["id"] if n else rid
        if key not in latest and rid not in records:
            latest[key] = e
    rows = sorted(latest.values(), key=lambda e: -e["t"])
    strip = lambda e: {k: e[k] for k in ("id", "title", "source", "url", "t")}  # noqa: E731
    return {"v": 1,
            "del": [strip(e) for e in rows if e["on"]][:MAX_DEL],
            "keep": [strip(e) for e in rows if not e["on"]][:MAX_KEEP]}


def main() -> int:
    records = read_records()
    if records is None:
        return 0
    try:
        old = json.loads(LEARN_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = {}
    new = build(records, all_news(), old if isinstance(old, dict) else {})
    if {k: new[k] for k in ("del", "keep")} == {k: old.get(k) for k in ("del", "keep")}:
        print(f"削除から学ぶ: 変わりなし（関係ない {len(new['del'])} 件・関係ある {len(new['keep'])} 件）")
        return 0
    new["updated"] = datetime.now(JST).isoformat(timespec="seconds")
    LEARN_FILE.write_text(json.dumps(new, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"削除から学ぶ: 帳面を更新（関係ない {len(new['del'])} 件・関係ある {len(new['keep'])} 件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
