import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_images as b  # noqa: E402

PAGE = '''
<div class="post-item-wrapper">
<div data-mfp-src="#post-5472" class="post-item" data-type="inline">
 <p class="post-item__img c-img"><img src="data:x" data-src="https://piyorin.com/wp/wp-content/uploads/2026/08/aa-1024x682.png" rel="js-lazy" alt="星空ぴよりん"></p>
 <h3 class="post-item__ttl01">星空ぴよりん<br />
（17時以降限定）</h3>
 <p class="post-item__en">Starry Sky Piyorin</p>
</div>
<div id="post-5472" class="mfp-hide post-popup"><p class="date">2026年6月</p><ul class="tag"><li><span>#ぴよりんvillage限定</span></li></ul></div>
</div>
<div class="post-item-wrapper">
<div data-mfp-src="#post-1" class="post-item" data-type="inline">
 <p class="post-item__img c-img"><img data-src="https://evil.example/x.png" alt=""></p><h3 class="post-item__ttl01">x</h3>
</div>
<div id="post-1" class="mfp-hide post-popup"></div>
</div>
'''


class T(unittest.TestCase):
    def test_parse_zukan(self):
        z = b.parse_zukan(PAGE)
        self.assertEqual(len(z), 1)  # 公式以外の画像は使わない
        self.assertEqual(z[0]["name"], "星空ぴよりん（17時以降限定）")
        self.assertEqual(z[0]["date"], "2026年6月")
        self.assertEqual(z[0]["tags"], ["ぴよりんvillage限定"])
        self.assertEqual(z[0]["id"], "z5472")

    def test_og_image(self):
        page = '<meta property="og:image" content="https://prcdn.freetls.fastly.net/release_image/124425/109/a-1200x848.jpg?format=jpeg&amp;width=2400"/>'
        self.assertEqual(b.og_image(page), "https://prcdn.freetls.fastly.net/release_image/124425/109/a-1200x848.jpg")
        self.assertIsNone(b.og_image('<meta property="og:image" content="https://evil.example/a.jpg"/>'))

    def test_cookie_name(self):
        self.assertEqual(b.cookie_name("「ぴよりんアトリエ」手作りの人気クッキー缶に「お正月限定版」が登場！"), "ひよりの手作りクッキー缶（お正月限定）")
        self.assertEqual(b.cookie_name("ぴよりんをモチーフにした人気の「ひよりの手作りクッキー缶」にハロウィンver.が登場！"), "ひよりの手作りクッキー缶（ハロウィンver.）")
        self.assertEqual(b.cookie_name("「ぴよりんアトリエ」手作りの人気クッキー缶に秋の味わいを詰め込んだ限定版が登場！"), "ひよりの手作りクッキー缶（秋限定）")
        self.assertEqual(b.cookie_name("【シェ・シバタ×ぴよりん】ぴよりんクッキー缶第２弾が登場！"), "ぴよりんクッキー缶（シェ・シバタ 第2弾）")


if __name__ == "__main__":
    unittest.main()


class XImage(unittest.TestCase):
    """公式 X の投稿の写真（2026-11-24：ミルクティーぴよりんの絵が出なかった）"""
    DATA = '{"mediaDetails":[{"type":"video","media_url_https":"https://pbs.twimg.com/ext_tw_video_thumb/1/a.jpg"},{"type":"photo","media_url_https":"https://pbs.twimg.com/media/HXX4e66bkAAkPYj.jpg"}]}'

    def test_x_photo(self):
        self.assertEqual(b.x_photo(self.DATA), "https://pbs.twimg.com/media/HXX4e66bkAAkPYj.jpg")
        self.assertIsNone(b.x_photo('{"mediaDetails":[{"type":"photo","media_url_https":"https://evil.example/a.jpg"}]}'))
        self.assertIsNone(b.x_photo('{}'))
        self.assertIsNone(b.x_photo('not json'))

    def test_release_image_reads_x(self):
        seen = []
        old = b.get
        b.get = lambda u: (seen.append(u), self.DATA)[1]
        try:
            img = b.release_image("https://x.com/piyorin_nagoya/status/2122887519435960587")
        finally:
            b.get = old
        self.assertEqual(img, "https://pbs.twimg.com/media/HXX4e66bkAAkPYj.jpg")
        self.assertTrue(seen[0].startswith("https://cdn.syndication.twimg.com/tweet-result?id=2122887519435960587"))

    def test_x_name(self):
        self.assertEqual(b.x_name("【店舗限定 ぴよりん が登場！】 11/20(金)～ ぴよりんshopアトリエ店 限定「ミルクティーぴよりん」を販売♪"), "ミルクティーぴよりん")
        self.assertIsNone(b.x_name("本日の営業は終了しました"))

    def test_candidates_x_news(self):
        news = [{"id": "n1", "date": "2026-11-18", "cat": "official", "source": "ぴよりん公式X",
                 "title": "限定「ミルクティーぴよりん」を販売♪", "url": "https://x.com/piyorin_nagoya/status/2122887519435960587"},
                {"id": "n2", "date": "2026-11-18", "cat": "official", "source": "ぴよりん公式X", "title": "お知らせ", "url": "https://x.com/piyorin_nagoya/status/1"}]
        c = [x for x in b.candidates([], news) if x["from"] == "x"]
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]["key"], c[0]["cat"], c[0]["name"]), ("n1", "piyorin", "ミルクティーぴよりん"))


class Again(unittest.TestCase):
    def test_again(self):
        x = "https://x.com/piyorin_nagoya/status/2122887519435960587"
        self.assertTrue(b.again({"url": x, "img": None}))
        self.assertFalse(b.again({"url": x, "img": None, "xTried": True}))
        self.assertFalse(b.again({"url": x, "img": "https://pbs.twimg.com/media/a.jpg"}))
        self.assertFalse(b.again({"url": "https://prtimes.jp/main/html/rd/p/1.html", "img": None}))
