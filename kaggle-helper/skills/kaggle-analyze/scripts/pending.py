#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""List fetched discussions and notebooks under kaggle/ whose analysis is missing or older than the fetch.

Usage:
    uv run pending.py

A directory is pending when its fetched files (discussion.md, or source.md and comments.md)
exist and analysis.md is missing or older than the newest of them.
Directories fetched before the fetch/analysis split (no discussion.md or source.md) are skipped.
Prints one JSON object per pending directory, relative to the repository root.
"""

import json
import subprocess
from pathlib import Path

FETCHED = {"discussions": ["discussion.md"], "notebooks": ["source.md", "comments.md"]}


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else Path.cwd()


def main() -> None:
    root = repo_root()
    for kind, names in FETCHED.items():
        for d in sorted((root / "kaggle" / kind).glob("*/")):
            fetched = [d / n for n in names if (d / n).exists()]
            if not fetched or not (d / names[0]).exists():
                continue
            analysis = d / "analysis.md"
            newest = max(p.stat().st_mtime for p in fetched)
            if not analysis.exists() or analysis.stat().st_mtime < newest:
                print(
                    json.dumps(
                        {
                            "type": kind.rstrip("s"),
                            "dir": str(d.relative_to(root)),
                            "analysis": "missing"
                            if not analysis.exists()
                            else "outdated",
                        },
                        ensure_ascii=False,
                    )
                )


if __name__ == "__main__":
    main()
