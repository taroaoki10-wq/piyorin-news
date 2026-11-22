"""Mac で更新する道具：push していないデータのコミットの片づけ（2026-11-22）。
「手元だけ」で試したあとや、ほかの更新とぶつかったあとに、次の回が止まらないようにする。"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import update_local  # noqa: E402


def run(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
                          cwd=cwd, text=True, capture_output=True, check=True)


class DropOwnCommits(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        run(base, "init", "-q", "--bare", "-b", "main", "origin.git")
        run(base, "clone", "-q", "origin.git", "work")
        self.work = base / "work"
        (self.work / "docs" / "data").mkdir(parents=True)
        (self.work / "docs" / "data" / "news.json").write_text("[]", encoding="utf-8")
        run(self.work, "add", "-A")
        run(self.work, "commit", "-q", "-m", "はじめ")
        run(self.work, "push", "-q", "-u", "origin", "main")
        self.root = update_local.ROOT
        update_local.ROOT = self.work

    def tearDown(self):
        update_local.ROOT = self.root
        self.tmp.cleanup()

    def commit(self, subject, text):
        (self.work / "docs" / "data" / "news.json").write_text(text, encoding="utf-8")
        run(self.work, "commit", "-q", "-am", subject)

    def ahead(self):
        return run(self.work, "log", "--format=%s", "@{u}..HEAD").stdout.split("\n")[:-1]

    def test_道具のデータのコミットだけなら捨てる(self):
        self.commit("ニュース・予定更新 2026-11-22 16:33（Mac・定額の Claude）", "[1]")
        self.commit("ニュース・予定更新 2026-11-22 19:33（Mac・Claude なし）", "[2]")
        self.assertTrue(update_local.drop_own_commits())
        self.assertEqual(self.ahead(), [])
        self.assertEqual((self.work / "docs" / "data" / "news.json").read_text(encoding="utf-8"), "[]")

    def test_ほかのコミットが混じっていたら何もしない(self):
        self.commit("ニュース・予定更新 2026-11-22 16:33（Mac・定額の Claude）", "[1]")
        self.commit("画面を直す", "[2]")
        self.assertFalse(update_local.drop_own_commits())
        self.assertEqual(len(self.ahead()), 2)

    def test_進んでいなければ何もしない(self):
        self.assertFalse(update_local.drop_own_commits())

    def test_書きかけのほかのファイルは残す(self):
        self.commit("ニュース・予定更新 2026-11-22 16:33（Mac・定額の Claude）", "[1]")
        (self.work / "memo.txt").write_text("書きかけ", encoding="utf-8")
        self.assertTrue(update_local.drop_own_commits())
        self.assertEqual((self.work / "memo.txt").read_text(encoding="utf-8"), "書きかけ")


if __name__ == "__main__":
    unittest.main()
