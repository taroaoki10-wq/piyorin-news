"""予定を iPhone のカレンダーに入れるファイル（2026-10-29）。時刻・知らせる時・ファイルの置き方。"""
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_ics  # noqa: E402

MEMOS = {
    "xmas": {"memo": "クリスマスケーキ予約。ぴよりんMARKETで10月30日12時から11月6日12時まで先着順予約。"},
    "tea": {"memo": "紅茶ぴよりんおでかけセットを11月7日(土)・8日(日)に販売。各日10:00〜・12:00〜。"},
    "early": {"memo": "11月1日(日) 8:30から整理券を配る。"},
}
XMAS = {"id": "auto-xmas", "title": "ぴよりんクリスマスケーキ 予約受付開始", "start": "2026-10-30", "end": "2026-10-30", "src": "xmas",
        "url": "https://example.com/xmas"}
TEA = {"id": "auto-tea", "title": "紅茶ぴよりんおでかけセット 山陽百貨店", "start": "2026-11-07", "end": "2026-11-08", "src": "tea", "place": "山陽百貨店"}
EARLY = {"id": "auto-early", "title": "朝の整理券", "start": "2026-11-01", "end": "2026-11-01", "src": "early"}
OLD = {"id": "old", "title": "終わった予定", "start": "2026-10-01", "end": "2026-10-02"}


class StartTimeTests(unittest.TestCase):
    def test_time_written_right_after_the_start_date(self):
        self.assertEqual(build_ics.start_time(XMAS, MEMOS), "12:00")
        self.assertIsNone(build_ics.start_time(TEA, MEMOS))  # 日付のすぐ後ろに時刻が無い（「各日10:00〜」は別の所）
        self.assertEqual(build_ics.start_time(EARLY, MEMOS), "08:30")
        self.assertEqual(build_ics.start_time({**XMAS, "src": "x"}, {"x": {"memo": "10月30日１２時３０分から"}}), "12:30")  # 全角の数字
        self.assertIsNone(build_ics.start_time({**XMAS, "src": "none"}, MEMOS))


class IcsTests(unittest.TestCase):
    def test_one_day_event_with_time_becomes_a_one_hour_event(self):
        text = build_ics.ics_text(XMAS, "12:00", "hour")
        self.assertIn("DTSTART:20261030T030000Z", text)  # 日本の12時
        self.assertIn("DTEND:20261030T040000Z", text)
        self.assertIn("TRIGGER:-PT60M", text)
        self.assertIn("TRIGGER:-PT960M", build_ics.ics_text(XMAS, "12:00", "eve"))  # 前の日の20時
        self.assertIn("TRIGGER:-PT180M", build_ics.ics_text(XMAS, "12:00", "morning"))  # 当日の9時
        self.assertNotIn("VALARM", build_ics.ics_text(XMAS, "12:00", "none"))
        self.assertTrue(text.endswith("END:VCALENDAR\r\n"))

    def test_multi_day_and_all_day_events_stay_all_day(self):
        text = build_ics.ics_text(TEA, None, "eve")
        self.assertIn("DTSTART;VALUE=DATE:20261107", text)
        self.assertIn("DTEND;VALUE=DATE:20261109", text)  # 終わりの次の日
        self.assertIn("TRIGGER:-PT240M", text)  # 前の日の20時
        self.assertIn("TRIGGER:PT540M", build_ics.ics_text(TEA, None, "morning"))  # 当日の9時
        self.assertIn("TRIGGER:PT660M", build_ics.ics_text(TEA, "12:00", "hour"))  # 何日も続く予定は終日のまま、11時に知らせる
        self.assertIn("LOCATION:山陽百貨店", text)

    def test_long_lines_are_folded_without_breaking_characters(self):
        text = build_ics.ics_text({**TEA, "title": "ぴよりん" * 30}, None, "none")
        for line in text.split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75)


class BuildTests(unittest.TestCase):
    def test_files_index_and_cleanup(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            (out / "stale-eve.ics").write_text("old")
            index, written, removed = build_ics.build([XMAS, TEA, EARLY, OLD], MEMOS, date(2026, 10, 29), out)
            self.assertEqual(index["auto-xmas"], {"f": "auto-xmas", "time": "12:00", "timed": True, "alarms": ["eve", "morning", "hour", "none"]})
            self.assertEqual(index["auto-tea"]["alarms"], ["eve", "morning", "none"])
            self.assertEqual(index["auto-early"]["alarms"], ["eve", "hour", "none"])  # 9時より前に始まるので、当日の朝9時は出さない
            self.assertNotIn("old", index)  # 終わった予定は作らない
            self.assertEqual(removed, 1)
            self.assertTrue((out / "auto-xmas-hour.ics").exists())
            self.assertEqual(json.loads((out / "index.json").read_text(encoding="utf-8")), index)
            # 2回目は何も書き直さない（更新のたびに差分を出さない）
            self.assertEqual(build_ics.build([XMAS, TEA, EARLY, OLD], MEMOS, date(2026, 10, 29), out)[1:], (0, 0))


if __name__ == "__main__":
    unittest.main()
