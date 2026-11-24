#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Tell which fetched Kaggle discussions and notebooks under kaggle/ need analysis.

Usage:
    uv run pending.py [<target> ...]

A target is a directory under kaggle/, a discussion URL, a notebook URL or <user>/<slug>.
Without targets, every fetched directory under kaggle/ is checked and only those that are
not `done` are printed.

insights.md is up to date when its `取得:` line has the same time (YYYY-MM-DD HH:MM, local)
as the `取得:` line of the fetched file (discussion.md, or source.md for a notebook), or when
it has no `取得:` line (the older format, written from the fetched content).
Each target gets a mode:
    done        insights.md is up to date
    new         no insights.md yet: analyze the whole
    diff        changes.diff has the changes since the analyzed fetch: analyze them
    full        insights.md is behind, but which fetch it came from is unknown: read the whole
    unchanged   changes.diff is empty. The `取得:` line of insights.md (and `公開スコア:`
                for a notebook) is brought up to date here, so nothing is left to analyze
    invalid     insights.md does not start with `URL:`
    unfetched   nothing fetched for the target: fetch it with kaggle-fetch first

Prints one JSON object per target:
    {"target": ..., "dir": ..., "kind": "discussion"|"notebook", "mode": ...,
     "changes": <lines of changes.diff or null>, "insightsBytes": <size or null>}
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

FETCHED_RE = re.compile(r"^取得: (\S+)$", re.M)
INSIGHTS_FETCHED_RE = re.compile(r"^取得: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}).*$", re.M)
DISCUSSION_RE = re.compile(
    r"^https?://(?:www\.)?kaggle\.com/competitions/[^/]+/discussion/(\d+)"
)
NOTEBOOK_URL_RE = re.compile(
    r"^https?://(?:www\.)?kaggle\.com/code/([^/?#]+)/([^/?#]+)"
)
NOTEBOOK_REF_RE = re.compile(r"^([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)$")


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else Path.cwd()


def local_minute(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso).astimezone().strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return None


def notebook_dir(root: Path, user: str, slug: str) -> Path | None:
    # ディレクトリ名の slug は最初に取得したときのものなので、kernel-metadata.json の id で探す
    ref = f"{user}/{slug}"
    base = root / "kaggle" / "notebooks"
    for meta in base.glob("*/kernel-metadata.json"):
        try:
            if json.loads(meta.read_text()).get("id") == ref:
                return meta.parent
        except (json.JSONDecodeError, OSError):
            continue
    return None


def resolve(root: Path, target: str) -> Path | None:
    if m := DISCUSSION_RE.match(target):
        base = root / "kaggle" / "discussions"
        return next((p for p in base.glob(f"{m.group(1)}_*") if p.is_dir()), None)
    # ディレクトリは、作業ディレクトリからのパスでも、リポジトリのルートからのパスでもよい
    for d in (Path(target), root / target):
        if d.is_dir():
            return d
    if m := NOTEBOOK_URL_RE.match(target) or NOTEBOOK_REF_RE.match(target):
        return notebook_dir(root, m.group(1), m.group(2))
    return None


def bring_up_to_date(d: Path, kind: str, fetched: str, insights: Path) -> None:
    """Rewrite the header lines of insights.md for a fetch whose content did not change."""
    text = insights.read_text()
    if kind == "discussion":
        m = re.search(
            r"^## Comments \((\d+)\)", (d / "discussion.md").read_text(), re.M
        )
        line = f"取得: {fetched}" + (f" / コメント {m.group(1)} 件" if m else "")
        text = INSIGHTS_FETCHED_RE.sub(line, text, count=1)
    else:
        listing = {}
        if (d / "listing.json").exists():
            listing = json.loads((d / "listing.json").read_text())
        run_at = local_minute(listing.get("runAt"))
        line = f"取得: {fetched}" + (f" (実行 {run_at})" if run_at else "")
        text = INSIGHTS_FETCHED_RE.sub(line, text, count=1)
        if listing.get("score") is not None:
            score = f"公開スコア: {listing['score']}"
            if re.search(r"^公開スコア:", text, re.M):
                text = re.sub(r"^公開スコア:.*$", score, text, count=1, flags=re.M)
            else:
                text = re.sub(
                    r"^(取得: .*)$", rf"\1\n{score}", text, count=1, flags=re.M
                )
    insights.write_text(text)


def check(root: Path, target: str, d: Path | None) -> dict:
    result = {
        "target": target,
        "dir": None,
        "kind": None,
        "mode": "unfetched",
        "changes": None,
        "insightsBytes": None,
    }
    if d is None:
        return result
    d = d.resolve()
    result["dir"] = str(d.relative_to(root)) if d.is_relative_to(root) else str(d)
    kind, fetched_file = (
        ("discussion", d / "discussion.md")
        if d.parent.name == "discussions"
        else ("notebook", d / "source.md")
    )
    result["kind"] = kind
    if not fetched_file.exists():
        return result
    insights = d / "insights.md"
    if not insights.exists():
        result["mode"] = "new"
        return result
    result["insightsBytes"] = insights.stat().st_size
    text = insights.read_text(errors="replace")
    if not text.startswith("URL:"):
        result["mode"] = "invalid"
        return result

    m = FETCHED_RE.search(fetched_file.read_text(errors="replace")[:2000])
    fetched = local_minute(m.group(1)) if m else None
    analyzed = INSIGHTS_FETCHED_RE.search(text)
    changes = d / "changes.diff"
    if analyzed is None or (fetched and analyzed.group(1) == fetched):
        # `取得:` 行の無い insights.md は、その行を書く前の形式で、取得した内容を分析したもの
        result["mode"] = "done"
    elif not changes.exists() or not fetched:
        result["mode"] = "full"
    elif changes.read_text().strip() == "":
        bring_up_to_date(d, kind, fetched, insights)
        result["mode"] = "unchanged"
        result["insightsBytes"] = insights.stat().st_size
    else:
        result["mode"] = "diff"
        result["changes"] = len(changes.read_text().splitlines())
    return result


def main() -> None:
    root = repo_root()
    targets = sys.argv[1:]
    if targets:
        for t in targets:
            print(json.dumps(check(root, t, resolve(root, t)), ensure_ascii=False))
        return
    for kind_dir, name in (
        ("discussions", "discussion.md"),
        ("notebooks", "source.md"),
    ):
        for f in sorted((root / "kaggle" / kind_dir).glob(f"*/{name}")):
            r = check(root, str(f.parent.relative_to(root)), f.parent)
            if r["mode"] != "done":
                print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
