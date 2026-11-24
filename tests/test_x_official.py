"""公式 X（@piyorin_nagoya）の投稿をニュースと予定に入れる（2026-11-24。ミルクティーぴよりんが X だけで知らされ、購入記録の選択肢に出なかった）。"""
import json
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import extract_events  # noqa: E402
import fetch_news  # noqa: E402
from news_store import page_html, primary_sources, request_url, x_posted, x_title, x_token  # noqa: E402

MILK_ID = "2122887519435960587"
MILK_URL = f"https://x.com/piyorin_nagoya/status/{MILK_ID}"
# 埋め込み用の投稿データ（2026-11-24 に本物から写した要る所だけ）
MILK_JSON = json.dumps({
    "created_at": "2026-11-18T03:00:00.000Z",
    "id_str": MILK_ID,
    "text": "【店舗限定 #ぴよりん が登場！】\n11/20(金)～ ＃ぴよりんshopアトリエ店 限定「#ミルクティーぴよりん」を販売♪\n\n"
            "名古屋コーチンの卵を使用したロイヤルミルクティー味のプリンを、ホワイトチョコレートのババロアで包みました🐥\n"
            "やさしい甘さと紅茶の香りが楽しめる、アトリエ店限定ぴよりんです✨ https://t.co/C6CnT31Nzw",
    "user": {"screen_name": "piyorin_nagoya"},
}, ensure_ascii=False)


class XReadTest(unittest.TestCase):
    def test_request_url_and_token(self):
        self.assertEqual(x_token(MILK_ID), "5598x7ee28m85q")
        self.assertEqual(request_url(MILK_URL),
                         f"https://cdn.syndication.twimg.com/tweet-result?id={MILK_ID}&lang=ja&token=5598x7ee28m85q")
        self.assertEqual(request_url("https://x.com/someone/status/1"), "https://x.com/someone/status/1")  # 公式でない投稿は読まない

    def test_posted_time_from_id(self):
        self.assertEqual(x_posted(MILK_ID).date(), date(2026, 11, 18))

    def test_page_html_and_sources(self):
        page = page_html(MILK_URL, MILK_JSON)
        self.assertIn('content="2026-11-18T12:00:00+09:00"', page)
        self.assertIn("<p>11/20(金)～ ぴよりんshopアトリエ店 限定「ミルクティーぴよりん」を販売♪</p>", page)
        self.assertNotIn("t.co", page)
        self.assertNotIn("#", page)
        self.assertEqual(primary_sources({"url": MILK_URL, "related": []}), [MILK_URL])

    def test_title(self):
        self.assertEqual(x_title("【店舗限定 ぴよりん が登場！】\n11/20(金)～ アトリエ店 限定「ミルクティーぴよりん」を販売♪\n次"),
                         "【店舗限定 ぴよりん が登場！】 11/20(金)～ アトリエ店 限定「ミルクティーぴよりん」を販売♪")
        self.assertEqual(x_title("【お知らせ📢】\n📅11月15日（日）～11月23日（月・祝）\nvillageで「ひよりのお茶会」を開催\nあと"),
                         "【お知らせ📢】 📅11月15日（日）～11月23日（月・祝） villageで「ひよりのお茶会」を開催")
        self.assertEqual(x_title("名古屋駅構内にある『喫茶ボンボヤージュ』が1周年を迎えました！\n次"),
                         "名古屋駅構内にある『喫茶ボンボヤージュ』が1周年を迎えました！")


class XNewsTest(unittest.TestCase):
    def test_item(self):
        it = fetch_news.x_item(MILK_ID, MILK_JSON)
        self.assertEqual(it["date"], "2026-11-18")
        self.assertEqual(it["cat"], "official")
        self.assertEqual(it["source"], "ぴよりん公式X")
        self.assertEqual(it["url"], MILK_URL)
        self.assertIn("ミルクティーぴよりん", it["title"])

    def test_item_skips(self):
        d = json.loads(MILK_JSON)
        reply = dict(d, in_reply_to_screen_name="someone")
        other = dict(d, user={"screen_name": "fan"})
        thanks = dict(d, text="たくさんのお祝いコメントありがとうございます🐥")
        for v in (reply, other, thanks):
            self.assertIsNone(fetch_news.x_item(MILK_ID, json.dumps(v, ensure_ascii=False)))

    def test_ids_from_search_pages(self):
        page = ('<a href="https://x.com/piyorin_nagoya/status/2122887519435960587">'
                '<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com%2Fpiyorin_nagoya%2Fstatus%2F2125031654314103145">'
                '<a href="https://x.com/fan/status/2125031654314103999">')
        self.assertEqual(fetch_news.x_ids(page), {"2122887519435960587", "2125031654314103145"})

    def test_attach_to_same_product_article(self):
        official = {"id": "official-p5676", "date": "2026-10-23", "cat": "official", "source": "ぴよりん公式サイト",
                    "url": "https://piyorin.com/news/p5676/", "related": [],
                    "title": "静岡県三島市の特産「三島甘藷」を使用した 「三島甘藷ぴよりん」が期間限定で販売！"}
        same = {"id": "n20261023-aaaa", "date": "2026-10-24", "cat": "official", "source": "ぴよりん公式X",
                "url": "https://x.com/piyorin_nagoya/status/2113510739587539261", "related": [],
                "title": "【お知らせ】 11/15～「三島甘藷ぴよりん」を販売"}
        alone = {"id": "n20261118-bbbb", "date": "2026-11-18", "cat": "official", "source": "ぴよりん公式X",
                 "url": MILK_URL, "related": [], "title": "【店舗限定 ぴよりん が登場！】 11/20(金)～ 限定「ミルクティーぴよりん」を販売♪"}
        items = [official, same, alone]
        self.assertEqual(fetch_news.attach_x(items), 1)
        self.assertEqual([n["id"] for n in items], ["official-p5676", "n20261118-bbbb"])
        self.assertIn("https://x.com/piyorin_nagoya/status/2113510739587539261", [r["url"] for r in official["related"]])
        self.assertIn("n20261023-aaaa", official["merged_ids"])

    def test_attach_by_distinct_word(self):
        """名前は違っても、見分ける語（「シェシバタ」）が同じで前後 3 日なら同じ商品（12/1 のクリスマスの缶）。"""
        press = {"id": "n20261124-0733aa9c", "date": "2026-11-24", "cat": "press", "source": "PR TIMES",
                 "url": "https://prtimes.jp/main/html/rd/p/000000269.000124425.html", "related": [],
                 "title": "クリスマスツリーを割ると、ぴよりんがひょっこり。シェ・シバタが手掛ける「ぴよりんドール缶 クリスマス限定」を発売"}
        x = {"id": "n20261124-cccc", "date": "2026-11-24", "cat": "official", "source": "ぴよりん公式X",
             "url": "https://x.com/piyorin_nagoya/status/2125031654314103145", "related": [],
             "title": "【お知らせ📢】 12/1（火）から「シェシバタ のクリスマスクッキー缶」が ぴよりんvillage 限定で登場🎄"}
        far = dict(x, id="n20261101-dddd", date="2026-11-01", url="https://x.com/piyorin_nagoya/status/2117055535136886903")
        items = [press, x, far]
        self.assertEqual(fetch_news.attach_x(items), 1)
        self.assertEqual([n["id"] for n in items], ["n20261124-0733aa9c", "n20261101-dddd"])  # 日が離れた物はまとめない
        self.assertEqual(fetch_news.x_words(["クリスマスクッキー缶"]), set())  # どの商品にも付く言葉だけでは見分けない

    def test_attached_x_is_not_read_again(self):
        """公式サイトの記事にまとめた X は表示だけ。読んだ元の組み合わせ（予定の読み直しの合図）を変えない。"""
        art = {"url": "https://piyorin.com/news/p5676/",
               "related": [{"source": "ぴよりん公式X", "url": "https://x.com/piyorin_nagoya/status/2113510739587539261"}]}
        self.assertEqual(primary_sources(art), ["https://piyorin.com/news/p5676/"])

    def test_zero_recent_ids_is_an_error(self):
        from unittest.mock import patch
        old = '<a href="https://x.com/piyorin_nagoya/status/1793159868297236505">'  # 2024 年の投稿だけ
        with patch.object(fetch_news, "x_fetch", return_value=old), self.assertRaises(RuntimeError):
            fetch_news.collect_x()

    def test_source_is_listed(self):
        self.assertIn(("公式X", "https://x.com/piyorin_nagoya", "x"), fetch_news.SOURCES)


class XEventTest(unittest.TestCase):
    def test_extract_without_claude(self):
        lines = extract_events.article_lines(page_html(MILK_URL, MILK_JSON))
        art = {"id": "n20261118-0a6e1b2c", "date": "2026-11-18", "url": MILK_URL,
               "title": "【店舗限定 ぴよりん が登場！】 11/20(金)～ ぴよりんshopアトリエ店 限定「ミルクティーぴよりん」を販売♪"}
        ev = extract_events.extract(art, lines)
        self.assertEqual((ev["title"], ev["start"], ev["end"], ev["place"]),
                         ("ミルクティーぴよりん", "2026-11-20", "2026-11-20", "ぴよりんshopアトリエ店"))

    def test_short_title_uses_quote_for_long_post(self):
        t = "【お知らせ📢】 12/1（火）から「シェシバタ のクリスマスクッキー缶」が ぴよりんvillage 限定で登場🎄"
        self.assertEqual(extract_events.short_title(t), "シェシバタ のクリスマスクッキー缶")
        self.assertEqual(extract_events.short_title("「ぴよりんvillage」で新メニュー"), "「ぴよりんvillage」で新メニュー")


if __name__ == "__main__":
    unittest.main()
