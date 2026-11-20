#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""List recent Kaggle discussions and notebooks of a competition, compare them with kaggle/,
and recommend which to fetch.

Usage:
    uv run list.py [--kind discussion|notebook|both] [--since YYYY-MM-DD] <competition-slug>

The date is local midnight. Without it, 7 days ago.

Each item gets a state compared with the files under kaggle/ of the current repository:
    new      not fetched
    updated  fetched before the latest activity (discussion) or run (notebook)
    fetched  fetched after it
and `recommended` with `reason`, by these rules applied to new and updated items:
    1. 10 candidates or fewer: all of them
    2. otherwise the top 10. Discussions rank by votes. Notebooks take the top by score and
       the top by votes in turn. Updated notebooks whose score did not change since the last
       fetch come last
    3. plus candidates with votes >= hotVotes (votes of the 20th most-voted item of the
       competition), up to 30 in total. No hotVotes when the competition has fewer than 20

The notebook listing is also saved to `listingFile`, to pass to fetch.py --listing.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOP = 10
MAX_TOTAL = 30


def repo_root() -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    return Path(proc.stdout.strip()) if proc.returncode == 0 else Path.cwd()


def run_listing(url: str, script: str, session: str) -> dict:
    def cli(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["playwright-cli", f"-s={session}", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    try:
        cli("open", url)
        proc = cli("run-code", f"--filename={SCRIPT_DIR / script}", timeout=900)
    finally:
        cli("close")
    out = (proc.stdout + proc.stderr).splitlines()
    # 出力は "### Result" の次の行に、JSON 文字列を JSON 文字列にしたものが入る
    if len(out) >= 2 and out[0].strip() == "### Result":
        data = json.loads(json.loads(out[1]))
        if "error" in data:
            sys.exit(f"{script}: {data}")
        return data
    sys.exit(f"{script} failed: " + " ".join(out[:6])[:500])


def to_local(iso: str | None) -> str | None:
    if not iso:
        return iso
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().isoformat()


def state_of(fetched: Path | None, latest: str | None) -> str:
    if fetched is None:
        return "new"
    if latest and datetime.fromtimestamp(
        fetched.stat().st_mtime
    ).astimezone() < datetime.fromisoformat(latest.replace("Z", "+00:00")):
        return "updated"
    return "fetched"


def discussion_state(root: Path, topic: dict) -> dict:
    base = root / "kaggle" / "discussions"
    fetched = next(iter(base.glob(f"{topic['id']}_*/discussion.md")), None)
    # 旧形式の、分析だけのファイル (<id>_<タイトル>.md)
    fetched = fetched or next(
        (p for p in base.glob(f"{topic['id']}_*.md") if p.is_file()), None
    )
    return {
        "state": state_of(fetched, topic["activityAt"]),
        "localDir": str(fetched.parent.relative_to(root))
        if fetched and fetched.name == "discussion.md"
        else None,
    }


def notebook_dir(root: Path, ref: str) -> Path | None:
    base = root / "kaggle" / "notebooks"
    for meta in base.glob("*/kernel-metadata.json"):
        try:
            if json.loads(meta.read_text()).get("id") == ref:
                return meta.parent
        except (json.JSONDecodeError, OSError):
            continue
    d = base / ref.replace("/", "__")
    return d if d.is_dir() else None


def notebook_state(root: Path, nb: dict) -> dict:
    d = notebook_dir(root, nb["ref"])
    fetched = None
    prev_score = None
    if d:
        # 取得の印は kernel-metadata.json。それを保存しない旧形式で取得したものは .ipynb
        fetched = (
            d / "kernel-metadata.json"
            if (d / "kernel-metadata.json").exists()
            else next(d.glob("*.ipynb"), None)
        )
        listing = d / "listing.json"
        if listing.exists():
            prev_score = json.loads(listing.read_text()).get("score")
    return {
        "state": state_of(fetched, nb["runAt"]),
        "localDir": str(d.relative_to(root)) if d else None,
        "prevScore": prev_score,
    }


def recommend(items: list[dict], hot_votes: int | None, rankings) -> None:
    for i in items:
        i["recommended"] = False
        i["reason"] = None
    cands = [i for i in items if i["state"] in ("new", "updated")]
    if len(cands) <= TOP:
        for i in cands:
            i["recommended"], i["reason"] = True, f"候補が {TOP} 件以下"
        return

    # スコアが前回の取得から変わっていない更新は、内容の変化が小さいとみて後回しにする
    stale = [
        i
        for i in cands
        if i["state"] == "updated"
        and i.get("score") is not None
        and i.get("score") == i.get("prevScore")
    ]
    fresh = [i for i in cands if i not in stale]

    picked: list[dict] = []
    lists = [(label, rank(fresh)) for label, rank in rankings]
    while len(picked) < TOP and any(lst for _, lst in lists):
        for label, lst in lists:
            while lst and lst[0] in picked:
                lst.pop(0)
            if lst and len(picked) < TOP:
                item = lst.pop(0)
                item["recommended"], item["reason"] = True, label
                picked.append(item)
    for item in sorted(stale, key=lambda i: -i["votes"]):
        if len(picked) >= TOP:
            break
        item["recommended"], item["reason"] = (
            True,
            "スコアが変わっていない更新 (残りの枠)",
        )
        picked.append(item)

    if hot_votes is None:
        return
    threshold = max(hot_votes, 1)
    for item in sorted(fresh, key=lambda i: -i["votes"]):
        if len(picked) >= MAX_TOTAL:
            break
        if item not in picked and item["votes"] >= threshold:
            item["recommended"], item["reason"] = (
                True,
                f"盛り上がり (votes {threshold} 以上)",
            )
            picked.append(item)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--kind", choices=["discussion", "notebook", "both"], default="both"
    )
    ap.add_argument("--since")
    ap.add_argument("slug")
    args = ap.parse_args()
    since = args.since or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    root = repo_root()
    result: dict = {"slug": args.slug, "since": since}

    if args.kind in ("discussion", "both"):
        data = run_listing(
            f"https://www.kaggle.com/competitions/{args.slug}/discussion#since={since}",
            "list-discussions.mjs",
            "kaggle-list-discussions",
        )
        items = data["topics"]
        for t in items:
            t.update(discussion_state(root, t))
            t["activityAt"] = to_local(t["activityAt"])
        recommend(
            items,
            data["hotVotes"],
            [
                ("votes 上位", lambda xs: sorted(xs, key=lambda i: -i["votes"])),
            ],
        )
        result["discussions"] = {
            "truncated": data["truncated"],
            "hotVotes": data["hotVotes"],
            "items": items,
        }

    if args.kind in ("notebook", "both"):
        data = run_listing(
            f"https://www.kaggle.com/competitions/{args.slug}/code#since={since}",
            "list-notebooks.mjs",
            "kaggle-list-notebooks",
        )
        items = data["notebooks"]
        for n in items:
            n.update(notebook_state(root, n))
            n["runAt"] = to_local(n["runAt"])
        sign = -1 if data["scoreOrder"] == "descending" else 1
        rankings = [("votes 上位", lambda xs: sorted(xs, key=lambda i: -i["votes"]))]
        if data["scoreOrder"]:
            rankings.insert(
                0,
                (
                    "スコア上位",
                    lambda xs: sorted(
                        [i for i in xs if i["score"] is not None],
                        key=lambda i: sign * i["score"],
                    ),
                ),
            )
        recommend(items, data["hotVotes"], rankings)
        listing = tempfile.NamedTemporaryFile(
            "w", prefix="kaggle-listing-", suffix=".json", delete=False
        )
        json.dump(
            {
                n["ref"]: {k: n[k] for k in ("score", "votes", "comments", "runAt")}
                for n in items
            },
            listing,
        )
        listing.close()
        result["notebooks"] = {
            "truncated": data["truncated"],
            "hotVotes": data["hotVotes"],
            "scoreOrder": data["scoreOrder"],
            "items": items,
        }
        result["listingFile"] = listing.name

    print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
