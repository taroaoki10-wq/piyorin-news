import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import extract_events as ex

OFFICIAL = "https://piyorin.com/news/p5633/"
PRESS = "https://prtimes.jp/main/html/rd/p/000000250.000124425.html"
# 公式の記事は本文に日付が無く、PR TIMES へのリンクだけ。下の関連記事の一覧には別の記事の日付が並ぶ。
PAGES = {
    OFFICIAL: f"""<main><p>2026.10.22</p><p>店舗</p><p>お知らせ</p><h1>「ぴよりんゴジラ」販売</h1>
      <p>期間限定企画を実施いたします。詳しくは下記URLよりご覧ください。</p><p>{PRESS}</p>
      <p>お知らせカテゴリ</p><p>関連記事</p><p>2026.10.26</p><p>カレンダーが登場</p></main>""",
    PRESS: """<main><p>2026年10月22日 15時00分</p><p>販売期間</p><p>2026年11月3日(火・祝)~11月13日(金)</p>
      <p>このプレスリリースには、メディア関係者向けの情報があります</p><p>2026年1月1日 別の記事</p></main>""",
}


class EventExtractionTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        root = Path(self.dir.name)
        for name in ("NEWS_FILE", "EVENTS_FILE", "STATE_FILE"):
            p = patch.object(ex, name, root / (name.lower() + ".json"))
            p.start()
            self.addCleanup(p.stop)
        net = patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden"))
        net.start()
        self.addCleanup(net.stop)
        self.sent = []

    def run_main(self, news, events, state=None, found=None, key="fake-test-key"):
        ex.NEWS_FILE.write_text(json.dumps(news, ensure_ascii=False))
        ex.EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False))
        if state is not None:
            ex.STATE_FILE.write_text(json.dumps(state))

        def fake_claude(chunk, api_key, known=()):
            self.sent.extend(chunk)
            self.known = list(known)
            return {j: list(found or []) for j in range(len(chunk))}, {}

        with patch.object(ex, "fetch", side_effect=lambda u: PAGES[u]), \
                patch.object(ex, "claude_events_batch", side_effect=fake_claude), \
                patch.dict(os.environ, {"ANTHROPIC_API_KEY": key}), \
                patch.object(ex, "datetime", wraps=ex.datetime) as dt:
            dt.now.return_value = ex.datetime(2026, 10, 28, 12, tzinfo=ex.JST)
            ex.main()
        return json.loads(ex.EVENTS_FILE.read_text()), json.loads(ex.STATE_FILE.read_text())

    def item(self, related=()):
        return {"id": "official-p5633", "cat": "official", "date": "2026-10-22", "title": "「ぴよりんゴジラ」販売",
                "url": OFFICIAL, "related": [{"source": "PR TIMES", "url": u} for u in related]}

    def test_article_lines_skip_post_date_labels_and_related_list(self):
        lines = ex.article_lines(PAGES[OFFICIAL])
        self.assertNotIn("2026.10.22", lines)
        self.assertNotIn("2026.10.26", lines)
        self.assertNotIn("店舗", lines)
        self.assertEqual(ex.article_lines(PAGES[PRESS]), ["販売期間", "2026年11月3日(火・祝)~11月13日(金)"])

    def test_wrong_old_event_replaced_using_linked_press_release(self):
        old = {"id": "auto-officialp5633", "title": "ぴよりんゴジラ販売", "start": "2026-10-22", "end": "2026-10-22",
               "place": "ぴよりんvillage", "kind": "release", "url": OFFICIAL, "auto": True}
        manual = {"id": "e-manual", "title": "手で入れた予定", "start": "2026-10-22", "end": "2026-10-22", "url": "https://example.com/"}
        found = [{"title": "ぴよりんゴジラ販売", "start": "2026-11-03", "end": "2026-11-13", "place": "ぴよりんshop", "kind": "sale"}]
        events, state = self.run_main([self.item()], [old, manual], {"checkedArticles": [OFFICIAL]}, found)
        self.assertIn("2026年11月3日", self.sent[0][1])  # 公式から PR TIMES へのリンクをたどって読む
        self.assertNotIn("2026.10.26", self.sent[0][1])
        auto = [e for e in events if e.get("auto")]
        self.assertEqual([(e["start"], e["end"], e["src"]) for e in auto], [("2026-11-03", "2026-11-13", "official-p5633")])
        self.assertIn(manual, events)
        self.assertEqual(state, {"items": {"official-p5633": f"v{ex.EXTRACT_VERSION} " + OFFICIAL}})
        self.assertEqual(self.known, [manual])  # 手で登録した予定を Claude に伝える
        # 同じ組み合わせは読み直さない。PR TIMES がまとまって元が増えたら読み直す
        self.sent.clear()
        self.run_main([self.item()], events, state, found)
        self.assertEqual(self.sent, [])
        self.run_main([self.item([PRESS])], events, state, found)
        self.assertEqual(len(self.sent), 1)

    def test_empty_reread_keeps_previous_events(self):
        old = {"id": "auto-officialp5633", "title": "前の予定", "start": "2026-11-03", "end": "2026-11-13",
               "kind": "sale", "url": OFFICIAL, "auto": True}
        events, state = self.run_main([self.item()], [old], {}, [])
        self.assertEqual(events, [old])
        self.assertIn("official-p5633", state["items"])

    def test_failed_source_retried_next_time(self):
        with patch.dict(PAGES, {PRESS: None}):
            def broken(u):
                if PAGES[u] is None:
                    raise OSError("down")
                return PAGES[u]
            ex.NEWS_FILE.write_text(json.dumps([self.item()]))
            ex.EVENTS_FILE.write_text("[]")
            with patch.object(ex, "fetch", side_effect=broken), patch.object(ex, "claude_events_batch") as api:
                ex.main()
            api.assert_not_called()
        self.assertEqual(json.loads(ex.STATE_FILE.read_text()), {"items": {}})

    def test_duplicate_events_from_separate_articles_merged(self):
        a = {"title": "ぴよりんゴジラ販売", "start": "2026-11-03", "end": "2026-11-13", "auto": True, "src": "a"}
        b = {"title": "ぴよりんゴジラ 販売", "start": "2026-11-03", "end": "2026-11-13", "auto": True, "src": "b"}
        c = {"title": "ぴよりんゴジラ 店内飲食", "start": "2026-11-03", "end": "2026-11-13", "auto": True, "src": "a"}
        manual = {"title": "ぴよりんゴジラ販売", "start": "2026-11-03", "end": "2026-11-13"}
        self.assertEqual(ex.drop_duplicates([manual, a, b, c]), [manual, c])  # 名前も期間も手の予定と同じ a・似た b は外す

    def test_auto_event_same_as_manual_one_dropped_but_different_sale_kept(self):
        manual = {"title": "ドデ祭2026", "start": "2026-10-17", "end": "2026-10-18", "kind": "event"}
        same = {"title": "ドデ祭 2026", "start": "2026-10-17", "end": "2026-10-18", "auto": True, "src": "p1"}
        sale = {"title": "ドデ祭2026 ウルフィぴよりん販売", "start": "2026-10-17", "end": "2026-10-18", "auto": True, "src": "p1"}
        other_day = {"title": "ドデ祭2026", "start": "2026-10-18", "end": "2026-10-18", "auto": True, "src": "p1"}
        self.assertEqual(ex.drop_duplicates([manual, same, sale, other_day]), [manual, sale, other_day])

    def test_known_events_sent_and_katakana_typo_fixed(self):
        import claude_events as ce
        captured = {}

        class Res:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b""

        def fake_open(req, timeout):
            captured["body"] = json.loads(req.data)
            return Res()

        art = {"title": "ウルフィ", "date": "2026-10-09"}
        reply = {"content": [{"type": "tool_use", "name": "save_events", "input": {"events": [
            {"article": 0, "title": "ウルフィぴよりン実店舗販売", "start": "2026-10-19", "end": "2026-12-31", "kind": "sale"}]}}]}
        with patch("urllib.request.urlopen", side_effect=fake_open), patch.object(ce.json, "load", return_value=reply):
            found, _ = ce.claude_events_batch([(art, "抜粋")], "fake-test-key",
                                              [{"title": "ウルフィ×ぴよりん ぬいぐるみ 店頭販売", "start": "2026-10-19", "end": "2026-12-31"}])
        content = captured["body"]["messages"][0]["content"]
        self.assertIn("<known>", content)
        self.assertIn("ウルフィ×ぴよりん ぬいぐるみ 店頭販売", content)
        self.assertEqual(found[0][0]["title"], "ウルフィぴよりん実店舗販売")


if __name__ == "__main__":
    unittest.main()
