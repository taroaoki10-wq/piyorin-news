import hashlib
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_piyo as piyo


class PiyoToneTests(unittest.TestCase):
    def test_shared_examples_and_idempotence(self):
        cases = json.loads(Path(__file__).with_name('piyo-tone-cases.json').read_text(encoding='utf-8'))
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(piyo.piyo_tone(text), expected)
                self.assertEqual(piyo.piyo_tone(expected), expected)

    def test_generated_greeting_lines_are_corrected_but_suggestions_are_preserved(self):
        response = ({'lines': ['運行します。', '・発売しました。'], 'suggest': ['買えますか？']}, {'output_tokens': 10})
        with patch('urllib.request.urlopen', side_effect=AssertionError('network forbidden')), \
                patch.object(piyo, 'load_json', return_value={}), \
                patch.object(piyo, 'call_tool', return_value=response) as call:
            result, usage = piyo.build_greeting({}, [], 'fake-test-key')
        self.assertEqual(result['v'], 5)
        self.assertEqual(result['lines'], ['運行するぴよ。', '・発売しました。'])
        self.assertEqual(result['suggest'], ['買えますか？'])
        self.assertEqual(usage, {'output_tokens': 10})
        self.assertEqual(call.call_args[0][0], piyo.GREETING_PROMPT)

    def test_previous_version_rebuilds_once_and_current_version_is_reused(self):
        text = '<today>2026-10-26</today>'
        old_basis = hashlib.sha1(f'3\n{piyo.MODEL}\n{text}'.encode()).hexdigest()[:16]
        response = ({'lines': ['休みです。', '発売しました。'], 'suggest': []}, {})
        with patch('urllib.request.urlopen', side_effect=AssertionError('network forbidden')), \
                patch.object(piyo, 'greeting_input', return_value=text), \
                patch.object(piyo, 'load_json', return_value={'basis': old_basis}), \
                patch.object(piyo, 'call_tool', return_value=response) as call:
            result, _ = piyo.build_greeting({}, [], 'fake-test-key')
            call.assert_called_once()
        with patch.object(piyo, 'load_json', return_value=result), \
                patch.object(piyo, 'greeting_input', return_value=text), \
                patch.object(piyo, 'call_tool', side_effect=AssertionError('API forbidden')):
            self.assertEqual(piyo.build_greeting({}, [], 'fake-test-key'), (None, {}))


if __name__ == '__main__':
    unittest.main()
