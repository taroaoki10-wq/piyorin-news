import copy
import json
import sys
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_piyo as piyo


class MemoShopNameTests(unittest.TestCase):
    def setUp(self):
        # 誤って本物のAPIへ接続することも禁止する。
        network = patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden"))
        network.start()
        self.addCleanup(network.stop)
        clock = patch.object(piyo, "today_jst", return_value=date(2026, 10, 25))
        clock.start()
        self.addCleanup(clock.stop)

    def test_generated_memo_corrects_typo_before_storing(self):
        item = {"id": "new", "cat": "official", "date": "2026-10-25",
                "title": "三島甘藷ぴよりん", "url": "https://example.com/article"}
        response = ({"memos": [{"n": 0, "memo": "ぴよりnshopは1人2ぴよ。ぴよりんvillageも販売。"}]},
                    {"input_tokens": 10, "output_tokens": 5})
        memos = {}
        with patch.object(piyo, "call_tool", return_value=response), patch.object(piyo, "article_text", return_value="本文"):
            result = piyo.build_memos([item], memos, "fake-test-key", time.time())
        self.assertEqual(result, (1, 10, 5))
        self.assertEqual(memos["new"]["memo"], "ぴよりんshopは1人2ぴよ。ぴよりんvillageも販売。")
        self.assertEqual(memos["new"]["url"], item["url"])

    def test_existing_memos_correct_without_api_and_keep_metadata(self):
        memos = {
            "old": {"v": 1, "t": "2026-10-24", "date": "2026-10-23", "title": "商品",
                    "url": "https://example.com/old", "memo": "ぴよりnshopは1人2ぴよ。"},
            "ok": {"v": 1, "date": "2026-10-23", "memo": "ぴよりんshop アトリエ店・ぴよりんvillage・ひよりのクッキー"},
        }
        expected = copy.deepcopy(memos)
        expected["old"]["memo"] = "ぴよりんshopは1人2ぴよ。"
        news = [{"id": k, "cat": "press", "date": "2026-10-23"} for k in memos]
        with patch.object(piyo, "call_tool", side_effect=AssertionError("API forbidden")):
            self.assertEqual(piyo.build_memos(news, memos, "fake-test-key", time.time()), (0, 0, 0))
            self.assertEqual(memos, expected)
            self.assertEqual(piyo.build_memos(news, memos, "fake-test-key", time.time()), (0, 0, 0))
            self.assertEqual(memos, expected)

    def test_press_release_text_added_and_memo_remade_when_source_grows(self):
        official, press = "https://piyorin.com/news/p1/", "https://prtimes.jp/main/html/rd/p/000000001.000124425.html"
        with tempfile.TemporaryDirectory() as d, patch.object(piyo, "READER_DIR", Path(d)):
            for url, blocks in [(official, [{"t": "p", "x": "詳しくは下記URLよりご覧ください。"}, {"t": "p", "x": press}]),
                                (press, [{"t": "p", "x": "販売期間 2026年11月3日~11月13日"}])]:
                (Path(d) / (piyo.reader_id(url) + ".json")).write_text(json.dumps({"blocks": blocks}, ensure_ascii=False))
            item = {"id": "official-p1", "cat": "official", "date": "2026-10-22", "url": official, "related": []}
            self.assertEqual(piyo.memo_sources(item), [official, press])  # 本文に載った PR TIMES もたどる
            self.assertIn("11月3日", piyo.article_text(item))
            old = {"official-p1": {"v": 1, "url": official, "memo": "詳細は記事で確認。"}}
            self.assertTrue(piyo.needs_memo(item, old))
            done = {"official-p1": {"v": 1, "url": official, "memo": "販売期間は11月3日から。", "b": f"{official} {press}"}}
            self.assertFalse(piyo.needs_memo(item, done))
            (Path(d) / (piyo.reader_id(press) + ".json")).unlink()  # 本文の保存が消えても作り直さない
            self.assertFalse(piyo.needs_memo(item, done))

    def test_missing_key_still_skips_all_writes_and_api_calls(self):
        with patch.dict(piyo.os.environ, {"ANTHROPIC_API_KEY": ""}), \
                patch.object(piyo, "write_if_changed", side_effect=AssertionError("write forbidden")), \
                patch.object(piyo, "call_tool", side_effect=AssertionError("API forbidden")):
            self.assertEqual(piyo.main(), 0)


if __name__ == "__main__":
    unittest.main()
