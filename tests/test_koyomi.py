import json
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_koyomi as ko

CSV = "国民の祝日・休日月日,国民の祝日・休日名称\n" + "".join(
    f"{y}/{md},{name}\n" for y in range(2000, 2028) for md, name in
    [("1/1", "元日"), ("3/20", "春分の日"), ("5/3", "憲法記念日"), ("5/4", "みどりの日"), ("5/5", "こどもの日"),
     ("11/3", "文化の日"), ("11/23", "勤労感謝の日")])


class KoyomiTests(unittest.TestCase):
    def setUp(self):
        network = patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden"))
        network.start()
        self.addCleanup(network.stop)

    def test_equinox_and_solstice_dates(self):
        # 国立天文台の暦要項の日付
        s = {x["name"]: x["date"] for x in ko.sekki_list(datetime(2026, 1, 1, tzinfo=ko.JST), datetime(2027, 1, 1, tzinfo=ko.JST))}
        self.assertEqual(s["春分"], "2026-03-20")
        self.assertEqual(s["夏至"], "2026-06-21")
        self.assertEqual(s["秋分"], "2026-09-23")
        self.assertEqual(s["冬至"], "2026-12-22")

    def test_moon_phase_times_match_known_events(self):
        # 国立天文台の朔弦望（rekiyou243 / rekiyou253）。食の最大時刻とは区別する。
        m = ko.moon_list(datetime(2024, 4, 1, tzinfo=ko.JST), datetime(2025, 3, 20, tzinfo=ko.JST))
        for time, phase in [("2024-04-09T03:21", "新月"), ("2025-03-14T15:55", "満月")]:
            expected = datetime.fromisoformat(time)
            actual = min((datetime.fromisoformat(x["time"]) for x in m if x["phase"] == phase), key=lambda t: abs(t - expected))
            self.assertLessEqual(abs((actual - expected).total_seconds()), 180)

    def test_holiday_csv_and_long_weekends(self):
        hol = ko.parse_holidays(CSV)
        self.assertEqual(hol["2026-11-03"], "文化の日")
        lw = ko.long_weekends(date(2027, 4, 25), date(2027, 5, 10), hol)
        self.assertEqual(lw, [{"start": "2027-05-01", "end": "2027-05-05", "days": 5}])

    def test_short_csv_is_rejected(self):
        with self.assertRaises(ValueError):
            ko.parse_holidays("国民の祝日・休日月日,国民の祝日・休日名称\n2026/1/1,元日\n")

    def test_build_range_and_unknown_future_weekends(self):
        hol = ko.parse_holidays(CSV)
        d = ko.build(date(2026, 10, 26), hol)
        self.assertEqual(d["holidays_until"], (date(2026, 10, 26) + ko.timedelta(days=ko.AFTER)).isoformat())
        self.assertEqual(d["holidays"][0], {"date": "2026-11-03", "name": "文化の日"})
        # 祝日が発表されていない先の連休は作らない
        self.assertTrue(all(x["end"] <= "2027-12-31" for x in d["long_weekends"]))
        future = ko.build(date(2027, 12, 25), hol)
        self.assertEqual(future["holidays_until"], "2027-12-31")
        self.assertTrue(all(x["end"] <= "2027-12-31" for x in future["long_weekends"]))
        self.assertTrue(any(x["time"] < "2026-10-26" and x["phase"] == "新月" for x in d["moon"]))

    def test_keeps_previous_holidays_when_fetch_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "koyomi.json"
            previous = {"holidays_from": "2026-01-01", "holidays_until": "2027-11-30", "holidays": [{"date": "2026-01-01", "name": "元日"}, {"date": "2026-11-03", "name": "文化の日"}]}
            out.write_text(json.dumps(previous), encoding="utf-8")
            with patch.object(ko, "OUT", out), patch.object(ko, "fetch_holidays", side_effect=OSError("down")):
                ko.main()
            actual = json.loads(out.read_text(encoding="utf-8"))
            for key in ["holidays", "holidays_from", "holidays_until"]:
                self.assertEqual(actual[key], previous[key])

    def test_no_file_when_nothing_to_use(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "koyomi.json"
            with patch.object(ko, "OUT", out), patch.object(ko, "fetch_holidays", side_effect=OSError("down")):
                ko.main()
            self.assertFalse(out.exists())

    def test_holiday_csv_includes_substitute_and_citizens_holidays(self):
        hol = ko.parse_holidays(CSV + "2026/5/6,休日\n2026/9/22,休日\n")
        self.assertEqual(hol["2026-05-06"], "休日")
        self.assertEqual(hol["2026-09-22"], "休日")

    def test_invalid_previous_file_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "koyomi.json"
            out.write_text("broken", encoding="utf-8")
            with patch.object(ko, "OUT", out), patch.object(ko, "fetch_holidays", side_effect=OSError("down")):
                ko.main()
            self.assertEqual(out.read_text(), "broken")

    def test_previous_new_moon_is_available_near_the_end_of_a_lunar_month(self):
        data = ko.build(date(2026, 10, 10), ko.parse_holidays(CSV))
        self.assertTrue(any(m["phase"] == "新月" and m["time"] < "2026-10-10" for m in data["moon"]))


if __name__ == "__main__":
    unittest.main()
