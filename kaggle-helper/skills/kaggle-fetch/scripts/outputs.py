#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["kaggle", "six", "requests"]
# ///
"""Download the output files of the latest run of fetched Kaggle notebooks.

Usage:
    uv run outputs.py [--max-mb N] [--all] [--pattern REGEX] <notebook URL | user/slug> ...

The notebook must have been fetched (kaggle/notebooks/<dir>/kernel-metadata.json, by fetch.py).
Files are saved to kaggle/notebooks/<dir>/outputs/, replacing the previous outputs, with the
run log as <slug>.log and a .gitignore that ignores the whole directory. When no file is
downloaded, the previous outputs are left as they are (dir: null).

The size of each file is checked before downloading (a 1-byte range request; the size listed
by `kaggle kernels files` is not the file size). Files are taken in listed order while the total
stays within --max-mb (default 100); the rest are skipped and reported with their sizes.
--all downloads everything regardless of size. Use it only when the user asked for it.

Prints one JSON object per target on stdout, in input order.
"""

import argparse
import contextlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import requests
from kaggle.api.kaggle_api_extended import KaggleApi
from kagglesdk.kernels.types.kernels_api_service import (
    ApiListKernelSessionOutputRequest,
)

REF_RE = re.compile(
    r"^(?:https?://(?:www\.)?kaggle\.com/code/)?([\w-]+)/([\w-]+)(?:[/?#].*)?$"
)
MAX_FILES = 2000
CHUNK = 1 << 20


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else Path.cwd()


def notebook_dir(root: Path, ref: str) -> Path | None:
    base = root / "kaggle" / "notebooks"
    for meta in base.glob("*/kernel-metadata.json"):
        try:
            if json.loads(meta.read_text()).get("id") == ref:
                return meta.parent
        except (json.JSONDecodeError, OSError):
            continue
    d = base / ref.replace("/", "__")
    return d if (d / "kernel-metadata.json").exists() else None


def list_outputs(api: KaggleApi, user: str, slug: str) -> tuple[list, str]:
    files, log, token = [], "", None
    with api.build_kaggle_client() as client:
        while True:
            req = ApiListKernelSessionOutputRequest()
            req.user_name = user
            req.kernel_slug = slug
            if token:
                req.page_token = token
            res = client.kernels.kernels_api_client.list_kernel_session_output(req)
            files.extend(res.files)
            log = log or res.log or ""
            token = res.next_page_token
            if not token or len(files) >= MAX_FILES:
                return files, log


def remote_size(url: str) -> int | None:
    # 署名付き URL は HEAD を受け付けないので、1 バイトだけ要求して Content-Range の全体の長さを読む
    with requests.get(
        url, headers={"Range": "bytes=0-0"}, stream=True, timeout=60
    ) as res:
        m = re.search(r"/(\d+)$", res.headers.get("Content-Range", ""))
        if m:
            return int(m.group(1))
        length = res.headers.get("Content-Length")
        return int(length) if res.status_code == 200 and length else None


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=600) as res:
        res.raise_for_status()
        with dest.open("wb") as out:
            for chunk in res.iter_content(CHUNK):
                out.write(chunk)
    return dest.stat().st_size


def fetch_outputs(api, root, target, max_bytes, pattern) -> dict:
    m = REF_RE.match(target)
    if not m:
        raise ValueError("not a Kaggle notebook URL or <user>/<slug>")
    user, slug = m.group(1), m.group(2)
    ref = f"{user}/{slug}"
    d = notebook_dir(root, ref)
    if d is None:
        raise ValueError(
            "the notebook has not been fetched; fetch it with fetch.py first"
        )

    files, log = list_outputs(api, user, slug)
    downloaded, skipped, total = [], [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            name = f.file_name
            dest = (Path(tmp) / name).resolve()
            if not dest.is_relative_to(Path(tmp).resolve()):
                skipped.append({"name": name, "bytes": None, "reason": "unsafe_path"})
                continue
            if pattern and not pattern.search(name):
                continue
            size = remote_size(f.url)
            if max_bytes is not None and (size is None or total + size > max_bytes):
                skipped.append(
                    {
                        "name": name,
                        "bytes": size,
                        "reason": "size_unknown" if size is None else "too_large",
                    }
                )
                continue
            got = download(f.url, dest)
            total += got
            downloaded.append({"name": name, "bytes": got})
        if log:
            (Path(tmp) / f"{slug}.log").write_text(log)

        out_dir = d / "outputs"
        # 1 件も取れなかったときは、前回の出力を残す
        if downloaded:
            # 出力は最新の実行のものだけを置く。前回の出力は消して入れ替える
            if out_dir.exists():
                shutil.rmtree(out_dir)
            shutil.copytree(tmp, out_dir)
            (out_dir / ".gitignore").write_text("*\n")
    return {
        "ref": ref,
        "dir": str(out_dir.relative_to(root)) if downloaded else None,
        "files": len(files),
        "downloaded": downloaded,
        "skipped": skipped,
        "bytes": total,
        "log": bool(log),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-mb", type=float, default=100)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--pattern")
    ap.add_argument("targets", nargs="+")
    args = ap.parse_args()
    root = repo_root()
    max_bytes = None if args.all else int(args.max_mb * 1024 * 1024)
    pattern = re.compile(args.pattern) if args.pattern else None
    # kaggle のライブラリは警告を stdout に出す。stdout は結果の JSON だけにする
    with contextlib.redirect_stdout(sys.stderr):
        api = KaggleApi()
        api.authenticate()

    failed = False
    for target in args.targets:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result = fetch_outputs(api, root, target, max_bytes, pattern)
        except Exception as e:  # 1 件の失敗で残りを止めない
            result, failed = {"target": target, "error": str(e)}, True
        print(json.dumps(result, ensure_ascii=False), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
