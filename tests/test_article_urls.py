"""記事の住所の読み方（2026-10-29）。住所に日本語が入った記事は「'ascii' codec」のエラーで読めず、
MSN の記事はページに中身が無いので、読む画面が空（題名が「MSN」だけ）になっていた。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_reader  # noqa: E402
import extract_events  # noqa: E402
import fetch_news  # noqa: E402
from news_store import ascii_url, page_html, request_url  # noqa: E402

MSN = "https://www.msn.com/ja-jp/news/other/ぴよりんがゴジラになった-映画公開記念の限定スイーツが名古屋に登場/ar-AA2fUzzG"
MSN_DATA = "https://assets.msn.com/content/view/v2/Detail/ja-jp/AA2fUzzG"
# 記事データ（2026-10-29 に取ったものを短くした形）
MSN_JSON = json.dumps({
    "title": "ぴよりんがゴジラになった!? 映画公開記念の限定スイーツが名古屋に登場",
    "abstract": "11月3日～13日の期間定で、ゴジラをイメージしたトサカのチョコレートをあしらった「ぴよりんゴジラ」を販売。",
    "imageResources": [{"url": "https://img-s-msn-com.akamaized.net/tenant/amp/entityid/AA2fUpzV.img"}],
    "publishedDateTime": "2026-10-23T20:20:00Z",
    "body": "<p>　ジェイアール東海フードサービスは、11月3日～13日の期間定で、「ぴよりんゴジラ」を販売します。</p>",
    "provider": {"name": "アスキー"},
}, ensure_ascii=False)
JAPANESE = "https://example.com/news/ぴよりん/1"


class FakeHeaders:
    def get_content_charset(self):
        return "utf-8"


class FakeResponse:
    headers = FakeHeaders()

    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class AsciiUrlTests(unittest.TestCase):
    def test_japanese_path_is_percent_encoded(self):
        u = ascii_url(JAPANESE)
        self.assertEqual(u, "https://example.com/news/%E3%81%B4%E3%82%88%E3%82%8A%E3%82%93/1")
        self.assertEqual(unquote(u), JAPANESE)

    def test_ascii_urls_stay_the_same(self):
        for u in ("https://piyorin.com/news/p5657/", "https://prtimes.jp/main/html/rd/p/000000258.000124425.html",
                  "https://news.google.com/rss/search?q=%E3%81%B4%E3%82%88%E3%82%8A%E3%82%93&hl=ja", "https://example.com/a?b=1&c=2#d"):
            self.assertEqual(ascii_url(u), u)

    def test_existing_escapes_query_and_spaces(self):
        self.assertEqual(ascii_url("https://example.com/%E3%81%B4/よ?q=ぴよりん&x=1"),
                         "https://example.com/%E3%81%B4/%E3%82%88?q=%E3%81%B4%E3%82%88%E3%82%8A%E3%82%93&x=1")
        self.assertEqual(ascii_url("https://example.com/a b"), "https://example.com/a%20b")


class MsnTests(unittest.TestCase):
    def test_msn_articles_are_read_from_the_article_data(self):
        self.assertEqual(request_url(MSN), MSN_DATA)
        encoded = "https://www.msn.com/ja-jp/news/other/" + quote("ぴよりんがゴジラになった") + "/ar-AA2fUzzG?ocid=BingNewsSerp"
        self.assertEqual(request_url(encoded), MSN_DATA)
        self.assertEqual(request_url("https://www.msn.com/ja-jp/news"), "https://www.msn.com/ja-jp/news")  # 記事でないページはそのまま

    def test_article_data_becomes_a_page_the_scripts_understand(self):
        page = page_html(MSN, MSN_JSON)
        art = build_reader.summary(MSN, page)
        self.assertEqual(art["title"], "ぴよりんがゴジラになった!? 映画公開記念の限定スイーツが名古屋に登場")
        self.assertEqual(art["blocks"], [
            {"t": "img", "x": "https://img-s-msn-com.akamaized.net/tenant/amp/entityid/AA2fUpzV.img"},
            {"t": "p", "x": "11月3日~13日の期間定で、ゴジラをイメージしたトサカのチョコレートをあしらった「ぴよりんゴジラ」を販売。"}])
        self.assertEqual(fetch_news.published_date(page), "2026-10-24")  # 20:20Z は日本の 10/24 5:20
        self.assertTrue(any("ぴよりんゴジラ" in ln for ln in extract_events.html_to_lines(page)))

    def test_other_pages_are_unchanged(self):
        self.assertEqual(page_html("https://piyorin.com/news/p5657/", "<p>そのまま</p>"), "<p>そのまま</p>")


class FetchTests(unittest.TestCase):
    def fetch_all(self, url, body):
        sent = []

        def fake_urlopen(req, timeout=None):
            sent.append(req.full_url)
            req.full_url.encode("ascii")  # 本物の urllib はここで「'ascii' codec」のエラーになっていた
            return FakeResponse(body)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            pages = [f(url) for f in (build_reader.fetch, extract_events.fetch, fetch_news.fetch)]
        return sent, pages

    def test_every_fetch_sends_an_ascii_url(self):
        sent, pages = self.fetch_all(JAPANESE, "<p>ok</p>")
        self.assertEqual(sent, [ascii_url(JAPANESE)] * 3)
        self.assertEqual(pages, ["<p>ok</p>"] * 3)

    def test_msn_articles_are_fetched_from_the_article_data(self):
        sent, pages = self.fetch_all(MSN, MSN_JSON)
        self.assertEqual(sent, [MSN_DATA] * 3)
        self.assertTrue(all('property="og:title"' in p for p in pages))


class ReaderTests(unittest.TestCase):
    def test_empty_msn_articles_are_read_again(self):
        with tempfile.TemporaryDirectory() as d, patch.object(build_reader, "READER_DIR", Path(d)):
            other = "https://www.kobe-np.co.jp/info/prtimes/202610/c124425_r256.shtml"
            self.assertFalse(build_reader.has_article(MSN))  # まだ無い
            for url in (MSN, other):
                (Path(d) / (build_reader.reader_id(url) + ".json")).write_text(json.dumps({"title": "MSN", "blocks": []}))
            self.assertFalse(build_reader.has_article(MSN))  # 空の MSN の記事は読み直す
            self.assertTrue(build_reader.has_article(other))  # ほかの記事は前と同じく読み直さない
            (Path(d) / (build_reader.reader_id(MSN) + ".json")).write_text(json.dumps({"title": "x", "blocks": [{"t": "p", "x": "y"}]}))
            self.assertTrue(build_reader.has_article(MSN))

    def test_main_fills_an_empty_msn_article(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d)
            (data / "reader").mkdir()
            today = build_reader.datetime.now(build_reader.JST).date().isoformat()
            (data / "news.json").write_text(json.dumps([{"id": "n1", "date": today, "cat": "media", "url": MSN, "related": []}], ensure_ascii=False))
            (data / "events.json").write_text("[]")
            empty = data / "reader" / (build_reader.reader_id(MSN) + ".json")
            empty.write_text(json.dumps({"title": "MSN", "url": MSN, "mode": "summary", "date": today, "blocks": []}))
            with patch.multiple(build_reader, EVENTS_FILE=data / "events.json", NEWS_FILE=data / "news.json",
                                READER_DIR=data / "reader", OLD_FILE=data / "articles.json"), \
                    patch.object(build_reader, "fetch", side_effect=lambda u: page_html(u, MSN_JSON)), patch("builtins.print"):
                self.assertEqual(build_reader.main(), 0)
            art = json.loads(empty.read_text(encoding="utf-8"))
            self.assertEqual(art["mode"], "summary")
            self.assertEqual([b["t"] for b in art["blocks"]], ["img", "p"])

    def test_reader_file_name_still_uses_the_original_url(self):
        # ページは記事の住所（日本語のまま）から本文のファイル名を作るので、変えない
        import hashlib
        self.assertEqual(build_reader.reader_id(MSN), hashlib.sha1(MSN.encode("utf-8")).hexdigest()[:12])


if __name__ == "__main__":
    unittest.main()
