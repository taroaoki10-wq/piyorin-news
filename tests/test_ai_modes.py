"""Claude の呼び方の切りかえ（2026-11-22）：API・定額の Claude Code・Claude を使わない。"""
import json
import os
import stat
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_piyo as piyo
import claude_call
import extract_events as ev

TOOL = {"name": "save_events", "input_schema": {"type": "object", "properties": {"events": {"type": "array"}}}}
PAYLOAD = {"model": "m", "max_tokens": 100, "system": "予定を抜き出す", "tools": [TOOL],
           "tool_choice": {"type": "tool", "name": "save_events"}, "messages": [{"role": "user", "content": "<article n=\"0\">本文</article>"}]}


def fake_claude(body: str) -> str:
    """claude の代わりに動く小さなスクリプト（引数と入力を控えて、決まった答えを返す）。"""
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'claude')
    with open(p, 'w', encoding='utf-8') as f:
        f.write('#!/usr/bin/env python3\nimport sys,json,os\n'
                f'open({os.path.join(d, "seen.json")!r},"w").write(json.dumps({{"argv":sys.argv[1:],"stdin":sys.stdin.read(),'
                '"key":os.environ.get("ANTHROPIC_API_KEY","")}))\n' + body)
    os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
    return p


class ModeTests(unittest.TestCase):
    def test_mode_comes_from_env_then_file_then_api(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'ai_mode.txt'
            with patch.object(claude_call, 'MODE_FILE', f):
                with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'k'}, clear=True):
                    self.assertEqual((claude_call.mode(), claude_call.api_key()), ('api', 'k'))  # ファイルが無ければ前と同じ
                    f.write_text('# 説明の行\nnone\n', encoding='utf-8')
                    self.assertEqual((claude_call.mode(), claude_call.api_key()), ('none', ''))  # キーがあっても使わない
                    f.write_text('へんな値\n', encoding='utf-8')
                    self.assertEqual(claude_call.mode(), 'api')
                with patch.dict(os.environ, {'PIYO_AI': 'cli', 'ANTHROPIC_API_KEY': 'k'}, clear=True):
                    self.assertEqual((claude_call.mode(), claude_call.api_key()), ('cli', 'cli'))  # 環境変数が先

    def test_repo_default_keeps_the_api(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(claude_call.mode(), 'api')  # scripts/ai_mode.txt の今の値。切りかえはユーザーが決める


class CliTests(unittest.TestCase):
    def test_cli_answer_is_returned_in_the_api_shape_without_tools_or_api_key(self):
        exe = fake_claude('print(json.dumps({"is_error":False,"structured_output":{"events":[{"article":0,"title":"みかん"}]},'
                          '"usage":{"input_tokens":12,"output_tokens":3}}))\n')
        with patch.dict(os.environ, {'PIYO_CLAUDE_BIN': exe, 'ANTHROPIC_API_KEY': 'secret'}):
            res = claude_call.send(PAYLOAD, 'cli')
        self.assertEqual(res['content'][0], {"type": "tool_use", "name": "save_events",
                                             "input": {"events": [{"article": 0, "title": "みかん"}]}})
        self.assertEqual(res['usage'], {"input_tokens": 12, "output_tokens": 3})
        seen = json.load(open(os.path.join(os.path.dirname(exe), 'seen.json')))
        a = seen['argv']
        self.assertEqual(seen['key'], '')  # API キーは渡さない（定額のログインで動かす）
        self.assertIn('<article n="0">本文</article>', seen['stdin'])
        self.assertEqual(a[a.index('--tools') + 1], '')  # 道具は使わせない
        self.assertIn('--strict-mcp-config', a)
        self.assertEqual(json.loads(a[a.index('--json-schema') + 1]), TOOL['input_schema'])
        self.assertIn('予定を抜き出す', a[a.index('--system-prompt') + 1])

    def test_cli_text_answer_and_errors(self):
        exe = fake_claude('print(json.dumps({"is_error":False,"result":"```json\\n{\\"events\\":[]}\\n```"}))\n')
        with patch.dict(os.environ, {'PIYO_CLAUDE_BIN': exe}):
            self.assertEqual(claude_call.send(PAYLOAD, 'cli')['content'][0]['input'], {"events": []})
        exe = fake_claude('print(json.dumps({"is_error":True,"result":"Failed to authenticate"}))\n')
        with patch.dict(os.environ, {'PIYO_CLAUDE_BIN': exe}):
            with self.assertRaisesRegex(RuntimeError, 'Failed to authenticate'):  # ログイン切れは失敗として上へ（記事は次回読み直す）
                claude_call.send(PAYLOAD, 'cli')


class RuleTests(unittest.TestCase):
    def test_rule_read_articles_are_reread_only_when_claude_is_available(self):
        want = 'v3 https://piyorin.com/news/p1/'
        self.assertTrue(ev.finished(want, want, True))
        self.assertTrue(ev.finished(want, want, False))
        self.assertFalse(ev.finished(want + ev.RULE_MARK, want, True))   # Claude で読める回は読み直す
        self.assertTrue(ev.finished(want + ev.RULE_MARK, want, False))   # 使わない回は読み直さない
        self.assertFalse(ev.finished(None, want, False))
        self.assertFalse(ev.finished('v2 x', want, False))

    def test_rule_extraction_reads_period_and_place_without_claude(self):
        art = {'id': 'official-p5657', 'date': '2026-10-29', 'url': 'https://piyorin.com/news/p5657/',
               'title': 'アスティ静岡開業35周年を記念して「静岡みかんぴよりんおでかけセット」を期間限定販売！'}
        lines = ['「ぴよりん」は、2026年11月26日(木)・27日(金)の2日間限定で アスティ静岡 にて販売いたします。',
                 '販売場所：アスティ静岡 西館']
        got = ev.extract(art, lines)
        self.assertEqual((got['start'], got['end'], got['title'], got['place'], got['kind']),
                         ('2026-11-26', '2026-11-27', '静岡みかんぴよりんおでかけセット', 'アスティ静岡 西館', 'sale'))

    def test_claude_greeting_is_kept_for_36_hours_in_none_mode(self):
        from datetime import datetime, timedelta, timezone
        jst = timezone(timedelta(hours=9))
        now = datetime(2026, 11, 22, 18, 0, tzinfo=jst)
        g = {"v": 6, "at": "2026-11-22T16:33+09:00", "lines": ["最近のぴよりんニュースだぴよ！"]}
        self.assertTrue(piyo.claude_greeting_is_fresh(g, now))
        self.assertFalse(piyo.claude_greeting_is_fresh(g, now + timedelta(hours=40)))   # Mac が止まったら控えが作る
        self.assertFalse(piyo.claude_greeting_is_fresh({**g, "by": "rule"}, now))        # 決まった文のまとめは作り直してよい
        self.assertFalse(piyo.claude_greeting_is_fresh({}, now))
        self.assertFalse(piyo.claude_greeting_is_fresh({**g, "at": "こわれた"}, now))

    def test_rule_greeting_lists_only_live_and_coming_events(self):
        events = [
            {'title': 'ぴよりんゴジラ販売', 'start': '2026-11-03', 'end': '2026-11-13', 'kind': 'sale'},
            {'title': '推し旅×ぴよりん', 'start': '2026-10-02', 'end': '2026-11-30', 'kind': 'campaign'},
            {'title': '三島甘藷ぴよりん販売', 'start': '2026-11-15', 'end': '2026-11-23', 'kind': 'sale'},
            {'title': '静岡みかんぴよりんおでかけセット販売（アスティ静岡）', 'start': '2026-11-26', 'end': '2026-11-27',
             'place': 'アスティ静岡', 'kind': 'sale'},
            {'title': 'ぴよりん2026 クリスマスクッキー缶 販売開始', 'start': '2026-11-20', 'end': '2026-11-20', 'kind': 'release'},
            {'title': 'ぴよりんクリスマスケーキ 受取期間', 'start': '2026-12-19', 'end': '2026-12-25', 'kind': 'sale'},
        ]
        with patch.object(piyo, 'today_jst', return_value=date(2026, 11, 22)), patch.object(piyo, 'load_json', return_value={}):
            g = piyo.rule_greeting(events)
            self.assertEqual(g['lines'], [
                '最近のぴよりんニュースだぴよ！',
                '・三島甘藷ぴよりん販売は**11月15日から23日まで**だぴよ',
                '・静岡みかんぴよりんおでかけセット販売（アスティ静岡）は**11月26日から27日まで**だぴよ',
                '・ぴよりんクリスマスケーキ 受取期間は**12月19日から25日まで**だぴよ',
                '・推し旅×ぴよりんは**10月2日から11月30日まで**だぴよ',   # 期間の長い開催中の企画は後ろ
            ])
            self.assertNotIn('ゴジラ', ''.join(g['lines']))  # 終わった販売は入らない
            self.assertEqual((g['by'], g['v']), ('rule', piyo.GREETING_VERSION))
            self.assertEqual(g['suggest'][1], '静岡みかんぴよりんおでかけセ' + 'について')
        with patch.object(piyo, 'today_jst', return_value=date(2026, 11, 22)), \
                patch.object(piyo, 'load_json', return_value={'basis': g['basis']}):
            self.assertIsNone(piyo.rule_greeting(events))  # 予定が変わらなければ作り直さない


if __name__ == '__main__':
    unittest.main()
