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
as the `取得:` line of the fetched file (discussion.md, or source.md for a notebook).
insights.md without a `取得:` line is the older format, written from the previous fetch:
it is up to date unless a refetch has left changes.diff.
Each target gets a mode:
    done        insights.md is up to date
    new         no insights.md yet: analyze the whole
    diff        changes.diff has the changes since the analyzed fetch: analyze them
    full        insights.md is behind, but which fetch it came from is unknown: read the whole
    unchanged   changes.diff is empty. The `取得:` line of insights.md (and `公開スコア:`
                for a notebook) is brought up to date here, so nothing is left to analyze
    trivial     changes.diff only has changes that do not affect the analysis (see
                trivial_change). The header lines are brought up to date as for unchanged
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


def set_fetched_line(text: str, line: str) -> str:
    """Replace the `取得:` line, or add it after `URL:` (and `種類:`) for the older format."""
    if INSIGHTS_FETCHED_RE.search(text):
        return INSIGHTS_FETCHED_RE.sub(line, text, count=1)
    return re.sub(
        r"\A(URL:.*\n(?:種類:.*\n)?)", lambda m: m.group(1) + line + "\n", text, count=1
    )


def bring_up_to_date(d: Path, kind: str, fetched: str, insights: Path) -> None:
    """Rewrite the header lines of insights.md for a fetch whose content did not change."""
    text = insights.read_text()
    if kind == "discussion":
        m = re.search(
            r"^## Comments \((\d+)\)", (d / "discussion.md").read_text(), re.M
        )
        line = f"取得: {fetched}" + (f" / コメント {m.group(1)} 件" if m else "")
        text = set_fetched_line(text, line)
    else:
        listing = {}
        if (d / "listing.json").exists():
            listing = json.loads((d / "listing.json").read_text())
        run_at = local_minute(listing.get("runAt"))
        line = f"取得: {fetched}" + (f" (実行 {run_at})" if run_at else "")
        text = set_fetched_line(text, line)
        if listing.get("score") is not None:
            score = f"公開スコア: {listing['score']}"
            if re.search(r"^公開スコア:", text, re.M):
                text = re.sub(r"^公開スコア:.*$", score, text, count=1, flags=re.M)
            else:
                text = re.sub(
                    r"^(取得: .*)$", rf"\1\n{score}", text, count=1, flags=re.M
                )
    insights.write_text(text)


# fetch.py が差分を取る前に除く `取得:` の行。差分の行番号は、この行を除いたもので数える
DIFF_FETCHED_RE = re.compile(r"^取得: (\S+)\n", re.M)
DIFF_FILE_RE = re.compile(r"^--- (\S+) \(取得 ")
HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
CELL_RE = re.compile(r"^<!-- cell \d+ (\w+)")
NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")
# discussion の投稿者の行。表示順位と votes は取得のたびに変わる
AUTHOR_RE = re.compile(r"^(\*\*@|### #\d+ @)")
AUTHOR_DISPLAY_RE = re.compile(r" \(\d+(?:st|nd|rd|th)\)| \[\d+ votes?\]")
NOTEBOOK_URL_LINE_RE = re.compile(r"^URL: https://www\.kaggle\.com/code/")
METADATA_KEYS_RE = re.compile(r'^\s*"(title|id|code_file)": ')


def changed_pairs(diff: str) -> list[tuple[str, int, str, str]] | None:
    """Pair the removed and added lines of changes.diff, one to one in order.

    Returns (file, line number in the new file, old line, new line) for each pair, or None
    when a removed or added line has no counterpart, or a file appears twice (the diff of
    several fetches appended, whose line numbers do not match the current file).
    """
    pairs: list[tuple[str, int, str, str]] = []
    seen: set[str] = set()
    name, line_no, header = "", 0, False
    removed: list[str] = []
    added: list[tuple[int, str]] = []

    def flush() -> bool:
        if len(removed) != len(added):
            return False
        pairs.extend((name, n, o, a) for o, (n, a) in zip(removed, added))
        removed.clear()
        added.clear()
        return True

    for line in diff.splitlines():
        if m := DIFF_FILE_RE.match(line):
            if not flush() or m.group(1) in seen:
                return None
            name, header = m.group(1), True
            seen.add(name)
        elif header or line.startswith("\\"):
            # ファイル名の次の `+++` の行と、`\ No newline at end of file`
            header = False
        elif m := HUNK_RE.match(line):
            if not flush():
                return None
            line_no = int(m.group(1))
        elif line.startswith("-"):
            if added and not flush():
                return None
            removed.append(line[1:])
        elif line.startswith("+"):
            added.append((line_no, line[1:]))
            line_no += 1
        else:
            if not flush():
                return None
            line_no += 1
    return pairs if flush() else None


def trivial_change(d: Path, kind: str, diff: str) -> bool:
    """Whether every change in changes.diff is one that does not affect the analysis.

    Only these count, and anything else (a code cell changed by a single line, a new comment)
    is left to the analysis:
    - notebook: the title on line 1 and the `URL:` line of source.md and comments.md, `title`,
      `id` and `code_file` of kernel-metadata.json (they follow the title), and lines of
      Markdown cells in source.md whose only change is in the numbers
    - discussion: the rank and votes shown on the lines of the poster and the commenters
    """
    pairs = changed_pairs(diff)
    if not pairs:
        return False
    cells: list[str | None] = []
    if kind == "notebook":
        cell = None
        source = DIFF_FETCHED_RE.sub("", (d / "source.md").read_text(errors="replace"), count=1)
        for line in source.splitlines():
            if m := CELL_RE.match(line):
                cell = m.group(1)
            cells.append(cell)

    def allowed(name: str, n: int, old: str, new: str) -> bool:
        if kind == "discussion":
            return (
                name == "discussion.md"
                and bool(AUTHOR_RE.match(old) and AUTHOR_RE.match(new))
                and AUTHOR_DISPLAY_RE.sub("", old) == AUTHOR_DISPLAY_RE.sub("", new)
            )
        if name == "kernel-metadata.json":
            m, k = METADATA_KEYS_RE.match(old), METADATA_KEYS_RE.match(new)
            return bool(m and k and m.group(1) == k.group(1))
        if name not in ("source.md", "comments.md"):
            return False
        if n == 1 or (NOTEBOOK_URL_LINE_RE.match(old) and NOTEBOOK_URL_LINE_RE.match(new)):
            return True
        return (
            name == "source.md"
            and n <= len(cells)
            and cells[n - 1] == "markdown"
            and not CELL_RE.match(new)
            and NUMBER_RE.sub("0", old) == NUMBER_RE.sub("0", new)
        )

    return all(allowed(*p) for p in pairs)


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
    if analyzed is not None and fetched and analyzed.group(1) == fetched:
        result["mode"] = "done"
    elif analyzed is None and (not changes.exists() or not fetched):
        # `取得:` 行の無い insights.md は、その行を書く前の形式で、取得した内容を分析したもの。
        # 取り直すと changes.diff ができる
        result["mode"] = "done"
    elif not changes.exists() or not fetched:
        result["mode"] = "full"
    elif changes.read_text().strip() == "" or trivial_change(d, kind, changes.read_text()):
        bring_up_to_date(d, kind, fetched, insights)
        result["mode"] = "unchanged" if changes.read_text().strip() == "" else "trivial"
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
