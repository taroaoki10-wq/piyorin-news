"""精度の直し（2026-11-22）：古い日付で入った新しい記事の日付を確かめ直す・終わった予定をあいさつに書かせない。"""
import sys
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_piyo as piyo
import fetch_news as news


def item(id, day, **extra):
    return dict(id=id, date=day, cat='media', title='【静岡駅】限定「みかんぴよりん」が登場！', source='テスト媒体',
                url='https://example.com/' + id, related=[], **extra)


class VerifyOldDatedNewArticles(unittest.TestCase):
    def run_verify(self, items, new_ids=(), real='2026-11-07'):
        seen = []

        def fake(it):
            seen.append(it['id'])
            return it, it['url'], real, None

        with patch.object(news, 'verify', side_effect=fake):
            fixed = news.verify_dates(items, new_ids)
        return fixed, seen

    def test_merged_later_finds_article_dated_far_before_its_twin(self):
        self.assertTrue(news.merged_later(item('n20260716-76391320', '2026-07-16', merged_ids=['n20261107-a74a5751'])))
        self.assertFalse(news.merged_later(item('n20261105-aaaaaaaa', '2026-11-05', merged_ids=['n20261107-a74a5751'])))
        self.assertFalse(news.merged_later(item('n20260716-76391320', '2026-07-16')))
        self.assertFalse(news.merged_later(item('x', '2026-07-16', merged_ids=['official-p1', 'n2026xxxx-bad'])))

    def test_old_dated_article_merged_with_newer_one_is_checked_and_fixed(self):
        # 本物の例：11月7日の記事が 7月16日 の日付で入り、「直近 14 日」に入らないので確かめられないままだった
        a = item('n20260716-76391320', '2026-07-16', merged_ids=['n20261107-a74a5751'])
        fixed, seen = self.run_verify([a])
        self.assertEqual((fixed, seen, a['date']), (1, [a['id']], '2026-11-07'))
        self.assertEqual(a['dv'], news.DATE_CHECK_VERSION)

    def test_new_article_with_old_date_is_checked(self):
        a, b = item('n20260716-11111111', '2026-07-16'), item('n20260601-22222222', '2026-06-01')
        fixed, seen = self.run_verify([a, b], new_ids={a['id']})
        self.assertEqual((fixed, seen), (1, [a['id']]))   # 今回入った記事だけ。前からある古い記事は開かない
        self.assertEqual((a['date'], b['date']), ('2026-11-07', '2026-06-01'))

    def test_suspicious_articles_go_first_when_over_the_limit(self):
        today = datetime.now(news.JST).date()
        recent = [item(f'n-r{i}', (today - timedelta(days=1)).isoformat()) for i in range(news.VERIFY_MAX + 3)]
        a = item('n20260716-76391320', '2026-07-16', merged_ids=['n20261107-a74a5751'])
        _, seen = self.run_verify(recent + [a], real=None)
        self.assertEqual(len(seen), news.VERIFY_MAX)
        self.assertEqual(seen[0], a['id'])

    def test_already_checked_or_official_articles_are_left_alone(self):
        a = item('n20260716-76391320', '2026-07-16', merged_ids=['n20261107-a74a5751'], dv=news.DATE_CHECK_VERSION)
        b = dict(item('official-p1', '2026-07-16', merged_ids=['n20261107-a74a5751']), cat='official')
        fixed, seen = self.run_verify([a, b], new_ids={b['id']})
        self.assertEqual((fixed, seen), (0, []))


class GreetingKnowsEndedEvents(unittest.TestCase):
    EVENTS = [
        {'title': 'ぴよりんゴジラ販売', 'start': '2026-11-03', 'end': '2026-11-13'},
        {'title': '三島甘藷ぴよりん販売', 'start': '2026-11-15', 'end': '2026-11-23'},
        {'title': '静岡みかんぴよりんおでかけセット販売（アスティ静岡）', 'start': '2026-11-26', 'end': '2026-11-27', 'place': 'アスティ静岡'},
        {'title': 'ブルーベリーぴよりん', 'start': '2026-08-08', 'end': '2026-08-20'},
        {'title': 'ぴよりん2026 クリスマスクッキー缶 販売開始', 'start': '2026-11-20', 'end': '2026-11-20', 'kind': 'release'},
    ]

    def test_recently_ended_events_are_passed_as_ended(self):
        with patch.object(piyo, 'today_jst', return_value=date(2026, 11, 22)):
            text = piyo.greeting_input({}, self.EVENTS)
        self.assertIn('<ended end="2026-11-13">ぴよりんゴジラ販売</ended>', text)
        self.assertIn('<event start="2026-11-26" end="2026-11-27">静岡みかんぴよりんおでかけセット販売', text)
        self.assertIn('<event start="2026-11-15" end="2026-11-23">三島甘藷ぴよりん販売</event>', text)  # 開催中は予定のまま
        self.assertNotIn('<ended end="2026-11-23">', text)
        self.assertNotIn('ブルーベリーぴよりん', text)  # 45 日より前に終わったものは渡さない
        self.assertNotIn('クリスマスクッキー缶', text.split('<ended', 1)[1])  # 発売日だけの予定は、そのあとも売っているので終わった扱いにしない
        self.assertIn('<ended>', piyo.GREETING_PROMPT)


if __name__ == '__main__':
    unittest.main()
