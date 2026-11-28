"""2026-11-28 無関係の記事（名駅経済新聞の通信社の記事）が載った件の試験。
1) Bing の説明文の後ろに付くページの横の見出しで「ぴよりんあり」と取り違えない
2) 通信社の転載ページ（/gpnews/）は拾わない
3) 判定待ちの印は jg でなく jw に書く（jg は「判定が済んだ」印として画面と Claude Pet が見ている）"""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_news  # noqa: E402
import judge_relevance  # noqa: E402

JST = timezone(timedelta(hours=9))


def rss(*items):
    body = "".join(
        f"<item><title>{t}</title><link>https://www.bing.com/news/apiclick.aspx?url={u}&amp;c=1</link>"
        f"<description>{d}</description><pubDate>Sat, 28 Nov 2026 02:00:00 GMT</pubDate></item>"
        for t, u, d in items)
    return f'<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>{body}</channel></rss>'


class FetchTest(unittest.TestCase):
    def test_wire_credit_cuts_sidebar(self):
        d = "伊藤大海投手が米大リーグのカブスとの契約に合意した。【時事通信社】 名駅で「ぴよりん」のクリスマス"
        self.assertNotIn("ぴよりん", fetch_news.own_text(d))
        self.assertEqual(fetch_news.own_text("ぴよりんが登場。"), "ぴよりんが登場。")

    def test_bing_wire_items_dropped(self):
        xml = rss(
            ("カブス、佐藤輝明外野手と6年契約発表", "https%3a%2f%2fmeieki.keizai.biz%2fgpnews%2f1779418%2f",
             "契約を発表した。【時事通信社】 トナカイに扮した「ぴよりん」のぬいぐるみ"),
            ("木原官房長官、拉致現場視察", "https%3a%2f%2fexample.jp%2fa%2f1",
             "視察した。【共同通信】 名駅の「ぴよりんvillage」"),
            ("ぴよりん村がクリスマス仕様に", "https%3a%2f%2fmeieki.keizai.biz%2fheadline%2f1%2f", "サンタ姿"),
            ("名古屋駅の新しいお土産", "https%3a%2f%2fexample.jp%2fb%2f2", "ぴよりんの新作が登場した。"),
        )
        got = [x["title"] for x in fetch_news.parse_rss(xml, "bing")]
        self.assertEqual(got, ["ぴよりん村がクリスマス仕様に", "名古屋駅の新しいお土産"])


class WaitMarkTest(unittest.TestCase):
    def run_judge(self, news, cfg_patch=None):
        with tempfile.TemporaryDirectory() as td:
            nf = Path(td) / "news.json"
            nf.write_text(json.dumps(news, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(judge_relevance, "NEWS_FILE", nf), \
                    mock.patch.object(judge_relevance, "LEARN_FILE", Path(td) / "learn.json"), \
                    mock.patch.object(judge_relevance.claude_call, "api_key", return_value="cli"), \
                    mock.patch.object(judge_relevance, "judge_batch", side_effect=AssertionError("呼ばない")):
                judge_relevance.main()
            return json.loads(nf.read_text(encoding="utf-8"))

    def test_wait_goes_to_jw_not_jg(self):
        out = self.run_judge([
            {"id": "a", "cat": "media", "title": "高橋光成投手、Dバックスと合意", "source": "名駅経済新聞", "url": "https://x/1"},
            {"id": "b", "cat": "media", "title": "ぴよりんの新作", "source": "x", "url": "https://x/2"},
        ])
        a, b = out
        self.assertNotIn("jg", a)  # 判定はまだ → jg は無い（Claude Pet の isWaiting も画面の pending も「待ち」と読む）
        self.assertTrue(a["jw"])
        self.assertIs(b["jg"]["ok"], True)
        self.assertNotIn("jw", b)

    def test_old_jg_wait_is_moved(self):
        t = datetime.now(JST).isoformat(timespec="seconds")
        out = self.run_judge([{"id": "a", "cat": "media", "title": "期限内の政権樹立呼び掛け イスラエル",
                               "source": "名駅経済新聞", "url": "https://x/1", "jg": {"wait": t}}])
        self.assertNotIn("jg", out[0])
        self.assertEqual(out[0]["jw"], t)

    def test_judged_clears_jw(self):
        t = (datetime.now(JST) - timedelta(hours=10)).isoformat(timespec="seconds")
        news = [{"id": "a", "cat": "media", "title": "千葉百音が女子SP首位", "source": "名駅経済新聞",
                 "url": "https://x/1", "jw": t}]
        with tempfile.TemporaryDirectory() as td:
            nf = Path(td) / "news.json"
            nf.write_text(json.dumps(news, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(judge_relevance, "NEWS_FILE", nf), \
                    mock.patch.object(judge_relevance, "LEARN_FILE", Path(td) / "learn.json"), \
                    mock.patch.object(judge_relevance.claude_call, "api_key", return_value="cli"), \
                    mock.patch.object(judge_relevance, "judge_batch", return_value=({0: (False, "無関係")}, {})):
                judge_relevance.main()
            out = json.loads(nf.read_text(encoding="utf-8"))
        self.assertIs(out[0]["jg"]["ok"], False)
        self.assertNotIn("jw", out[0])


if __name__ == "__main__":
    unittest.main()
