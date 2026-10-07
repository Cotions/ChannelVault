#!/usr/bin/env python3
"""One-off cleanup for problems found by the October 2026 data audit (#10-#16).

Dry run by default: prints what it would change and touches nothing. Pass
--apply to write. Stop the app first (a running instance holds its own view of
the DB and its watcher would react to the file deletes).

  backend/venv/bin/python scripts/data_cleanup.py            # report only
  backend/venv/bin/python scripts/data_cleanup.py --apply    # DB fixes
  backend/venv/bin/python scripts/data_cleanup.py --apply --delete-staging-dupes

DB fixes (all on the active profile's videos.db, after a backup copy next to it):
  names   channel_name with outer whitespace (U+3000 too) is trimmed
  dates   recorded_date "YYYYMMDD" / "YYYY-MM-DDT..." becomes "YYYY-MM-DD"
  paths   a file_path that no longer exists but resolves to exactly one file
          (outside _archive-import) is rewritten to that file
  sizes   file_size_bytes follows the file on disk
  watches a session marked watched with under 70% of a known length watched
          (an old rule counted any 30s as watched) goes back to unwatched
  credits (only with --credits, reads every file's tags) a collab credit the
          file carries ("A, B") comes back when a metadata fetch cut it to one
          of those names

Files (only with --delete-staging-dupes): a file in <watch>/_archive-import is
deleted when a tracked file outside it has the same size and the same bytes
(compared in full, so this reads both copies once).
"""
import argparse
import filecmp
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import tracker  # noqa: E402  (config, path resolution and helpers, same rules as the app)

STAGING = "_archive-import"


def under(path, folder):
    path, folder = os.path.realpath(path), os.path.realpath(folder)
    return path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write the DB fixes")
    ap.add_argument("--credits", action="store_true",
                    help="also restore collab credits from file tags (slow: reads every file)")
    ap.add_argument("--delete-staging-dupes", action="store_true",
                    help=f"with --apply: delete {STAGING} files byte-identical to a tracked file")
    args = ap.parse_args()

    if args.apply and tracker._port_busy(tracker.PORT):
        sys.exit(f"ChannelVault is running on port {tracker.PORT}. Close it first.")

    cfg     = tracker.load_config()
    db_path = tracker.get_db_path()
    staging = os.path.join(cfg.get("watch_directory", tracker.DEFAULT_WATCH), STAGING)
    print(f"profile: {cfg.get('profile_name')}  db: {db_path}")

    conn = tracker.get_conn()
    rows = conn.execute(
        "SELECT video_id, channel_name, recorded_date, file_path, file_size_bytes "
        "FROM downloaded_videos").fetchall()

    names, dates, paths, sizes, unresolved, credits = [], [], [], [], [], []
    tracked_files = {}                                # size -> [existing tracked paths]
    for r in rows:
        if r["channel_name"] is not None:
            clean = tracker._clean_name(r["channel_name"])
            if clean != r["channel_name"]:
                names.append((r["video_id"], r["channel_name"], clean))
        rd = r["recorded_date"]
        if rd and len(rd) > 4:
            norm = tracker._norm_date(rd)
            if norm and norm != rd:
                dates.append((r["video_id"], rd, norm))
        fp = r["file_path"]
        if not fp:
            continue
        real = fp if os.path.isfile(fp) else None
        if not real:
            hit = tracker.resolve_media_path(fp)
            if hit and not under(hit, staging):
                paths.append((r["video_id"], fp, hit))
                real = hit
            else:
                unresolved.append((r["video_id"], fp, hit))
        if real:
            size = os.path.getsize(real)
            if size != r["file_size_bytes"]:
                sizes.append((r["video_id"], r["file_size_bytes"], size))
            if not under(real, staging):
                tracked_files.setdefault(size, []).append(real)
            if args.credits and r["channel_name"]:
                try:
                    tag = tracker._clean_name(tracker._read_meta(real).get("artist"))
                except Exception:
                    tag = None
                current = tracker._clean_name(r["channel_name"])
                if tag and tag != current and len(tracker._artist_names(tag)) > 1 \
                        and current in tracker._artist_names(tag):
                    credits.append((r["video_id"], current, tag))

    watches = [tuple(r) for r in conn.execute(
        "SELECT s.id, s.video_id, s.watched_secs, COALESCE(s.duration_secs, v.duration_secs) "
        "FROM watch_sessions s LEFT JOIN downloaded_videos v ON v.video_id = s.video_id "
        "WHERE s.completed = 1 AND COALESCE(s.duration_secs, v.duration_secs) > 0 "
        "AND s.watched_secs < COALESCE(s.duration_secs, v.duration_secs) * ?",
        (tracker.WATCHED_THRESHOLD,))]

    def show(title, items, fmt):
        print(f"\n{title}: {len(items)}")
        for it in items[:8]:
            print("  " + fmt(it))
        if len(items) > 8:
            print(f"  ... {len(items) - 8} more")

    show("channel names to trim", names, lambda x: f"{x[0]}  {x[1]!r} -> {x[2]!r}")
    show("dates to normalise", dates, lambda x: f"{x[0]}  {x[1]} -> {x[2]}")
    show("stale paths to rewrite", paths, lambda x: f"{x[0]}  {x[1]}\n      -> {x[2]}")
    if args.credits:
        show("collab credits to restore", credits, lambda x: f"{x[0]}  {x[1]!r} -> {x[2]!r}")
    show("watches to un-mark (under 70% watched)", watches,
         lambda x: f"session {x[0]}  {x[1]}  {x[2]:.0f}s of {x[3]:.0f}s")
    show("sizes to correct", sizes, lambda x: f"{x[0]}  {x[1]} -> {x[2]}")
    show("paths left alone (missing, or only found in staging)", unresolved,
         lambda x: f"{x[0]}  {x[1]}" + (f"  (staging: {x[2]})" if x[2] else ""))

    # Staging copies that duplicate a tracked file. Same size is the cheap
    # filter; deletion needs a full byte compare.
    dupes = []
    if os.path.isdir(staging):
        for dirpath, _, files in os.walk(staging):
            for f in files:
                p = os.path.join(dirpath, f)
                try:
                    size = os.path.getsize(p)
                except OSError:
                    continue
                if size and size in tracked_files:
                    dupes.append((p, size, tracked_files[size]))
    show(f"{STAGING} files with a same-size tracked twin", dupes,
         lambda x: f"{x[0]}  ({x[1] / 1e9:.2f} GB)")
    print(f"  total {sum(d[1] for d in dupes) / 1e9:.1f} GB")

    if not args.apply:
        print("\nDry run. Nothing changed. Re-run with --apply to write.")
        return

    backup = f"{db_path}.before-cleanup-{time.strftime('%Y%m%d-%H%M%S')}"
    tracker._copy_db(db_path, backup)
    print(f"\nDB backup: {backup}")
    with conn:
        for vid, _, clean in names:
            conn.execute("UPDATE downloaded_videos SET channel_name=? WHERE video_id=?", (clean, vid))
        for vid, _, norm in dates:
            conn.execute("UPDATE downloaded_videos SET recorded_date=? WHERE video_id=?", (norm, vid))
        for vid, _, hit in paths:
            conn.execute("UPDATE downloaded_videos SET file_path=? WHERE video_id=?", (hit, vid))
        for vid, _, tag in credits:
            conn.execute("UPDATE downloaded_videos SET channel_name=? WHERE video_id=?", (tag, vid))
        for sid, *_ in watches:
            conn.execute("UPDATE watch_sessions SET completed = 0 WHERE id = ?", (sid,))
        for vid, _, size in sizes:
            conn.execute("UPDATE downloaded_videos SET file_size_bytes=? WHERE video_id=?", (size, vid))
    print(f"DB updated: {len(names)} names, {len(dates)} dates, {len(paths)} paths, {len(sizes)} sizes, {len(credits)} credits, {len(watches)} watches")
    conn.close()

    if args.delete_staging_dupes:
        freed = deleted = 0
        for p, size, twins in dupes:
            if any(filecmp.cmp(p, t, shallow=False) for t in twins):
                os.remove(p)
                freed += size
                deleted += 1
                print(f"  deleted {p}")
            else:
                print(f"  kept {p} (same size, different bytes)")
        print(f"Deleted {deleted} staging copies, freed {freed / 1e9:.1f} GB")

    print("\nStart the app and run a scan so artist folders/thumbs follow the trimmed names.")


if __name__ == "__main__":
    main()
