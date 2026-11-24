#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""List recent Kaggle discussions and notebooks of a competition, compare them with kaggle/,
and recommend which to fetch.

Usage:
    uv run list.py --session NAME [--kind discussion|notebook|both] [--since YYYY-MM-DD[THH:MM]] <competition-slug>

The listings are read with list-discussions.mjs and list-notebooks.mjs in the playwright-cli
session NAME, which the caller has opened (playwright-cli -s=NAME open, or attach --extension).
This script does not open or close it.

--since is local time; a date alone is local midnight. Without it, 7 days ago.

Each item gets a state compared with what was recorded when it was last fetched into kaggle/
of the current repository:
    new      not fetched
    updated  discussion: more comments than `## Comments (N)` of discussion.md
             notebook: another version than `version` of listing.json (older listing.json
             without it: a later run than its runAt, or than the `取得:` line of source.md)
             Anything without such a record, like a notebook without source.md, is updated
    fetched  otherwise. A change of votes alone does not make an item updated
Notebooks are matched by kernel id, so a notebook whose slug changed is still the same one.
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
import re
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

    proc = cli("goto", url)
    if proc.returncode != 0:
        sys.exit(
            f"playwright-cli -s={session} goto failed (is the session open?): "
            + (proc.stderr or proc.stdout).strip()[-300:]
        )
    proc = cli("run-code", f"--filename={SCRIPT_DIR / script}", timeout=900)
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


def parse_time(iso: str | None) -> datetime | None:
    if not iso:
        return None
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return t if t.tzinfo else t.astimezone()


def fetched_time(path: Path) -> datetime | None:
    """The `取得:` line that fetch.py writes."""
    m = re.search(r"^取得: (\S+)", path.read_text(errors="replace")[:2000], re.M)
    try:
        return parse_time(m.group(1)) if m else None
    except ValueError:
        return None


def later(iso: str | None, last: datetime | None) -> bool:
    """Whether iso is after last. Without the record of last, it is taken as after."""
    t = parse_time(iso)
    # 前の版の listing.json は runAt を秒までしか持たないので、秒で比べる
    return last is None or (t is not None and t.replace(microsecond=0) > last)


def discussion_state(root: Path, topic: dict) -> dict:
    base = root / "kaggle" / "discussions"
    fetched = next(iter(base.glob(f"{topic['id']}_*/discussion.md")), None)
    if fetched is None:
        return {"state": "new", "localDir": None}

    text = fetched.read_text(errors="replace")
    m = re.search(r"^## Comments \((\d+)\)", text, re.M)
    if m is None:
        updated = True
    elif "読み込みを途中で打ち切った" in text:
        # 読めた件数は一覧の件数より少ないので、件数では比べられない。最終活動の時刻で比べる
        updated = later(topic["activityAt"], fetched_time(fetched))
    else:
        updated = topic["comments"] > int(m.group(1))
    return {
        "state": "updated" if updated else "fetched",
        "localDir": str(fetched.parent.relative_to(root)),
    }


def notebook_state(root: Path, nb: dict) -> dict:
    base = root / "kaggle" / "notebooks"
    d = next((p for p in base.glob(f"{nb['id']}_*") if p.is_dir()), None)
    if d is None:
        return {"state": "new", "localDir": None, "prevScore": None}
    listing = {}
    if (d / "listing.json").exists():
        listing = json.loads((d / "listing.json").read_text())
    fetched = d / "source.md"
    if not fetched.exists():
        # source.md を書く前の形式で取得したもの。いつの版か分からないので取り直す
        updated = True
    elif listing.get("version") is not None:
        updated = listing["version"] != nb["version"]
    else:
        last = parse_time(listing.get("runAt")) or fetched_time(fetched)
        updated = later(nb["runAt"], last)
    return {
        "state": "updated" if updated else "fetched",
        "localDir": str(d.relative_to(root)),
        "prevScore": listing.get("score"),
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
    for item in sorted(cands, key=lambda i: -i["votes"]):
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
    ap.add_argument("--since", help="YYYY-MM-DD or YYYY-MM-DDTHH:MM, local time")
    ap.add_argument("--session", required=True)
    ap.add_argument("slug")
    args = ap.parse_args()
    if args.since:
        try:
            since = datetime.fromisoformat(args.since)
        except ValueError:
            sys.exit(f"--since must be YYYY-MM-DD or YYYY-MM-DDTHH:MM: {args.since}")
    else:
        since = datetime.now() - timedelta(days=7)
    since = since.astimezone().isoformat(timespec="minutes")
    root = repo_root()
    result: dict = {"slug": args.slug, "since": since}

    if args.kind in ("discussion", "both"):
        data = run_listing(
            f"https://www.kaggle.com/competitions/{args.slug}/discussion#since={since}",
            "list-discussions.mjs",
            args.session,
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
            args.session,
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
                n["ref"]: {
                    k: n[k]
                    for k in ("id", "version", "score", "votes", "comments", "runAt")
                }
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
