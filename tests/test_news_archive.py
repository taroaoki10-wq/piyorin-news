import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_news
from news_store import read_news, write_news


def article(i, date="2026-10-25"):
    return {"id": f"article-{i}", "date": date, "title": f"ぴよりん記事 {i}",
            "cat": "media", "source": "テスト", "url": f"https://example.com/{i}",
            "related": [], "jg": {"ok": True, "v": 1}}


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)

    def test_overflow_keeps_every_article_and_metadata(self):
        items = [article(i) for i in range(500)] + [article(500, "2014-11-09"), article(501, "2015-01-01")]
        items[-1]["jg"]["ok"] = False
        items[-1]["related"] = [{"url": "https://example.com/other", "source": "別媒体"}]
        write_news(self.data, items)
        self.assertEqual(len(json.loads((self.data / "news.json").read_text())), 500)
        self.assertEqual(json.loads((self.data / "archive/index.json").read_text()), {"years": ["2015", "2014"], "count": 2})
        self.assertEqual({n["id"]: n for n in read_news(self.data)}, {n["id"]: n for n in items})

    def test_repeated_collection_does_not_readd_archived_url(self):
        items = [article(i) for i in range(501)]
        write_news(self.data, items)
        incoming = copy.deepcopy(items[-1]); incoming.pop("id")
        merged, added = fetch_news.merge(read_news(self.data), [incoming])
        self.assertEqual(added, 0)
        write_news(self.data, merged)
        self.assertEqual(len(read_news(self.data)), 501)

    def test_storage_does_not_discard_existing_same_id_titles(self):
        a = article(0)
        b = copy.deepcopy(a); b["title"] = "別の見出し"
        write_news(self.data, [a, b], limit=1)
        self.assertCountEqual(read_news(self.data), [a, b])

    def test_new_article_older_than_cutoff_is_still_saved(self):
        existing = [article(i) for i in range(500)]
        incoming = article(999, "2010-01-01"); incoming.pop("id")
        merged, added = fetch_news.merge(existing, [incoming])
        self.assertEqual((len(merged), added), (501, 1))
        write_news(self.data, merged)
        self.assertEqual(read_news(self.data)[0]["url"], incoming["url"])

    def test_date_correction_can_move_article_out_of_archive(self):
        items = [article(i) for i in range(500)] + [article(500, "2014-11-09")]
        write_news(self.data, items)
        loaded = read_news(self.data)
        next(n for n in loaded if n["id"] == "article-500")["date"] = "2026-10-26"
        write_news(self.data, loaded)
        self.assertEqual(json.loads((self.data / "news.json").read_text())[0]["id"], "article-500")
        self.assertFalse((self.data / "archive/2014.json").exists())
        self.assertEqual(len(read_news(self.data)), 501)

    def test_current_judgment_wins_if_files_overlap(self):
        write_news(self.data, [article(0), article(1)], limit=1)
        current = article(1); current["jg"]["ok"] = False
        (self.data / "news.json").write_text(json.dumps([current]))
        self.assertFalse(read_news(self.data)[0]["jg"]["ok"])

    def test_failed_archive_write_does_not_truncate_current_file(self):
        old = [article(i) for i in range(501)]
        before = json.dumps(old)
        (self.data / "news.json").write_text(before)
        with patch("news_store.write_json", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                write_news(self.data, old)
        self.assertEqual((self.data / "news.json").read_text(), before)

    def test_missing_archive_stops_update_before_fetching(self):
        write_news(self.data, [article(0), article(1)], limit=1)
        (self.data / "archive/2026.json").unlink()
        with patch.object(fetch_news, "DATA", self.data), patch.object(fetch_news, "collect") as collect:
            with self.assertRaises(FileNotFoundError):
                fetch_news.main()
            collect.assert_not_called()

    def test_missing_index_does_not_ignore_existing_archive(self):
        write_news(self.data, [article(0), article(1)], limit=1)
        (self.data / "archive/index.json").unlink()
        with self.assertRaises(FileNotFoundError):
            read_news(self.data)


if __name__ == "__main__":
    unittest.main()
