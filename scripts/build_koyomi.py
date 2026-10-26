"""暦のデータ（docs/data/koyomi.json）を作る。生成 AI もキーも使わない。

- 祝日: 内閣府「国民の祝日」の CSV（公共データ利用規約 第1.0版。出典を表示して使う）。
  取れなかったときは前の koyomi.json の祝日をそのまま使う。
- 二十四節気・月の満ち欠け: 太陽と月の位置を計算して求める（Meeus『Astronomical Algorithms』の略算式。
  誤差は数分ほど。日付の境目の近くでは国立天文台の暦と1日ずれることがある）。
- 連休: 土日と祝日が3日以上続くところ。年末年始などの会社の休みは入れない。
"""
import csv
import io
import json
import math
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from news_store import write_json

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "koyomi.json"
HOLIDAY_CSV = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv"
JST = timezone(timedelta(hours=9))
DELTA_T = 69 / 86400  # 地球時と協定世界時の差（日）。数分の精度には十分
BEFORE, AFTER = 7, 400  # 今日の前後に作る日数

SEKKI = ["春分", "清明", "穀雨", "立夏", "小満", "芒種", "夏至", "小暑", "大暑", "立秋", "処暑", "白露",
         "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至", "小寒", "大寒", "立春", "雨水", "啓蟄"]
PHASES = ["新月", "上弦の月", "満月", "下弦の月"]

# 月の黄経の主な項（係数は 1e-6 度。D, M, M', F の倍数、E を掛けるか）
MOON_TERMS = [
    (6288774, 0, 0, 1, 0), (1274027, 2, 0, -1, 0), (658314, 2, 0, 0, 0), (213618, 0, 0, 2, 0),
    (-185116, 0, 1, 0, 0), (-114332, 0, 0, 0, 2), (58793, 2, 0, -2, 0), (57066, 2, -1, -1, 0),
    (53322, 2, 0, 1, 0), (45758, 2, -1, 0, 0), (-40923, 0, 1, -1, 0), (-34720, 1, 0, 0, 0),
    (-30383, 0, 1, 1, 0), (15327, 2, 0, 0, -2), (-12528, 0, 0, 1, 2), (10980, 0, 0, 1, -2),
    (10675, 4, 0, -1, 0), (10034, 0, 0, 3, 0), (8548, 4, 0, -2, 0), (-7888, 2, 1, -1, 0),
    (-6766, 2, 1, 0, 0), (-5163, 1, 0, -1, 0), (4987, 1, 1, 0, 0), (4036, 2, -1, 1, 0),
]


def julian_tt(t: datetime) -> float:
    return t.timestamp() / 86400 + 2440587.5 + DELTA_T


def sun_longitude(jd: float) -> float:
    """太陽の視黄経（度）"""
    T = (jd - 2451545) / 36525
    L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
    M = math.radians(357.52911 + 35999.05029 * T - 0.0001537 * T * T)
    C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * math.sin(M)
         + (0.019993 - 0.000101 * T) * math.sin(2 * M) + 0.000289 * math.sin(3 * M))
    omega = math.radians(125.04 - 1934.136 * T)
    return (L0 + C - 0.00569 - 0.00478 * math.sin(omega)) % 360


def moon_longitude(jd: float) -> float:
    """月の黄経（度。章動は太陽と打ち消し合うので、太陽の章動の分だけ合わせる）"""
    T = (jd - 2451545) / 36525
    Lp = 218.3164477 + 481267.88123421 * T
    D = math.radians(297.8501921 + 445267.1114034 * T)
    M = math.radians(357.5291092 + 35999.0502909 * T)
    Mp = math.radians(134.9633964 + 477198.8675055 * T)
    F = math.radians(93.2720950 + 483202.0175233 * T)
    E = 1 - 0.002516 * T
    s = 0.0
    for c, d, m, mp, f in MOON_TERMS:
        s += c * E ** abs(m) * math.sin(d * D + m * M + mp * Mp + f * F)
    omega = math.radians(125.04 - 1934.136 * T)
    return (Lp + s / 1e6 - 0.00478 * math.sin(omega)) % 360


def crossings(start: datetime, end: datetime, angle, step_deg: float):
    """angle(jd) が step_deg の倍数を通る時刻を、(番号, 時刻) で返す"""
    out = []
    t, step = start, timedelta(hours=6)
    prev = angle(julian_tt(t)) // step_deg
    while t < end:
        n = t + step
        cur = angle(julian_tt(n)) // step_deg
        if cur != prev:
            lo, hi = t, n
            while hi - lo > timedelta(seconds=20):
                mid = lo + (hi - lo) / 2
                if angle(julian_tt(mid)) // step_deg == prev:
                    lo = mid
                else:
                    hi = mid
            out.append((int(cur) % round(360 / step_deg), hi))
        t, prev = n, cur
    return out


def elongation(jd: float) -> float:
    return (moon_longitude(jd) - sun_longitude(jd)) % 360


def sekki_list(start: datetime, end: datetime) -> list[dict]:
    return [{"date": t.astimezone(JST).date().isoformat(), "name": SEKKI[i]}
            for i, t in crossings(start, end, sun_longitude, 15)]


def moon_list(start: datetime, end: datetime) -> list[dict]:
    return [{"time": t.astimezone(JST).strftime("%Y-%m-%dT%H:%M"), "phase": PHASES[i]}
            for i, t in crossings(start, end, elongation, 90)]


def parse_holidays(text: str) -> dict[str, str]:
    out = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or not row[0][:1].isdigit():
            continue
        y, m, d = (int(x) for x in row[0].split("/"))
        out[date(y, m, d).isoformat()] = row[1].strip()
    if len(out) < 100:
        raise ValueError("祝日の CSV が短すぎます")
    return out


def fetch_holidays() -> dict[str, str]:
    req = urllib.request.Request(HOLIDAY_CSV, headers={"User-Agent": "piyorin-news (+https://taroaoki10-wq.github.io/piyorin-news/)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return parse_holidays(r.read().decode("cp932"))


def long_weekends(first: date, last: date, holidays: dict[str, str]) -> list[dict]:
    out, run = [], []
    d = first
    while d <= last + timedelta(days=1):
        off = d <= last and (d.weekday() >= 5 or d.isoformat() in holidays)
        if off:
            run.append(d)
        else:
            if len(run) >= 3:
                out.append({"start": run[0].isoformat(), "end": run[-1].isoformat(), "days": len(run)})
            run = []
        d += timedelta(days=1)
    return out


def build(today: date, holidays: dict[str, str], known_until=None) -> dict:
    first, last = today - timedelta(days=BEFORE), today + timedelta(days=AFTER)
    # 朔望月は約29.5日。月末に近い月齢でも、直前の新月を必ず収める。
    start = datetime(first.year, first.month, first.day, tzinfo=JST) - timedelta(days=32)
    end = datetime(last.year, last.month, last.day, tzinfo=JST) + timedelta(days=1)
    # CSV は年単位の公表。最後の祝日（11月23日）以降も、その年末までは確認済み。
    known_until = known_until or (f"{max(holidays)[:4]}-12-31" if holidays else "")
    known_until = min(last.isoformat(), known_until) if known_until else ""
    hol = [{"date": k, "name": v} for k, v in sorted(holidays.items()) if first.isoformat() <= k <= last.isoformat()]
    weekend_last = min(last, date.fromisoformat(known_until)) if known_until else first
    sekki = sekki_list(start, end)
    prior_sekki = [s for s in sekki if s["date"] < first.isoformat()]
    moon = moon_list(start, end)
    prior_new = [m for m in moon if m["phase"] == "新月" and m["time"] < first.isoformat()]
    moon_start = prior_new[-1]["time"] if prior_new else first.isoformat()
    return {
        "built": today.isoformat(),
        "note": "暦のデータ。scripts/build_koyomi.py が作る（生成 AI なし）。節気と月は計算値で、日付の境目の近くでは1日ずれることがある。",
        "sources": {
            "holidays": {"name": "内閣府「国民の祝日」について", "url": "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
                         "license": "公共データ利用規約（第1.0版）"},
            "astro": "太陽と月の位置の略算（Meeus『Astronomical Algorithms』）",
        },
        "holidays_from": first.isoformat(),
        "holidays_until": known_until,  # CSVの公表範囲と収録期間の両方で確認できる末日
        "holidays": hol,
        "long_weekends": long_weekends(first, weekend_last, holidays),
        "sekki": prior_sekki[-1:] + [s for s in sekki if first.isoformat() <= s["date"] <= last.isoformat()],
        # 月齢の計算に今日より前の新月が要るので、少し前から入れる
        "moon": [m for m in moon if moon_start <= m["time"] and m["time"][:10] <= last.isoformat()],
    }


def main() -> None:
    today = datetime.now(JST).date()
    previous = None
    try:
        holidays = fetch_holidays()
    except Exception as e:  # 取れなくても前の祝日で作る（祝日を消さない）
        print("祝日の CSV を取れませんでした:", e)
        holidays = {}
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8"))
            holidays = {h["date"]: h["name"] for h in previous.get("holidays", [])}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            pass
        if not holidays:
            print("前の祝日もないので、暦は作り直しません")
            return
    data = build(today, holidays, previous.get("holidays_until", max(holidays)) if previous else None)
    if previous:
        # 再取得できていないのに、祝日の確認範囲を延長したり前の祝日を消したりしない。
        data["holidays"] = previous["holidays"]
        data["holidays_from"] = previous.get("holidays_from", min(holidays))
        data["holidays_until"] = previous.get("holidays_until", max(holidays))
    write_json(OUT, data)
    print(f"暦: 祝日{len(data['holidays'])}件・連休{len(data['long_weekends'])}件・節気{len(data['sekki'])}件・月{len(data['moon'])}件")


if __name__ == "__main__":
    main()
