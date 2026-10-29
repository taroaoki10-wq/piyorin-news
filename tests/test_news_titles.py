"""途中で切れたニュースの見出しを補う（2026-10-29。Google ニュースの見出しが「...」で切れていた）。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fetch_news import clean_title, full_title, page_title  # noqa: E402


def page(title, og=True):
    return f'<html><head><meta property="og:title" content="{title}"></head></html>' if og else f"<title>{title}</title>"


class FullTitleTests(unittest.TestCase):
    def test_truncated_titles_are_completed_from_the_page(self):
        self.assertEqual(full_title("魔女帽子のぴよりん缶に8種類の手作りクッキー！ジェイアール東海 ...",
                                    page("魔女帽子のぴよりん缶に8種類の手作りクッキー！ジェイアール東海フードサービス ひよりの手作りクッキー缶（ハロウィンver.）")),
                         "魔女帽子のぴよりん缶に8種類の手作りクッキー！ジェイアール東海フードサービス ひよりの手作りクッキー缶（ハロウィンver.）")
        # 掲載サイトの名前は外す
        self.assertEqual(full_title("「念願かなって日本一のピッチャーに」阪神・高橋遥人投手が沢村 ...",
                                    page("「念願かなって日本一のピッチャーに」阪神・高橋遥人投手が沢村賞を受賞! 恩師が語る（静岡放送（SBS）） - Yahoo!ニュース", og=False)),
                         "「念願かなって日本一のピッチャーに」阪神・高橋遥人投手が沢村賞を受賞! 恩師が語る")
        self.assertEqual(full_title("新垣結衣、第1子出産 CM出演企業から祝福の声続々 雪肌精「誠にお ...",
                                    page("新垣結衣、第1子出産 CM出演企業から祝福の声続々 雪肌精「誠におめでとうございます」:山陽新聞デジタル｜さんデジ")),
                         "新垣結衣、第1子出産 CM出演企業から祝福の声続々 雪肌精「誠におめでとうございます」")

    def test_titles_are_left_alone_when_they_do_not_match(self):
        self.assertIsNone(full_title("ぴよりんの新作が登場", page("ぴよりんの新作が登場！限定セットも")))  # 切れていない
        self.assertIsNone(full_title("ぴよりんの新作が ...", page("別の記事の題名")))  # 書き出しが違う
        self.assertIsNone(full_title("ぴよりんの新作が ...", "<html></html>"))  # 題名が取れない

    def test_page_title_and_photo_prefix(self):
        self.assertEqual(page_title('<meta content="A &amp; B" property="og:title">'), "A & B")
        self.assertEqual(clean_title("画像4 / 9＞名古屋駅にオープンした話題の新施設「ぴよりんvillage」をSKE48センター大村杏がレポート！"),
                         "名古屋駅にオープンした話題の新施設「ぴよりんvillage」をSKE48センター大村杏がレポート！")


if __name__ == "__main__":
    unittest.main()
