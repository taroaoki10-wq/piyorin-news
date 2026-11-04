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
