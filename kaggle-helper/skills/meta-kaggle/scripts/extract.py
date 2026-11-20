#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb"]
# ///

"""Extract competition-specific subset from meta-kaggle dataset."""

import argparse
import json
import sys
from pathlib import Path

import duckdb

DATA_DIR = Path.home() / ".meta-kaggle"
TARGET_CSVS = [
    "Competitions.csv",
    "Teams.csv",
    "Forums.csv",
    "ForumTopics.csv",
    "ForumMessages.csv",
]


def check_data_exists() -> bool:
    for f in TARGET_CSVS:
        if not (DATA_DIR / f).exists():
            return False
    return True


def find_competition(con: duckdb.DuckDBPyConnection, slug: str) -> dict | None:
    """Find competition by slug (case-insensitive partial match)."""
    row = con.execute(
        "SELECT Id, Slug, Title, ForumId FROM Competitions WHERE lower(Slug) = lower(?)",
        [slug],
    ).fetchone()
    if row:
        return {"Id": row[0], "Slug": row[1], "Title": row[2], "ForumId": row[3]}
    # Fallback: partial match
    rows = con.execute(
        "SELECT Id, Slug, Title, ForumId FROM Competitions WHERE lower(Slug) LIKE '%' || lower(?) || '%' LIMIT 10",
        [slug],
    ).fetchall()
    if len(rows) == 1:
        return {
            "Id": rows[0][0],
            "Slug": rows[0][1],
            "Title": rows[0][2],
            "ForumId": rows[0][3],
        }
    if rows:
        print(
            json.dumps(
                {
                    "error": "ambiguous_slug",
                    "message": f"Multiple competitions match '{slug}'",
                    "candidates": [
                        {"Id": r[0], "Slug": r[1], "Title": r[2]} for r in rows
                    ],
                },
                indent=2,
            )
        )
        return None
    print(
        json.dumps(
            {"error": "not_found", "message": f"No competition found for '{slug}'"}
        )
    )
    return None


# ParentForumId categories
COMP_PARENTS = (5, 8, 52)  # Active Competitions, Past Competitions, InClass
DATASET_PARENTS = (1023,)  # Public Datasets
MODEL_PARENTS = (2578766,)  # Models


def find_forum_for_competition(
    con: duckdb.DuckDBPyConnection, comp: dict
) -> int | None:
    """Find competition forum by slug or title match (competition categories only)."""
    row = con.execute(
        """SELECT Id, Title FROM Forums
           WHERE ParentForumId IN (5, 8, 52)
             AND (lower(Title) = lower(?) OR lower(Title) = lower(?))""",
        [comp["Slug"], comp["Title"]],
    ).fetchone()
    if row:
        print(f"Found forum: Id={row[0]}, Title='{row[1]}'", file=sys.stderr)
        return row[0]
    return None


def find_forums_by_category(
    con: duckdb.DuckDBPyConnection,
    slug: str,
    parent_ids: tuple[int, ...],
) -> list[int]:
    """Find forum IDs matching slug/title in given parent categories."""
    placeholders = ",".join(str(p) for p in parent_ids)
    rows = con.execute(
        f"""SELECT Id FROM Forums
            WHERE ParentForumId IN ({placeholders})
              AND (lower(Title) = lower(?) OR lower(Title) LIKE '%' || lower(?) || '%')""",
        [slug, slug],
    ).fetchall()
    return [r[0] for r in rows]


def extract(
    con: duckdb.DuckDBPyConnection,
    comp: dict,
    output_dir: Path,
    include_datasets: bool = False,
    include_models: bool = False,
) -> None:
    """Extract competition subset to parquet files."""
    output_dir.mkdir(parents=True, exist_ok=True)
    forum_id = comp["ForumId"]

    if forum_id is None:
        forum_id = find_forum_for_competition(con, comp)
        if forum_id is None:
            print(
                json.dumps(
                    {
                        "error": "no_forum",
                        "message": f"Competition '{comp['Slug']}' has no ForumId and no matching forum found.",
                    },
                    indent=2,
                )
            )
            return

    forum_ids = [forum_id]
    slug = comp["Slug"]
    if include_datasets:
        forum_ids.extend(
            fid
            for fid in find_forums_by_category(con, slug, DATASET_PARENTS)
            if fid not in forum_ids
        )
    if include_models:
        forum_ids.extend(
            fid
            for fid in find_forums_by_category(con, slug, MODEL_PARENTS)
            if fid not in forum_ids
        )

    forum_ids_sql = ",".join(str(fid) for fid in forum_ids)
    comp_id = comp["Id"]

    # Extract teams for competition
    teams_path = str(output_dir / "teams.parquet")
    con.execute(
        f"COPY (SELECT * FROM Teams WHERE CompetitionId = {comp_id}) TO '{teams_path}' (FORMAT PARQUET)"
    )
    team_count = con.execute(
        "SELECT count(*) FROM Teams WHERE CompetitionId = ?", [comp_id]
    ).fetchone()[0]

    # Extract forum topics
    topics_path = str(output_dir / "topics.parquet")
    con.execute(
        f"COPY (SELECT * FROM ForumTopics WHERE ForumId IN ({forum_ids_sql})) TO '{topics_path}' (FORMAT PARQUET)"
    )
    topic_count = con.execute(
        f"SELECT count(*) FROM ForumTopics WHERE ForumId IN ({forum_ids_sql})"
    ).fetchone()[0]

    # Extract forum messages for those topics
    messages_path = str(output_dir / "messages.parquet")
    con.execute(
        f"COPY (SELECT fm.* FROM ForumMessages fm JOIN ForumTopics ft ON fm.ForumTopicId = ft.Id WHERE ft.ForumId IN ({forum_ids_sql})) TO '{messages_path}' (FORMAT PARQUET)"
    )
    message_count = con.execute(
        f"SELECT count(*) FROM ForumMessages fm JOIN ForumTopics ft ON fm.ForumTopicId = ft.Id WHERE ft.ForumId IN ({forum_ids_sql})"
    ).fetchone()[0]
    meta = {
        "competitionId": comp_id,
        "slug": comp["Slug"],
        "title": comp["Title"],
        "forumIds": forum_ids,
        "teamCount": team_count,
        "topicCount": topic_count,
        "messageCount": message_count,
    }
    (output_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")

    result = {
        "status": "extracted",
        "outputDir": str(output_dir),
        **meta,
    }
    if topic_count == 0:
        result["warning"] = (
            "No forum topics found. The competition may be too new for meta-kaggle to have data. "
            "Consider using Kaggle API or the kaggle-fetch skill to fetch discussions directly."
        )
    print(json.dumps(result, indent=2))


def cmd_list_extracted() -> None:
    """List already extracted competitions."""
    results = []
    for d in sorted(DATA_DIR.iterdir()):
        meta_file = d / "meta.json"
        if d.is_dir() and meta_file.exists():
            meta = json.loads(meta_file.read_text())
            results.append(meta)
    print(json.dumps(results, indent=2))


def main():
    parser = argparse.ArgumentParser(
        description="Extract competition subset from meta-kaggle"
    )
    parser.add_argument("slug", nargs="?", help="Competition slug to extract")
    parser.add_argument(
        "--list", action="store_true", help="List already extracted competitions"
    )
    parser.add_argument(
        "--update", action="store_true", help="Force re-extract even if exists"
    )
    parser.add_argument(
        "--include-datasets",
        action="store_true",
        help="Include related dataset forums",
    )
    parser.add_argument(
        "--include-models",
        action="store_true",
        help="Include related model forums",
    )
    args = parser.parse_args()

    if args.list:
        cmd_list_extracted()
        return

    if not args.slug:
        parser.print_help()
        sys.exit(1)

    if not check_data_exists():
        print(
            json.dumps(
                {
                    "error": "data_missing",
                    "message": "Source CSV files not found. Run sync.py first.",
                },
                indent=2,
            )
        )
        sys.exit(1)

    con = duckdb.connect()
    for csv_name in TARGET_CSVS:
        table_name = csv_name.replace(".csv", "")
        con.execute(
            f"CREATE VIEW {table_name} AS SELECT * FROM read_csv('{DATA_DIR / csv_name}', auto_detect=true, sample_size=10000, ignore_errors=true, strict_mode=false)"
        )

    comp = find_competition(con, args.slug)
    if not comp:
        sys.exit(1)

    output_dir = DATA_DIR / comp["Slug"]
    if output_dir.exists() and not args.update:
        meta_file = output_dir / "meta.json"
        if meta_file.exists():
            meta = json.loads(meta_file.read_text())
            print(
                json.dumps(
                    {
                        "status": "already_exists",
                        "message": f"Subset already exists. Use --update to re-extract.",
                        "outputDir": str(output_dir),
                        **meta,
                    },
                    indent=2,
                )
            )
            return

    extract(
        con,
        comp,
        output_dir,
        include_datasets=args.include_datasets,
        include_models=args.include_models,
    )


if __name__ == "__main__":
    main()
