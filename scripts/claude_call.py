"""Claude の呼び方を 1 か所で切りかえる（2026-11-22。目的は API のトークンの節約）。

呼び方（mode）は 3 つ：
  api  … Claude API（GitHub の Secrets の ANTHROPIC_API_KEY。使った分だけ料金）
  cli  … 定額の Claude（Mac の Claude Code を `claude -p` で呼ぶ。scripts/update_local.py が使う）
  none … Claude を使わない（日付の見出しのパターンと決まった文で作る。料金 0）

決め方：環境変数 PIYO_AI があればそれ。無ければ scripts/ai_mode.txt の 1 行（GitHub Actions の定期の更新はこれを読む）。
どちらも無ければ api（前と同じ動き）。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

API_URL = "https://api.anthropic.com/v1/messages"
MODES = ("api", "cli", "none")
MODE_FILE = Path(__file__).resolve().parent / "ai_mode.txt"
CLI_MODEL = os.environ.get("PIYO_CLI_MODEL") or "haiku"  # 定額でも使用量を小さくするため、軽いモデルで読む


def mode() -> str:
    m = os.environ.get("PIYO_AI", "").strip().lower()
    if m not in MODES:
        try:
            m = next((ln.strip().lower() for ln in MODE_FILE.read_text(encoding="utf-8").splitlines()
                      if ln.strip() and not ln.startswith("#")), "")
        except OSError:
            m = ""
    return m if m in MODES else "api"


def api_key() -> str:
    """各スクリプトが「Claude を使えるか」を決める値。none なら空（使わない）、cli なら "cli"、api なら API キー。"""
    m = mode()
    if m == "none":
        return ""
    if m == "cli":
        return "cli"
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def _json_from(text: str):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.S)
        return json.loads(m.group(0)) if m else None


def send_cli(payload: dict, timeout: int = 180) -> dict:
    """定額の Claude Code に同じ頼みを渡し、API と同じ形（tool_use の入力）で返す。道具・MCP・コマンドは使わせない。"""
    tool = payload["tools"][0]
    user = "\n\n".join(m["content"] for m in payload["messages"] if isinstance(m.get("content"), str))
    system = (payload.get("system", "") + "\n\n答えは、決められた形（JSON スキーマ）の JSON だけで返してください。"
              f"「{tool['name']} ツールで答える」と書かれている所は、その入力の JSON を返すという意味です。")
    cmd = [os.environ.get("PIYO_CLAUDE_BIN") or "claude", "-p", "--model", CLI_MODEL, "--output-format", "json",
           "--json-schema", json.dumps(tool["input_schema"], ensure_ascii=False), "--system-prompt", system,
           "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}  # API キーがあっても定額のログインで動かす
    with tempfile.TemporaryDirectory() as cwd:  # 何も無いフォルダで動かす（このリポジトリのファイルを読ませない）
        run = subprocess.run(cmd, input=user, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env)
    try:
        out = json.loads(run.stdout)
    except ValueError:
        raise RuntimeError(f"claude の答えを読めません: {(run.stdout or run.stderr)[:200]}")
    if out.get("is_error"):
        raise RuntimeError(f"claude が失敗: {str(out.get('result'))[:200]}")
    data = out.get("structured_output")
    if not isinstance(data, dict):
        data = _json_from(out.get("result") if isinstance(out.get("result"), str) else "")
    if not isinstance(data, dict):
        raise RuntimeError("claude の答えが決められた形ではありません")
    u = out.get("usage") or {}
    return {"content": [{"type": "tool_use", "name": tool["name"], "input": data}], "stop_reason": "tool_use",
            "usage": {"input_tokens": u.get("input_tokens", 0), "output_tokens": u.get("output_tokens", 0)}, "by": "cli"}


def send(payload: dict, key: str, timeout: int = 90) -> dict:
    """Claude に頼みを送り、API の答えの形で返す。key が "cli" なら定額の Claude Code、ほかは API。"""
    if key == "cli":
        return send_cli(payload, max(timeout, 180))
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode("utf-8"),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)
