#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Fetch Kaggle discussions and notebooks into kaggle/ of the current repository.

Usage:
    uv run fetch.py [--jobs N] [--listing FILE] [--outputs | --outputs-all] <target> [<target> ...]

A target is one of:
    https://www.kaggle.com/competitions/<slug>/discussion/<id>
    https://www.kaggle.com/code/<user>/<slug>   (trailing /comments etc. is ignored)
    <user>/<slug>

Discussion -> kaggle/discussions/<id>_<title>/discussion.md
    A legacy kaggle/discussions/<id>_<title>.md (analysis only) is moved to <id>_<title>/insights.md.
Notebook   -> kaggle/notebooks/<user>__<slug>/
    <code file> and kernel-metadata.json (kaggle kernels pull -m), comments.md, source.md
    (the code without outputs, long lines and cells cut short, for reading).
    An existing directory with the same kernel id (id_no) is reused even if the slug changed
    (slugChanged: true in the output).
    With --listing (the listingFile of kaggle-updates' list.py), the notebook's score, votes,
    comments and runAt in the listing are saved to listing.json with fetchedAt.
    With --outputs, the output files of the notebook's latest run are also downloaded into
    outputs/ by outputs.py, up to 100MB in total (--outputs-all: no limit, only when the user
    asked for it). The result goes into "outputs" of the notebook's line.

Prints one JSON object per target on stdout, in input order.
"""

import argparse
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
EXTRACT_JS = SCRIPT_DIR / "extract-discussion.mjs"
OUTPUTS_PY = SCRIPT_DIR / "outputs.py"
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


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else Path.cwd()


def safe_title(title: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "-", title)
    return re.sub(r"-+", "-", name).strip("-")


class Browser:
    """One playwright-cli session per worker so that workers can run in parallel."""

    def __init__(self, name: str):
        self.name = name
        self.opened = False

    def _cli(self, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["playwright-cli", f"-s={self.name}", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def extract(self, url: str) -> str:
        """Open url and return the Markdown produced by extract-discussion.mjs."""
        self._cli("goto" if self.opened else "open", url)
        self.opened = True
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

    def close(self) -> None:
        if self.opened:
            self._cli("close")


def comments_summary(markdown: str) -> dict:
    m = re.search(r"^## Comments \((\d+)\)", markdown, re.M)
    return {
        "comments": int(m.group(1)) if m else None,
        "commentsTruncated": "読み込みを途中で打ち切った" in markdown,
    }


def now_local() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def fetch_discussion(root: Path, url: str, disc_id: str, browser: Browser) -> dict:
    markdown = browser.extract(url)
    base = root / "kaggle" / "discussions"
    base.mkdir(parents=True, exist_ok=True)
    dirs = [p for p in base.glob(f"{disc_id}_*") if p.is_dir()]
    legacy = [p for p in base.glob(f"{disc_id}_*.md") if p.is_file()]
    moved = None
    if dirs:
        target = dirs[0]
    elif legacy:
        # 旧形式の分析だけのファイル (<id>_<タイトル>.md) は、ディレクトリの insights.md にする
        target = base / legacy[0].stem
        target.mkdir()
        legacy[0].rename(target / "insights.md")
        moved = str((target / "insights.md").relative_to(root))
    else:
        title = re.match(r"^# (.+)$", markdown, re.M)
        target = base / f"{disc_id}_{safe_title(title.group(1) if title else disc_id)}"
        target.mkdir()
    # 分析で、いつの時点の内容かを書けるように、取得日時を URL の行の後に入れる
    markdown = re.sub(
        r"^(URL: .*)$", rf"\1\n取得: {now_local()}", markdown, count=1, flags=re.M
    )
    (target / "discussion.md").write_text(markdown)
    return {
        "type": "discussion",
        "id": int(disc_id),
        "dir": str(target.relative_to(root)),
        "movedLegacy": moved,
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


def find_notebook_dir(base: Path, id_no: int, user: str, slug: str) -> Path:
    for meta in base.glob("*/kernel-metadata.json"):
        try:
            if json.loads(meta.read_text()).get("id_no") == id_no:
                return meta.parent
        except (json.JSONDecodeError, OSError):
            continue
    return base / f"{user}__{slug}"


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

        base = root / "kaggle" / "notebooks"
        base.mkdir(parents=True, exist_ok=True)
        target = find_notebook_dir(base, meta["id_no"], user, slug)
        target.mkdir(exist_ok=True)
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

    (target / "source.md").write_text(
        f"# {meta['title']}\n\nURL: https://www.kaggle.com/code/{ref}\n取得: {now_local()}\n\n"
        + condense(target / meta["code_file"])
    )
    comments = browser.extract(f"https://www.kaggle.com/code/{ref}/comments")
    (target / "comments.md").write_text(comments)
    if listing:
        # 次の一覧で、スコアが前回の取得から変わったかを見るために残す
        (target / "listing.json").write_text(
            json.dumps(
                {**listing, "fetchedAt": now_local()},
                ensure_ascii=False,
            )
        )
    return {
        "type": "notebook",
        "ref": ref,
        "id_no": meta["id_no"],
        "dir": str(target.relative_to(root)),
        "slugChanged": target.name != f"{user}__{slug}",
        **comments_summary(comments),
    }


def parse_target(target: str):
    if m := DISCUSSION_RE.match(target):
        return ("discussion", m.group(0), m.group(2))
    if m := NOTEBOOK_URL_RE.match(target):
        return ("notebook", m.group(1), m.group(2))
    if m := NOTEBOOK_REF_RE.match(target):
        return ("notebook", m.group(1), m.group(2))
    return None


def attach_outputs(done: dict, all_sizes: bool) -> None:
    """Download the outputs of the fetched notebooks with outputs.py, into each result's "outputs"."""
    notebooks = [r for r in done.values() if r.get("type") == "notebook"]
    if not notebooks:
        return
    cmd = ["uv", "run", "--quiet", str(OUTPUTS_PY)] + (["--all"] if all_sizes else [])
    proc = subprocess.run(
        cmd + [r["ref"] for r in notebooks], capture_output=True, text=True
    )
    lines = [json.loads(l) for l in proc.stdout.splitlines() if l.startswith("{")]
    for r, out in zip(notebooks, lines):
        r["outputs"] = out
    for r in notebooks[len(lines) :]:
        r["outputs"] = {"error": f"outputs.py failed: {proc.stderr.strip()[-500:]}"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--listing", type=Path)
    ap.add_argument("--outputs", action="store_true")
    ap.add_argument("--outputs-all", action="store_true")
    ap.add_argument("targets", nargs="+")
    args = ap.parse_args()
    root = repo_root()
    listing = json.loads(args.listing.read_text()) if args.listing else {}

    parsed = [(t, parse_target(t)) for t in args.targets]
    jobs = max(1, min(args.jobs, len(parsed)))
    # ワーカーごとにブラウザのセッションを分け、同じセッションを同時に使わない
    queues = [parsed[i::jobs] for i in range(jobs)]

    def work(index: int) -> list[tuple[str, dict]]:
        browser = Browser(f"kaggle-fetch-{index}")
        results = []
        try:
            for target, p in queues[index]:
                try:
                    if p is None:
                        raise ValueError(
                            "not a Kaggle discussion URL, notebook URL or <user>/<slug>"
                        )
                    if p[0] == "discussion":
                        results.append(
                            (target, fetch_discussion(root, p[1], p[2], browser))
                        )
                    else:
                        results.append(
                            (target, fetch_notebook(
                                    root, p[1], p[2], browser, listing.get(f"{p[1]}/{p[2]}")
                                ))
                        )
                except Exception as e:  # 1 件の失敗で残りを止めない
                    results.append((target, {"target": target, "error": str(e)}))
        finally:
            browser.close()
        return results

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        done = dict(r for rs in pool.map(work, range(jobs)) for r in rs)
    if args.outputs or args.outputs_all:
        attach_outputs(done, args.outputs_all)
    for target, _ in parsed:
        print(json.dumps(done[target], ensure_ascii=False))
    sys.exit(1 if any("error" in r for r in done.values()) else 0)


if __name__ == "__main__":
    main()
