import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from fetch_news import article_key, clean_title, dedupe, merge


def article(id, title, url, **extra):
    return dict(id=id, title=title, url=url, date='2026-10-22',
                cat='media', source='テスト媒体', related=[], **extra)


class PhotoDedupeTests(unittest.TestCase):
    def test_photo_labels_removed_without_removing_dates(self):
        for title in ['【画像】ぴよりん 2/24', '画像・写真 | ぴよりん 15枚目',
                      '写真・図版（1枚目）| ぴよりん', '＜画像3 / 8＞ぴよりん']:
            self.assertEqual(clean_title(title), 'ぴよりん')
        self.assertEqual(clean_title('ぴよりん発売 10/24'), 'ぴよりん発売 10/24')
        self.assertEqual(clean_title('写真展「ぴよりん」'), '写真展「ぴよりん」')

    def test_caption_and_headline_same_article(self):
        items = [article('a', '画像・写真 | ぴよりんゴジラが登場 1枚目',
                         'https://www.oricon.co.jp/news/2488179/photo/1/'),
                 article('b', 'ぴよりんグッズ （13/20枚）',
                         'https://www.oricon.co.jp/news/2488179/photo/13/?anc=1')]
        result = dedupe(items)
        self.assertEqual(len(result), 1)
        self.assertEqual(set([result[0]['id']] + result[0]['merged_ids']), {'a', 'b'})
        self.assertEqual(len(result[0]['related']), 1)

    def test_regular_article_priority_preserves_id_and_judgment(self):
        photo = article('photo', '【画像】ぴよりん 1/2',
                        'https://news.livedoor.com/article/image_detail/123/?img_id=1', jg={'ok': True})
        main = article('main', 'ぴよりん',
                       'https://news.livedoor.com/article/detail/123/', jg={'ok': False})
        result = dedupe([photo, main])[0]
        self.assertEqual(result['id'], 'main')
        self.assertEqual(result['jg'], {'ok': False})
        self.assertEqual(result['merged_ids'], ['photo'])
        self.assertEqual(result['related'][0]['url'], photo['url'])

    def test_exact_url_different_titles(self):
        result = dedupe([article('same', '短い見出し', 'https://example.com/1'),
                         article('same', '同じ記事の長い見出し', 'https://example.com/1')])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 'same')
        self.assertEqual(result[0]['related'], [])

    def test_unknown_photo_and_other_article_not_collapsed(self):
        urls = ['https://example.com/photo/1', 'https://example.com/photo/2',
                'https://www.oricon.co.jp/news/1/photo/1/',
                'https://www.oricon.co.jp/news/2/photo/1/']
        items = [article(str(i), 'ぴよりん記事' + str(i), url) for i, url in enumerate(urls)]
        self.assertEqual(len(dedupe(items)), 4)
        self.assertEqual(article_key(urls[0]), urls[0])

    def test_known_photo_paths_match_article_but_not_similar_host(self):
        for photo, main in [
            ('https://www.sankei.com/article/20261022-ABC/photo/XYZ/', 'https://www.sankei.com/article/20261022-ABC/'),
            ('https://dot.asahi.com/articles/photo/295434', 'https://dot.asahi.com/articles/-/295434'),
        ]:
            self.assertEqual(article_key(photo), article_key(main))
        fake = 'https://news.livedoor.com.example.com/article/image_detail/123/'
        self.assertEqual(article_key(fake), fake)

    def test_transitive_group_retains_all_links_and_old_ids(self):
        a = article('a', '共通の見出し', 'https://example.com/a', merged_ids=['old'])
        b = article('b', '別の見出し', 'https://www.oricon.co.jp/news/1/full/')
        c = article('c', '共通の見出し', 'https://www.oricon.co.jp/news/1/photo/2/')
        result = dedupe([a, b, c])
        self.assertEqual(len(result), 1)
        self.assertEqual({result[0]['id'], *result[0]['merged_ids']}, {'a', 'b', 'c', 'old'})
        self.assertEqual({result[0]['url'], *(r['url'] for r in result[0]['related'])}, {a['url'], b['url'], c['url']})
        self.assertEqual(dedupe(result), result)

    def test_recollection_retains_representative_and_does_not_readd_photo(self):
        main = article('keep-me', '元のぴよりん記事', 'https://www.oricon.co.jp/news/1/full/')
        incoming = article('unused', '別の写真説明', 'https://www.oricon.co.jp/news/1/photo/99/')
        incoming.pop('id')
        original = copy.deepcopy(main)
        result, added = merge([main], [incoming, incoming])
        self.assertEqual(added, 0)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 'keep-me')
        self.assertEqual(len(result[0]['related']), 1)
        self.assertEqual(main, original)
        self.assertEqual(merge(result, [incoming])[0], result)

    def test_incoming_bridge_joins_existing_groups(self):
        a = article('a', '写真の見出し', 'https://www.oricon.co.jp/news/1/full/')
        b = article('b', '本来の見出し', 'https://example.com/b')
        incoming = article('unused', '本来の見出し', 'https://www.oricon.co.jp/news/1/photo/2/')
        incoming.pop('id')
        result, added = merge([a, b], [incoming])
        self.assertEqual((len(result), added), (1, 0))
        self.assertEqual({result[0]['id'], *result[0]['merged_ids']}, {'a', 'b'})

    def test_regular_page_preferred_over_comment_page(self):
        result = dedupe([
            article('comment', 'コメント | ぴよりん', 'https://www.oricon.co.jp/news/1/comment/'),
            article('full', 'ぴよりん', 'https://www.oricon.co.jp/news/1/full/'),
        ])
        self.assertEqual(result[0]['id'], 'full')

    def test_full_title_restored_without_changing_original_id(self):
        old = article('old', 'ぴよりんグッズ ...', 'https://example.com/a')
        new = article('new', 'ぴよりんグッズが発売される', 'https://example.com/a')
        new['date'] = '2026-10-23'
        result = dedupe([old, new])[0]
        self.assertEqual(result['id'], 'old')
        self.assertEqual(result['title'], new['title'])


if __name__ == '__main__':
    unittest.main()
