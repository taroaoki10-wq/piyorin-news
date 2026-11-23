#!/usr/bin/env python3
"""Mac の定額の Claude（Claude Code）で、ニュースと予定を更新する（2026-11-22。API のトークンを使わない）。

GitHub Actions の定期の更新と同じ順でスクリプトを動かし、Claude の読み取りだけを `claude -p`（定額）に回す。
できた docs/data をコミットして push する（Actions の bot と同じく、データだけ）。

使い方：
  python3 scripts/update_local.py            更新して push
  python3 scripts/update_local.py --no-push  更新だけ（push しない。中身を見るとき）
  python3 scripts/update_local.py --none     Claude を使わない読み取りで更新（料金も使用量も 0）
先に、ターミナルの Claude Code でログインしておく（`claude auth login`）。
"""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STEPS = ["fetch_news.py", "extract_events.py", "build_reader.py", "learn_deletions.py", "judge_relevance.py", "build_piyo.py",
         "build_ics.py", "build_koyomi.py", "build_images.py"]
OPTIONAL = {"build_images.py", "learn_deletions.py"}  # Actions でも失敗してよい段


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=check)


OWN = "ニュース・予定更新 "


def drop_own_commits() -> bool:
    """まだ push していないコミットが、この道具のデータのコミットだけなら捨てる（ほかのコミットが混じっていたら何もしない）。"""
    if git("fetch", "-q", check=False).returncode:
        return False
    ahead = [x for x in git("log", "--format=%s", "@{u}..HEAD", check=False).stdout.splitlines() if x.strip()]
    if not ahead or not all(x.startswith(OWN) and "（Mac・" in x for x in ahead):
        return False
    return not git("reset", "-q", "--keep", "@{u}", check=False).returncode


def main(argv: list[str]) -> int:
    push = "--no-push" not in argv
    env = dict(os.environ, PIYO_AI="none" if "--none" in argv else "cli")
    if git("status", "--porcelain", "--", "docs/data").stdout.strip():
        print("docs/data に書きかけの変更があります。先に片づけてください。", file=sys.stderr)
        return 1
    drop_own_commits()  # 前の回の「手元だけ」や、ぶつかって push できなかったデータのコミットを片づける（作り直せる物）
    if git("pull", "--rebase", "--autostash", "-q", check=False).returncode:
        print("最新を取り込めませんでした（git pull）。", file=sys.stderr)
        return 1
    for step in STEPS:
        print(f"== {step}", flush=True)
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / step)], cwd=ROOT, env=env)
        if r.returncode and step not in OPTIONAL and step != "fetch_news.py":
            print(f"{step} が失敗しました（終了コード {r.returncode}）。ここで止めます。", file=sys.stderr)
            return 1
    git("add", "docs/data")
    if not git("diff", "--cached", "--quiet", check=False).returncode:
        print("変更なし")
        return 0
    now = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")
    how = "Claude なし" if env["PIYO_AI"] == "none" else "定額の Claude"
    git("commit", "-q", "-m", f"ニュース・予定更新 {now}（Mac・{how}）")
    if not push:
        print("コミットしました（push はしていません）")
        return 0
    if git("pull", "--rebase", "--autostash", "-q", check=False).returncode:
        git("rebase", "--abort", check=False)
        drop_own_commits()
        print("ほかの更新とぶつかりました。push せずに止めます（次の回で作り直します）。", file=sys.stderr)
        return 1
    r = git("push", check=False)
    print("push しました" if not r.returncode else f"push に失敗: {r.stderr[-200:]}")
    if r.returncode:
        drop_own_commits()
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
