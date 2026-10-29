"""ぴよの知識の間違い（2026-10-29）の再発防止：丸数字・別の記事の混ざり・ぴよりんの書き間違い・あいさつの相対的な日付。"""
import sys
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_piyo as piyo  # noqa: E402
import build_reader as reader  # noqa: E402
import extract_events as extract  # noqa: E402
from news_store import nfkc  # noqa: E402

# 紅茶ぴよりんおでかけセット（official-p5642）の本文の一部。「ゴジラ」はどこにも無い
TEA = ("「定番ぴよりん」と「紅茶ぴよりん」の2ぴよをセットにした「紅茶ぴよりんおでかけセット」をはじめ、ぴよりんグッズも販売いたします。\n"
       "販売日時 2026年11月7日(土)・11月8日(日)2日間 ①10:00~ ②12:00~ ③14:00~ 山陽百貨店 本館6階 催し会場 価格 1,300円(税込)")


class CircledNumberTests(unittest.TestCase):
    def test_nfkc_keeps_circled_numbers_but_normalizes_the_rest(self):
        self.assertEqual(nfkc("①10：00～ ②12：00～ ③１４：００～"), "①10:00~ ②12:00~ ③14:00~")
        self.assertEqual(nfkc("㉑ＡＢＣ⑳（税込）"), "㉑ABC⑳(税込)")

    def test_reader_and_event_lines_keep_times_after_circled_numbers(self):
        self.assertEqual(reader.clean("<td>①10：00～／②14：00～</td>"), "①10:00~/②14:00~")
        lines = extract.html_to_lines("<article><p>販売時間：各日①10：00～／②14：00～</p><li>①11月1日（日）</li></article>")
        self.assertIn("販売時間:各日①10:00~/②14:00~", lines)
        self.assertIn("①11月1日(日)", lines)
        self.assertFalse(any("110:00" in ln or "111月" in ln for ln in lines))


class MemoNameTests(unittest.TestCase):
    def test_known_misspellings_of_piyorin_are_corrected(self):
        self.assertEqual(piyo.correct_memo_names("ぴよりnvillageは6時30分、ぴよりnshopは9時。三島甘藷ぴよりン。"),
                         "ぴよりんvillageは6時30分、ぴよりんshopは9時。三島甘藷ぴよりん。")
        self.assertEqual(piyo.correct_memo_names("ぴよりんvillage・ぴよりんshop"), "ぴよりんvillage・ぴよりんshop")


class GroundedMemoTests(unittest.TestCase):
    def setUp(self):
        network = patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden"))
        network.start()
        self.addCleanup(network.stop)
        clock = patch.object(piyo, "today_jst", return_value=date(2026, 10, 29))
        clock.start()
        self.addCleanup(clock.stop)

    def test_sentence_with_word_from_another_article_is_dropped(self):
        item = {"id": "official-p5642", "title": "山陽百貨店にて『紅茶ぴよりんおでかけセット』を2日間限定で販売!"}
        memo = "ゴジラとのコラボ。紅茶ぴよりんおでかけセット1,300円(税込)を山陽百貨店で11月7日・8日販売。"
        with patch("builtins.print"):
            self.assertEqual(piyo.grounded_memo(memo, item, TEA), "紅茶ぴよりんおでかけセット1,300円(税込)を山陽百貨店で11月7日・8日販売。")
        # 記事にある言葉だけなら、そのまま。「A×B」を「コラボ」と書くのもよい
        self.assertEqual(piyo.grounded_memo("紅茶ぴよりんおでかけセット。ぴよりんグッズも販売。", item, TEA), "紅茶ぴよりんおでかけセット。ぴよりんグッズも販売。")
        shibata = {"id": "x", "title": "【シェ・シバタ×ぴよりん】ぴよりんクッキー缶第1弾が登場!"}
        self.assertEqual(piyo.grounded_memo("シェ・シバタとのコラボ。ぴよりんクッキー缶第1弾が登場。", shibata, ""),
                         "シェ・シバタとのコラボ。ぴよりんクッキー缶第1弾が登場。")
        with patch("builtins.print"):  # 全部外れたら見出しだけ
            self.assertEqual(piyo.grounded_memo("ゴジラとのコラボ。", item, TEA), item["title"])

    def test_memos_are_made_one_article_per_call(self):
        items = [{"id": "tea", "cat": "official", "date": "2026-10-23", "title": "紅茶ぴよりんおでかけセット", "url": "https://example.com/tea"},
                 {"id": "godzilla", "cat": "official", "date": "2026-10-22", "title": "ぴよりんゴジラ販売", "url": "https://example.com/g"}]
        texts = {"tea": TEA, "godzilla": "映画『ゴジラ-0.0』公開記念 「ぴよりんゴジラ」販売 11月3日~13日"}
        sent = []

        def fake_call(system, tool, content, max_tokens, api_key):
            sent.append(content)
            memo = "ゴジラとのコラボ。紅茶ぴよりんおでかけセット1,300円(税込)。" if "紅茶" in content else "ぴよりんゴジラ。11月3日~13日販売。"
            return {"memos": [{"n": 0, "memo": memo}]}, {"input_tokens": 100, "output_tokens": 20}

        memos = {}
        with patch.object(piyo, "call_tool", side_effect=fake_call), \
                patch.object(piyo, "article_text", side_effect=lambda it: texts[it["id"]]), \
                patch.object(piyo, "memo_sources", return_value=[]), patch("builtins.print"):
            self.assertEqual(piyo.build_memos(items, memos, "fake-test-key", time.time()), (2, 200, 40))
        self.assertEqual(len(sent), 2)
        self.assertTrue(all(c.count("<article ") == 1 for c in sent))  # 1回に1記事だけ渡す
        self.assertEqual(memos["tea"]["memo"], "紅茶ぴよりんおでかけセット1,300円(税込)。")
        self.assertEqual(memos["godzilla"]["memo"], "ぴよりんゴジラ。11月3日~13日販売。")


class GreetingGroundingTests(unittest.TestCase):
    def build(self, lines, suggest, text):
        with patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")), \
                patch.object(piyo, "today_jst", return_value=date(2026, 10, 29)), \
                patch.object(piyo, "load_json", return_value={}), \
                patch.object(piyo, "greeting_input", return_value=text), \
                patch.object(piyo, "call_tool", return_value=({"lines": lines, "suggest": suggest}, {})), \
                patch("builtins.print"):
            result, _ = piyo.build_greeting({}, [], "fake-test-key")
        return result

    def test_relative_days_become_dates_and_suggestions_need_known_names(self):
        text = ("<today>2026-10-29</today>\n<memo date=\"2026-10-23\">紅茶ぴよりんおでかけセット1,300円(税込)を山陽百貨店で11月7日・8日販売。</memo>\n"
                "<memo date=\"2026-10-22\">ぴよりんゴジラ（映画『ゴジラ-0.0』コラボ）。11月3日~13日販売。</memo>\n"
                "<event start=\"2026-10-30\" end=\"2026-10-30\">ぴよりんクリスマスケーキ 予約受付開始</event>")
        result = self.build(
            ["最近のぴよりんニュースだぴよ！", "・**ぴよりんカレンダー2027**きょう先行販売開始だぴよ",
             "・クリスマスケーキ予約**あした12時**から受け付けるぴよ", "・**紅茶ぴよりんおでかけセット**11月7日・8日に山陽百貨店で売るぴよ"],
            ["ぴよりんゴジラについて", "ゴジラコラボセットについて", "紅茶ぴよりんセットについて", "クリスマスケーキについて"], text)
        self.assertEqual(result["v"], 5)
        self.assertEqual(result["lines"][1], "・**ぴよりんカレンダー2027**、10月29日先行販売開始だぴよ")  # 数字とつながらないように
        self.assertEqual(result["lines"][2], "・クリスマスケーキ予約**10月30日12時**から受け付けるぴよ")
        self.assertEqual(result["suggest"], ["ぴよりんゴジラについて", "紅茶ぴよりんセットについて", "クリスマスケーキについて"])

    def test_absolute_days_covers_kanji_and_month_end(self):
        self.assertEqual(piyo.absolute_days("今日から・明日まで・あさって・明後日・本日", date(2026, 10, 31)),
                         "10月31日から・11月1日まで・11月2日・11月2日・10月31日")
        self.assertEqual(piyo.absolute_days("限定セット3きょう発売・**第2弾3**あした12時・第2弾あさって", date(2026, 10, 29)),
                         "限定セット3、10月29日発売・**第2弾3**、10月30日12時・第2弾10月31日")
        # 同じ月日がすぐ隣にあれば 1 つに（10/29 のまとめの「10月29日10月29日から先行販売」）
        self.assertEqual(piyo.absolute_days("カレンダー2027は**きょう10月29日から先行販売**・10月29日（本日）・**今日**10月29日・あした、10月30日・2027きょう10月29日",
                                            date(2026, 10, 29)),
                         "カレンダー2027は**10月29日から先行販売**・10月29日・**10月29日**・10月30日・2027、10月29日")
        self.assertEqual(piyo.absolute_days("11月3日〜13日・10月29日〜10月30日", date(2026, 10, 29)), "11月3日〜13日・10月29日〜10月30日")  # 並んでいない日付はそのまま


if __name__ == "__main__":
    unittest.main()
