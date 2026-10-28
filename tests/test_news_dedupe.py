import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from fetch_news import article_key, clean_title, dedupe, merge, official_title, parse_official


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


class AuditFixTests(unittest.TestCase):
    """2026-10-28 の点検で見つかった見出し・重複・関連リンクの直し。"""

    def test_official_labels_and_read_more_removed(self):
        self.assertEqual(official_title('店舗 限定商品 お知らせ 静岡県三島市の「三島甘藷ぴよりん」が販売！ 記事を見る'),
                         '静岡県三島市の「三島甘藷ぴよりん」が販売！')
        self.assertEqual(official_title('おでかけ情報 ぴよりんが山口県へ初めてのおでかけ！'), 'ぴよりんが山口県へ初めてのおでかけ！')
        self.assertEqual(official_title('NEW「ぴよりん」新商品'), '「ぴよりん」新商品')
        self.assertEqual(official_title('お知らせ'), 'お知らせ')  # 札だけの短い見出しは消さない

    def test_parse_official_uses_title_element(self):
        page = """<a href="https://piyorin.com/news/p5653/" class="news-pickup__box"><div class="meta">
          <p class="date">2026.10.26</p><p class="cate"><span>お知らせ</span></p></div>
          <p class="title">2027年版「ぴよりんカレンダー」が今年も登場！</p><p class="btn"><span>記事を見る</span></p></a>"""
        items = parse_official(page)
        self.assertEqual([(i['date'], i['title']) for i in items], [('2026-10-26', '2027年版「ぴよりんカレンダー」が今年も登場！')])

    def test_official_and_press_with_same_headline_merge_without_copying_judgment(self):
        official = dict(article('official-p1', '店舗 お知らせ 「三島甘藷ぴよりん」が期間限定で販売！ 記事を見る',
                                'https://piyorin.com/news/p1/'), cat='official', source='ぴよりん公式サイト')
        press = dict(article('press', '「三島甘藷ぴよりん」が期間限定で販売！',
                             'https://prtimes.jp/main/html/rd/p/000000252.000124425.html', jg={'ok': False}),
                     cat='press', source='PR TIMES')
        result = dedupe([press, official])
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]['id'], result[0]['title']), ('official-p1', '「三島甘藷ぴよりん」が期間限定で販売！'))
        self.assertEqual(result[0]['merged_ids'], ['press'])
        self.assertNotIn('jg', result[0])

    def test_fashion_press_gallery_and_photo_number_prefix(self):
        self.assertEqual(clean_title('写真3/3｜ひよこ型スイーツ「ぴよりんゴジラ」'), 'ひよこ型スイーツ「ぴよりんゴジラ」')
        self.assertEqual(article_key('https://www.fashion-press.net/news/gallery/152337/2575500'),
                         article_key('https://www.fashion-press.net/news/152337'))
        photos = [article(str(i), f'写真{i}/3｜ひよこ型スイーツ「ぴよりんゴジラ」',
                          f'https://www.fashion-press.net/news/gallery/152337/257550{i}') for i in (1, 2, 3)]
        self.assertEqual(len(dedupe(photos)), 1)

    def test_media_suffix_removed_and_matched(self):
        self.assertEqual(clean_title('「ぴよりんカレンダー」が今年も登場！｜Infoseekニュース'), '「ぴよりんカレンダー」が今年も登場！')
        self.assertEqual(clean_title('ぴよりん｜新商品のお知らせ'), 'ぴよりん｜新商品のお知らせ')  # 普通の「｜」は残す
        result = dedupe([article('a', '「ぴよりんカレンダー」が今年も登場！', 'https://example.com/a'),
                         article('b', '「ぴよりんカレンダー」が今年も登場！ | 名駅経済新聞', 'https://example.com/b')])
        self.assertEqual(len(result), 1)

    def test_truncated_headline_joins_near_complete_one(self):
        full = article('full', '2027年版「ぴよりんカレンダー」が今年も登場！ぴよりんの愛らしい姿を再現', 'https://example.com/full')
        cut = dict(article('cut', '2027年版「ぴよりんカレンダー」が今年も登場！ぴよりんの愛らしい ...', 'https://example.com/cut'),
                   date='2026-10-25')
        far = dict(article('far', '2027年版「ぴよりんカレンダー」が今年も登場！ぴよりん ...', 'https://example.com/far'),
                   date='2026-08-01')
        short = article('short', 'ぴよりん ...', 'https://example.com/short')
        result = dedupe([cut, full, far, short])
        self.assertEqual(len(result), 3)
        joined = next(r for r in result if r['id'] in ('full', 'cut'))
        self.assertEqual(joined['title'], full['title'])
        self.assertEqual({joined['id'], *joined['merged_ids']}, {'full', 'cut'})

    def test_google_relay_of_same_media_not_listed_as_another_link(self):
        main = article('main', 'ぴよりんがゴジラに', 'https://news.mynavi.jp/article/1/')
        main['source'] = 'マイナビニュース'
        main['related'] = [{'source': 'マイナビニュース', 'url': 'https://news.google.com/rss/articles/OLD'},
                           {'source': '別の媒体', 'url': 'https://news.google.com/rss/articles/OTHER'}]
        result = dedupe([main])[0]
        self.assertEqual(result['related'], [{'source': '別の媒体', 'url': 'https://news.google.com/rss/articles/OTHER'}])
        incoming = dict(article('x', 'ぴよりんがゴジラに', 'https://news.google.com/rss/articles/NEW'), source='マイナビニュース')
        incoming.pop('id')
        merged, added = merge([result], [incoming])
        self.assertEqual((added, merged[0]['related']), (0, result['related']))


if __name__ == '__main__':
    unittest.main()
