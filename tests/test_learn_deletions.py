import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import judge_relevance  # noqa: E402
import learn_deletions  # noqa: E402
import update_local  # noqa: E402

NEWS = [
    {"id": "g1", "cat": "media", "title": "神谷そら17位 米女子ゴルフ予選会", "source": "名駅経済新聞", "url": "https://x/1"},
    {"id": "p1", "cat": "media", "title": "ぴよりん 冬の限定味", "source": "名駅経済新聞", "url": "https://x/2",
     "merged_ids": ["p1old"]},
    {"id": "o1", "cat": "official", "title": "公式のお知らせ", "source": "公式", "url": "https://x/3"},
]


class BuildTest(unittest.TestCase):
    def test_delete_and_restore(self):
        led = learn_deletions.build({"g1": {"t": 5, "on": True}, "p1old": {"t": 6, "on": False},
                                     "o1": {"t": 7, "on": True}, "unknown": {"t": 8, "on": True}}, NEWS, {})
        self.assertEqual([e["id"] for e in led["del"]], ["g1"])
        self.assertEqual([e["id"] for e in led["keep"]], ["p1"])  # 統合前の ID を今の ID にまとめる
        self.assertEqual(led["del"][0]["title"], NEWS[0]["title"])

    def test_old_examples_kept_when_article_gone(self):
        old = {"del": [{"id": "gone", "title": "古い関係ない記事", "source": "s", "url": "", "t": 1}], "keep": []}
        led = learn_deletions.build({}, NEWS, old)
        self.assertEqual([e["id"] for e in led["del"]], ["gone"])
        led = learn_deletions.build({"gone": {"t": 2, "on": False}}, NEWS, old)  # 戻したら「関係ある」へ
        self.assertEqual(led["del"], [])
        self.assertEqual([e["id"] for e in led["keep"]], ["gone"])

    def test_main_writes_ledger_from_file(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "data"
            data.mkdir()
            (data / "news.json").write_text(json.dumps(NEWS, ensure_ascii=False), encoding="utf-8")
            hidden = Path(d) / "hidden.json"
            hidden.write_text(json.dumps({"v": 1, "items": {"g1": {"t": 5, "on": True}}}), encoding="utf-8")
            with mock.patch.object(learn_deletions, "DATA", data), \
                    mock.patch.object(learn_deletions, "LEARN_FILE", data / "learn.json"), \
                    mock.patch.dict(os.environ, {"PIYO_HIDDEN_JSON": str(hidden)}):
                self.assertEqual(learn_deletions.main(), 0)
                first = (data / "learn.json").read_text(encoding="utf-8")
                self.assertEqual(json.loads(first)["del"][0]["id"], "g1")
                self.assertEqual(learn_deletions.main(), 0)  # 変わりなければ書かない
                self.assertEqual((data / "learn.json").read_text(encoding="utf-8"), first)

    def test_unreadable_keeps_old_ledger(self):
        with mock.patch.dict(os.environ, {"PIYO_HIDDEN_JSON": "/no/such/file"}):
            self.assertIsNone(learn_deletions.read_records())

    def test_update_local_runs_step_before_judge(self):
        s = update_local.STEPS
        self.assertLess(s.index("learn_deletions.py"), s.index("judge_relevance.py"))
        self.assertIn("learn_deletions.py", update_local.OPTIONAL)


class JudgeExamplesTest(unittest.TestCase):
    LEARN = {"del": [{"id": "g1", "title": "神谷そら17位 米女子ゴルフ予選会", "source": "名駅経済新聞"}],
             "keep": [{"id": "p1", "title": "ぴよりん 冬の限定味", "source": "名駅経済新聞"}]}

    def test_examples_text(self):
        t = judge_relevance.learn_examples(self.LEARN)
        self.assertIn("<user_examples>", t)
        self.assertIn("神谷そら17位", t)
        self.assertIn("ぴよりん 冬の限定味", t)
        self.assertEqual(judge_relevance.learn_examples({}), "")
        self.assertEqual(judge_relevance.learn_sig({}), "")
        self.assertNotEqual(judge_relevance.learn_sig(self.LEARN), "")

    def test_examples_go_to_system_and_recent_ok_items_rejudged(self):
        from datetime import datetime
        today = datetime.now(judge_relevance.JST).strftime("%Y-%m-%d")
        news = [
            {"id": "new", "cat": "media", "title": "新しい記事", "source": "s", "url": "https://x/a", "date": today},
            {"id": "okold", "cat": "media", "title": "前に関係ありの記事", "source": "s", "url": "https://x/b",
             "date": today, "jg": {"v": judge_relevance.JUDGE_VERSION, "ok": True, "why": "", "t": today}},
            {"id": "g1", "cat": "media", "title": "神谷そら", "source": "s", "url": "https://x/c", "date": today,
             "jg": {"v": judge_relevance.JUDGE_VERSION, "ok": True, "why": "", "t": today}},
        ]
        seen = []

        def fake(items, key, examples="", timeout=60):
            seen.append(([i["id"] for i in items], examples))
            return {k: (True, "ok") for k in range(len(items))}, {}

        with tempfile.TemporaryDirectory() as d:
            nf, lf = Path(d) / "news.json", Path(d) / "learn.json"
            nf.write_text(json.dumps(news, ensure_ascii=False), encoding="utf-8")
            lf.write_text(json.dumps(self.LEARN, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(judge_relevance, "NEWS_FILE", nf), \
                    mock.patch.object(judge_relevance, "LEARN_FILE", lf), \
                    mock.patch.object(judge_relevance.claude_call, "api_key", return_value="cli"), \
                    mock.patch.object(judge_relevance, "judge_batch", side_effect=fake), \
                    mock.patch.object(judge_relevance, "settings", return_value=dict(judge_relevance.SETTINGS, min_batch=1)):
                judge_relevance.main()
                ids, ex = seen[0]
                self.assertEqual(ids, ["new", "okold"])  # 自分で決めた g1 はもう一度判定しない
                self.assertIn("<user_examples>", ex)
                out = json.loads(nf.read_text(encoding="utf-8"))
                self.assertEqual(out[1]["jg"]["lv"], judge_relevance.learn_sig(self.LEARN))
                seen.clear()
                judge_relevance.main()  # 同じ例ならもう判定しない
                self.assertEqual(seen, [])


class RuleAndBatchTest(unittest.TestCase):
    def run_main(self, news, learn, cfg=None, key="cli"):
        calls = []

        def fake(items, k, examples="", timeout=60):
            calls.append([i["id"] for i in items])
            return {n: (False, "関係なし") for n in range(len(items))}, {}

        d = tempfile.mkdtemp()
        nf, lf = Path(d) / "news.json", Path(d) / "learn.json"
        nf.write_text(json.dumps(news, ensure_ascii=False), encoding="utf-8")
        lf.write_text(json.dumps(learn, ensure_ascii=False), encoding="utf-8")
        with mock.patch.object(judge_relevance, "NEWS_FILE", nf), \
                mock.patch.object(judge_relevance, "LEARN_FILE", lf), \
                mock.patch.object(judge_relevance.claude_call, "api_key", return_value=key), \
                mock.patch.object(judge_relevance, "judge_batch", side_effect=fake), \
                mock.patch.object(judge_relevance, "settings", return_value=dict(judge_relevance.SETTINGS, **(cfg or {}))):
            judge_relevance.main()
        return calls, {n["id"]: n.get("jg") for n in json.loads(nf.read_text(encoding="utf-8"))}

    def item(self, i, title):
        return {"id": i, "cat": "media", "title": title, "source": "s", "url": "https://x/" + i, "date": "2026-11-23"}

    def test_title_rule_and_learned_rule_skip_claude(self):
        learn = {"del": [{"id": "g0", "title": "神谷そら17位 米女子ゴルフ予選会", "source": "s"}], "keep": []}
        calls, jg = self.run_main([self.item("a", "ぴよりん 冬の限定味"), self.item("b", "神谷そら 米女子ゴルフ予選会で20位")], learn)
        self.assertEqual(calls, [])
        self.assertEqual((jg["a"]["ok"], jg["a"]["by"]), (True, "rule"))
        self.assertEqual((jg["b"]["ok"], jg["b"]["by"]), (False, "rule"))

    def test_rules_work_without_claude(self):
        learn = {"del": [{"id": "g0", "title": "神谷そら17位 米女子ゴルフ予選会", "source": "s"}], "keep": []}
        calls, jg = self.run_main([self.item("b", "神谷そら 米女子ゴルフ予選会で20位"), self.item("c", "ステーキ店の感謝デー")],
                                  learn, key="")
        self.assertEqual(jg["b"]["ok"], False)
        self.assertIsNone(jg["c"])  # 迷う記事は表示したまま

    def test_few_ambiguous_items_wait_then_batch(self):
        news = [self.item("c", "ステーキ店の感謝デー"), self.item("d", "産院がグッドデザイン賞")]
        calls, jg = self.run_main(news, {})
        self.assertEqual(calls, [])  # 2 件ではまだ呼ばない
        self.assertIn("wait", jg["c"])
        self.assertNotIn("ok", jg["c"])
        old = dict(news[0], jg={"wait": "2026-01-01T00:00:00+09:00"})
        calls, jg = self.run_main([old, news[1]], {})
        self.assertEqual(calls, [["c", "d"]])  # 待ちすぎたので 1 回でまとめて聞く
        self.assertEqual(jg["c"]["ok"], False)
        calls, _ = self.run_main([self.item(str(i), f"関係の分からない記事{i}番") for i in range(4)], {})
        self.assertEqual(len(calls), 1)  # 4 件たまったら 1 回で聞く

    def test_settings_file_has_all_keys(self):
        j = json.loads(judge_relevance.SETTINGS_FILE.read_text(encoding="utf-8"))
        self.assertEqual(set(j), set(judge_relevance.SETTINGS))


if __name__ == "__main__":
    unittest.main()
