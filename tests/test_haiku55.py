"""データ作りの自動更新を Haiku 5.5 に替えた（2026-10-29）。モデル・答えの長さの上限・考えた部分を読まないこと・途中で止まったときの記録。"""
import io
import json
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_piyo  # noqa: E402
import claude_events  # noqa: E402
import judge_relevance  # noqa: E402


class FakeResponse:
    def __init__(self, obj):
        self.body = json.dumps(obj).encode("utf-8")

    def read(self, *args):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def answer(name, data, stop="tool_use"):
    # Haiku 5.5 は考える部分（thinking）が先に来ることがある。道具を決めて呼ぶと来ないが、来ても読み飛ばす
    return {"content": [{"type": "thinking", "thinking": "", "signature": "s"}, {"type": "tool_use", "name": name, "input": data}],
            "stop_reason": stop, "usage": {"input_tokens": 10, "output_tokens": 5}}


class Haiku55Tests(unittest.TestCase):
    def call(self, fn, response):
        sent = []

        def fake_urlopen(req, timeout=None):
            sent.append(json.loads(req.data.decode("utf-8")))
            return FakeResponse(response)

        err = io.StringIO()
        with patch("urllib.request.urlopen", side_effect=fake_urlopen), redirect_stderr(err):
            out = fn()
        return sent[0], out, err.getvalue()

    def test_every_call_uses_haiku_55_with_a_forced_tool(self):
        self.assertEqual(claude_events.MODEL, "claude-haiku-5-5")
        sent, (got, _), _ = self.call(lambda: build_piyo.call_tool("指示", {"name": "save_memos", "input_schema": {}}, "本文", 700, "fake-test-key"),
                                      answer("save_memos", {"memos": [{"n": 0, "memo": "メモ"}]}))
        self.assertEqual(sent["model"], "claude-haiku-5-5")
        self.assertEqual(sent["tool_choice"], {"type": "tool", "name": "save_memos"})
        for key in ("temperature", "top_p", "top_k", "thinking"):
            self.assertNotIn(key, sent)  # Haiku 5.5 では送らない
        self.assertEqual(got, {"memos": [{"n": 0, "memo": "メモ"}]})

    def test_events_and_judgments_skip_thinking_blocks(self):
        item = {"title": "ぴよりんの新作", "date": "2026-10-29", "id": "x"}
        sent, (found, _), _ = self.call(lambda: claude_events.claude_events_batch([(item, "11月3日〜13日に販売")], "fake-test-key"),
                                        answer("save_events", {"events": []}))
        self.assertEqual(sent["max_tokens"], 600 + 350)
        self.assertEqual(found, {0: []})
        sent, (judged, _), _ = self.call(lambda: judge_relevance.judge_batch([{"title": "ぴよりんの新作"}], "fake-test-key"),
                                         answer("save_judgments", {"judgments": [{"n": 0, "ok": True, "why": "ぴよりんの記事"}]}))
        self.assertEqual(sent["max_tokens"], 400 + 120)
        self.assertEqual(judged, {0: (True, "ぴよりんの記事")})

    def test_stopped_answers_are_logged_and_give_nothing(self):
        refused = {"content": [], "stop_reason": "refusal", "usage": {}}
        _, (got, _), err = self.call(lambda: build_piyo.call_tool("指示", {"name": "save_memos", "input_schema": {}}, "本文", 700, "fake-test-key"), refused)
        self.assertEqual(got, {})
        self.assertIn("ぴよのメモとまとめ: 答えが途中で止まりました（refusal）", err)
        _, _, err = self.call(lambda: judge_relevance.judge_batch([{"title": "t"}], "fake-test-key"), dict(refused, stop_reason="max_tokens"))
        self.assertIn("関連判定: 答えが途中で止まりました（max_tokens）", err)


if __name__ == "__main__":
    unittest.main()
