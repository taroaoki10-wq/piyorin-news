#!/usr/bin/env python3
"""これからの予定を、iPhone のカレンダーに入れるファイル（.ics）にして docs/data/ics/ に置く。

- 予定ごとに、知らせる時の違うファイルを作る（eve＝前の日の夜20時・morning＝当日の朝9時・hour＝始まる1時間前・none＝知らせない）
  iPhone はサイトに置いたファイルを開くと「カレンダーに追加」を出す（ページの中で作ったファイルより確か）
- 時刻は、ぴよメモに「10月30日12時から」のように日付のすぐ後ろに書いてあるときだけ使う（無ければ終日の予定）
  1日だけの予定は、その時刻から1時間の予定にする。何日も続く予定は終日のまま、知らせる時だけ時刻に合わせる
- 一覧（index.json）に、予定ごとのファイルの名前・時刻・選べる知らせ方を書く。ページはこれを見てボタンを出す
- 終わった予定のファイルは消す。中身が変わらなければ書き直さない（毎回の更新で差分を出さない）
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "ics"
JST = timezone(timedelta(hours=9))


def start_time(event: dict, memos: dict) -> str | None:
    """ぴよメモに、予定の始まる日のすぐ後ろに書いてある時刻（'HH:MM'）。"""
    memo = (memos.get(event.get("src") or "") or {}).get("memo", "")
    d = date.fromisoformat(event["start"])
    t = unicodedata.normalize("NFKC", memo)
    m = re.search(rf"(?<!\d){d.month}月{d.day}日(?:\s*[(（][^)）]{{1,4}}[)）])?\s*(\d{{1,2}})(?:時(?:(\d{{1,2}})分)?|:(\d{{2}}))", t)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2) or m.group(3) or 0)
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None


def safe_name(event_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", event_id)


def alarms_for(time: str | None, timed: bool) -> list[str]:
    """選べる知らせ方。当日の朝9時は、9時より前に始まる時刻つきの予定には出さない。"""
    out = ["eve"]
    if not (timed and time and time < "09:00"):
        out.append("morning")
    if time:
        out.append("hour")
    return out + ["none"]


def trigger(alarm: str, time: str | None, timed: bool) -> str | None:
    """予定の始まり（終日の予定はその日の0時）からの、知らせる時のずれ。"""
    minutes = int(time[:2]) * 60 + int(time[3:]) if time else 0
    if timed:  # 始まりは time
        delta = {"eve": -(minutes + 240), "morning": -(minutes - 540), "hour": -60}.get(alarm)
    else:  # 始まりはその日の0時（終日の予定）
        delta = {"eve": -240, "morning": 540, "hour": minutes - 60}.get(alarm)
    if delta is None:
        return None
    return ("-" if delta < 0 else "") + f"PT{abs(delta)}M"


def ics_text(event: dict, time: str | None, alarm: str) -> str:
    esc = lambda s: str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

    def fold(line: str) -> str:  # 1行は75バイトまで。日本語の文字の途中で切らない
        out, cur, size = [], "", 0
        for ch in line:
            n = len(ch.encode("utf-8"))
            if size + n > (74 if out else 75):
                out.append(cur)
                cur, size = "", 0
            cur += ch
            size += n
        out.append(cur)
        return "\r\n ".join(out)

    start, end = event["start"], event.get("end") or event["start"]
    timed = bool(time) and end == start
    # 時刻は日本時間で書く（世界の時刻で書くと、iPhone の画面に「3:00–4:00 (GMT)」も並んで出た）
    jst = lambda d: d.strftime("%Y%m%dT%H%M%S")
    zone = ["BEGIN:VTIMEZONE", "TZID:Asia/Tokyo", "BEGIN:STANDARD", "DTSTART:19700101T000000",
            "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:JST", "END:STANDARD", "END:VTIMEZONE"]
    if timed:
        begin = datetime.fromisoformat(f"{start}T{time}:00")
        when = [f"DTSTART;TZID=Asia/Tokyo:{jst(begin)}", f"DTEND;TZID=Asia/Tokyo:{jst(begin + timedelta(hours=1))}"]
    else:
        when = [f"DTSTART;VALUE=DATE:{start.replace('-', '')}",
                f"DTEND;VALUE=DATE:{(date.fromisoformat(end) + timedelta(days=1)).isoformat().replace('-', '')}"]
    url = event.get("url") if re.match(r"https?://", event.get("url") or "") else ""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//piyorin-news//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             *(zone if timed else []), "BEGIN:VEVENT", f"UID:{safe_name(event.get('id') or start + event['title'])}@piyorin-news",
             f"DTSTAMP:{start.replace('-', '')}T000000Z",  # 毎回同じ中身にする（更新のたびに差分を出さない）
             *when, f"SUMMARY:{esc(event['title'])}",
             *([f"LOCATION:{esc(event['place'])}"] if event.get("place") else []), *([f"URL:{url}"] if url else []),
             f"DESCRIPTION:{esc('ぴよりんニュースより' + (chr(10) + url if url else ''))}"]
    t = trigger(alarm, time, timed)
    if t:
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{esc(event['title'])}", f"TRIGGER:{t}", "END:VALARM"]
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(fold(x) for x in lines) + "\r\n"


def build(events: list[dict], memos: dict, today: date, out: Path) -> tuple[dict, int, int]:
    """(一覧, 書いたファイルの数, 消したファイルの数)"""
    out.mkdir(parents=True, exist_ok=True)
    index, wanted, written = {}, set(), 0
    for e in events:
        if not (e.get("id") and e.get("start") and e.get("title")) or (e.get("end") or e["start"]) < today.isoformat():
            continue
        time = start_time(e, memos)
        timed = bool(time) and (e.get("end") or e["start"]) == e["start"]
        name, alarms = safe_name(e["id"]), alarms_for(time, timed)
        for a in alarms:
            f = out / f"{name}-{a}.ics"
            text = ics_text(e, time, a)
            wanted.add(f.name)
            if not f.exists() or f.read_bytes() != text.encode("utf-8"):
                f.write_bytes(text.encode("utf-8"))
                written += 1
        index[e["id"]] = {"f": name, "time": time or "", "timed": timed, "alarms": alarms}
    removed = 0
    for f in out.glob("*.ics"):
        if f.name not in wanted:
            f.unlink()
            removed += 1
    text = json.dumps(index, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    p = out / "index.json"
    if not p.exists() or p.read_text(encoding="utf-8") != text:
        p.write_text(text, encoding="utf-8")
    return index, written, removed


def main() -> int:
    events = json.loads((DATA / "events.json").read_text(encoding="utf-8"))
    memo_file = DATA / "piyo-memo.json"
    memos = json.loads(memo_file.read_text(encoding="utf-8")) if memo_file.exists() else {}
    index, written, removed = build(events, memos, datetime.now(JST).date(), OUT)
    timed = sum(1 for v in index.values() if v["time"])
    print(f"カレンダーのファイル: 予定 {len(index)}件（時刻つき {timed}件）、書き直し {written}・削除 {removed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
