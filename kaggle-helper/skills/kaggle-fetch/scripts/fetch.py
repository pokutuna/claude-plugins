#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Fetch Kaggle discussions and notebooks into kaggle/ of the current repository.

Usage:
    uv run fetch.py --session NAME [--session NAME ...] [--listing FILE] <target> [<target> ...]

Pages are read with extract-page.mjs, using the bundled turndown.js, in playwright-cli
sessions that are already open (playwright-cli -s=NAME open, or attach --extension).
This script does not open or close them. With several sessions, targets are fetched in
parallel, one worker per session. A target given twice is fetched once.

A target is one of:
    https://www.kaggle.com/competitions/<slug>/discussion/<id>
    https://www.kaggle.com/code/<user>/<slug>   (trailing /comments etc. is ignored)
    <user>/<slug>

Discussion -> kaggle/discussions/<id>_<title>/discussion.md
Notebook   -> kaggle/notebooks/<kernel id>_<slug>/
    <code file> and kernel-metadata.json (kaggle kernels pull -m), comments.md, source.md
    (the code without outputs, long lines and cells cut short, for reading).
    The directory is found by the kernel id (id_no), so it is reused even if the slug changed
    (slugChanged: true in the output).
    With --listing (the listingFile of kaggle-updates' list.py), the notebook's version, score,
    votes, comments and runAt in the listing are saved to listing.json with fetchedAt.
    Without it, an existing listing.json is removed.

When the directory has insights.md, the changes since the fetch it was written from are
written to changes.diff, ignoring the `取得:` lines (`changes` in the output is its line count):
    the previous fetch was analyzed (its `取得:` equals the one in insights.md): a new diff
    otherwise, changes.diff of the earlier fetches exists: the diff is appended to it
    otherwise (the base is unknown): no changes.diff, and `changes` is null
Without insights.md, changes.diff is removed and `changes` is null.

Prints one JSON object per target on stdout, in input order.
"""

import argparse
import difflib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
EXTRACT_JS = SCRIPT_DIR / "extract-page.mjs"
# ログイン済みのブラウザで読むこともあるので、外部から取らずに同梱のものをページに読み込む
TURNDOWN_JS = SCRIPT_DIR / "turndown.js"
RUN_CODE_TIMEOUT = 300
MAX_LINE_CHARS = 400
MAX_CELL_CHARS = 6000

DISCUSSION_RE = re.compile(
    r"^https?://(?:www\.)?kaggle\.com/competitions/([^/]+)/discussion/(\d+)"
)
NOTEBOOK_URL_RE = re.compile(
    r"^https?://(?:www\.)?kaggle\.com/code/([^/?#]+)/([^/?#]+)"
)
NOTEBOOK_REF_RE = re.compile(r"^([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)$")
FETCHED_RE = re.compile(r"^取得: (\S+)\n", re.M)
# insights.md の `取得:` 行は、分析した取得の日時を YYYY-MM-DD HH:MM のローカル時刻で書く
INSIGHTS_FETCHED_RE = re.compile(r"^取得: (\d{4}-\d{2}-\d{2} \d{2}:\d{2})", re.M)
CHANGES = "changes.diff"


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else Path.cwd()


def safe_title(title: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "-", title)
    return re.sub(r"-+", "-", name).strip("-")


class Browser:
    """A playwright-cli session opened by the caller. Each worker uses its own session."""

    def __init__(self, name: str):
        self.name = name

    def _cli(self, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["playwright-cli", f"-s={self.name}", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def extract(self, url: str) -> str:
        """Go to url and return the Markdown produced by extract-page.mjs."""
        proc = self._cli("goto", url)
        if proc.returncode != 0:
            raise RuntimeError(
                f"playwright-cli -s={self.name} goto failed (is the session open?): "
                + (proc.stderr or proc.stdout).strip()[-300:]
            )
        proc = self._cli(
            "run-code",
            f"async page => {{ await page.addScriptTag({{ path: {json.dumps(str(TURNDOWN_JS))} }}) }}",
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "loading turndown.js failed: "
                + (proc.stderr or proc.stdout).strip()[-300:]
            )
        proc = self._cli(
            "run-code", f"--filename={EXTRACT_JS}", timeout=RUN_CODE_TIMEOUT
        )
        out = (proc.stdout + proc.stderr).splitlines()
        # 出力は "### Result" の次の行に、JSON 文字列を JSON 文字列にしたものが入る
        if len(out) >= 2 and out[0].strip() == "### Result":
            markdown = json.loads(json.loads(out[1]))
            if markdown.startswith("Error:"):
                raise RuntimeError(markdown)
            return markdown
        raise RuntimeError("extract failed: " + " ".join(out[:6])[:500])


def comments_summary(markdown: str) -> dict:
    m = re.search(r"^## Comments \((\d+)\)", markdown, re.M)
    return {
        "comments": int(m.group(1)) if m else None,
        "commentsTruncated": "読み込みを途中で打ち切った" in markdown,
    }


def now_local() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def fetched_minute(text: str) -> str | None:
    """The `取得:` of a fetched file as YYYY-MM-DD HH:MM in local time, as insights.md has it."""
    m = FETCHED_RE.search(text)
    if not m:
        return None
    try:
        return (
            datetime.fromisoformat(m.group(1)).astimezone().strftime("%Y-%m-%d %H:%M")
        )
    except ValueError:
        return None


def record_changes(target: Path, primary: str, new: dict[str, str]) -> int | None:
    """Write the changes since the analyzed fetch to changes.diff, before the new files are saved.

    primary is the fetched file whose `取得:` line tells when the previous fetch was;
    new maps each fetched file name to its new content.
    """
    changes = target / CHANGES
    insights = target / "insights.md"
    old_primary = target / primary
    if not insights.exists() or not old_primary.exists():
        changes.unlink(missing_ok=True)
        return None
    old_fetched = fetched_minute(old_primary.read_text(errors="replace"))
    m = INSIGHTS_FETCHED_RE.search(insights.read_text(errors="replace"))
    if m is None:
        # `取得:` 行の無い insights.md は、その行を書く前の形式で、前回の取得を分析したもの。
        # changes.diff があれば、それはまだ分析されていない
        analyzed = old_fetched is not None and not changes.exists()
    else:
        analyzed = old_fetched is not None and m.group(1) == old_fetched
    if not analyzed and not changes.exists():
        # どの取得をもとに分析したかが分からない。分析では全体を読む
        return None

    new_fetched = fetched_minute(new[primary])
    lines: list[str] = []
    for name, text in new.items():
        old_path = target / name
        old = old_path.read_text(errors="replace") if old_path.exists() else ""
        lines += difflib.unified_diff(
            FETCHED_RE.sub("", old, count=1).splitlines(),
            FETCHED_RE.sub("", text, count=1).splitlines(),
            f"{name} (取得 {old_fetched})",
            f"{name} (取得 {new_fetched})",
            lineterm="",
        )
    body = "".join(f"{line}\n" for line in lines)
    if analyzed:
        changes.write_text(body)
    else:
        # 分析していない取得の差分に続ける。前回の分析からの差分になる
        with changes.open("a") as f:
            f.write(body)
    return len(changes.read_text().splitlines())


def fetch_discussion(root: Path, url: str, disc_id: str, browser: Browser) -> dict:
    markdown = browser.extract(url)
    base = root / "kaggle" / "discussions"
    base.mkdir(parents=True, exist_ok=True)
    dirs = [p for p in base.glob(f"{disc_id}_*") if p.is_dir()]
    if dirs:
        target = dirs[0]
    else:
        title = re.match(r"^# (.+)$", markdown, re.M)
        target = base / f"{disc_id}_{safe_title(title.group(1) if title else disc_id)}"
        target.mkdir()
    # 分析で、いつの時点の内容かを書けるように、取得日時を URL の行の後に入れる
    markdown = re.sub(
        r"^(URL: .*)$", rf"\1\n取得: {now_local()}", markdown, count=1, flags=re.M
    )
    changes = record_changes(target, "discussion.md", {"discussion.md": markdown})
    (target / "discussion.md").write_text(markdown)
    return {
        "type": "discussion",
        "id": int(disc_id),
        "dir": str(target.relative_to(root)),
        "changes": changes,
        **comments_summary(markdown),
    }


def shorten_line(line: str) -> str:
    if len(line) <= MAX_LINE_CHARS:
        return line
    return f"{line[:200]} …({len(line) - 200} chars omitted)"


def condense(code_path: Path) -> str:
    """Notebook (or script) source without outputs, with long lines and cells cut short."""
    if code_path.suffix != ".ipynb":
        lines = code_path.read_text(errors="replace").splitlines()
        return "```\n" + "\n".join(shorten_line(l) for l in lines) + "\n```\n"
    nb = json.loads(code_path.read_text())
    parts = []
    for i, cell in enumerate(nb.get("cells", []), 1):
        src = cell.get("source", "")
        src = "".join(src) if isinstance(src, list) else src
        text = "\n".join(shorten_line(l) for l in src.splitlines())
        if len(text) > MAX_CELL_CHARS:
            text = f"{text[:MAX_CELL_CHARS]}\n…({len(text) - MAX_CELL_CHARS} chars omitted)"
        kind = cell.get("cell_type", "code")
        if kind == "markdown":
            parts.append(f"<!-- cell {i} markdown -->\n{text}")
        else:
            parts.append(f"<!-- cell {i} {kind} -->\n```python\n{text}\n```")
    return "\n\n".join(parts) + "\n"


def fetch_notebook(
    root: Path, user: str, slug: str, browser: Browser, listing: dict | None = None
) -> dict:
    ref = f"{user}/{slug}"
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.run(
            ["kaggle", "kernels", "pull", ref, "-m", "-p", tmp],
            capture_output=True,
            text=True,
        )
        meta_path = Path(tmp) / "kernel-metadata.json"
        if proc.returncode != 0 or not meta_path.exists():
            raise RuntimeError(
                f"kaggle kernels pull failed: {(proc.stderr or proc.stdout).strip()[-500:]}"
            )
        meta = json.loads(meta_path.read_text())
        code_file = Path(tmp) / meta["code_file"]
        # コメントを取れなかったときに、コードだけ新しくして取得済みに見せないよう、ファイルを置く前に取る
        comments = browser.extract(f"https://www.kaggle.com/code/{ref}/comments")
        source = (
            f"# {meta['title']}\n\nURL: https://www.kaggle.com/code/{ref}\n取得: {now_local()}\n\n"
            + condense(code_file)
        )

        base = root / "kaggle" / "notebooks"
        base.mkdir(parents=True, exist_ok=True)
        # slug が変わっても同じディレクトリを使う。名前の slug は最初に取得したときのまま
        target = next(
            (p for p in base.glob(f"{meta['id_no']}_*") if p.is_dir()),
            base / f"{meta['id_no']}_{slug}",
        )
        target.mkdir(exist_ok=True)
        changes = record_changes(
            target,
            "source.md",
            {
                "source.md": source,
                "comments.md": comments,
                "kernel-metadata.json": meta_path.read_text(),
            },
        )
        old_meta = target / "kernel-metadata.json"
        if old_meta.exists():
            old_code = json.loads(old_meta.read_text()).get("code_file")
            # slug が変わるとコードのファイル名も変わる。前回取得したファイルは新しいもので置き換える
            if (
                old_code
                and old_code != meta["code_file"]
                and (target / old_code).exists()
            ):
                (target / old_code).unlink()
        shutil.move(str(code_file), target / meta["code_file"])
        shutil.move(str(meta_path), old_meta)

    (target / "source.md").write_text(source)
    (target / "comments.md").write_text(comments)
    listing_path = target / "listing.json"
    if listing:
        # 次の一覧で、スコアが前回の取得から変わったかを見るために残す
        listing_path.write_text(
            json.dumps(
                {**listing, "fetchedAt": now_local()},
                ensure_ascii=False,
            )
        )
    elif listing_path.exists():
        # 前回の一覧のスコアと実行日時を、今回取得したコードのものとして分析に使わせない
        listing_path.unlink()
    return {
        "type": "notebook",
        "ref": ref,
        "id_no": meta["id_no"],
        "dir": str(target.relative_to(root)),
        "absDir": str(target),
        "slugChanged": target.name != f"{meta['id_no']}_{slug}",
        "changes": changes,
        **comments_summary(comments),
    }


def target_key(target: str, parsed) -> tuple:
    if parsed is None:
        return ("invalid", target)
    if parsed[0] == "discussion":
        return ("discussion", parsed[2])
    return parsed


def parse_target(target: str):
    if m := DISCUSSION_RE.match(target):
        return ("discussion", m.group(0), m.group(2))
    if m := NOTEBOOK_URL_RE.match(target):
        return ("notebook", m.group(1), m.group(2))
    if m := NOTEBOOK_REF_RE.match(target):
        return ("notebook", m.group(1), m.group(2))
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", action="append", required=True)
    ap.add_argument("--listing", type=Path)
    ap.add_argument("targets", nargs="+")
    args = ap.parse_args()
    root = repo_root()
    listing = json.loads(args.listing.read_text()) if args.listing else {}

    keys = [target_key(t, parse_target(t)) for t in args.targets]
    # 同じ対象を別のワーカーが同時に取得して、同じディレクトリを作り合わないよう、1 件にまとめる
    unique: dict[tuple, tuple[str, tuple | None]] = {}
    for t, k in zip(args.targets, keys):
        unique.setdefault(k, (t, parse_target(t)))
    items = list(unique.items())
    # 同じセッションを同時に使わないよう、セッションごとにワーカーを 1 つ置く
    sessions = args.session[: len(items)]
    queues = [items[i :: len(sessions)] for i in range(len(sessions))]

    def work(index: int) -> list[tuple[tuple, dict]]:
        browser = Browser(sessions[index])
        results = []
        for key, (target, p) in queues[index]:
            try:
                if p is None:
                    raise ValueError(
                        "not a Kaggle discussion URL, notebook URL or <user>/<slug>"
                    )
                if p[0] == "discussion":
                    result = fetch_discussion(root, p[1], p[2], browser)
                else:
                    result = fetch_notebook(
                        root, p[1], p[2], browser, listing.get(f"{p[1]}/{p[2]}")
                    )
                results.append((key, result))
            except Exception as e:  # 1 件の失敗で残りを止めない
                results.append((key, {"target": target, "error": str(e)}))
        return results

    with ThreadPoolExecutor(max_workers=len(sessions)) as pool:
        done = dict(r for rs in pool.map(work, range(len(sessions))) for r in rs)
    for key in keys:
        print(json.dumps(done[key], ensure_ascii=False))
    sys.exit(1 if any("error" in r for r in done.values()) else 0)


if __name__ == "__main__":
    main()
