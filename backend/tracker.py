import os
import io
import re
import csv
import time
import json
import shutil
import sqlite3
import subprocess
import threading
import unicodedata
from tinytag import TinyTag
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
from flask_cors import CORS

BASE_DIR        = os.path.dirname(__file__)
CONFIG_PATH     = os.path.join(BASE_DIR, "config.json")
STATIC_DIR      = os.path.join(BASE_DIR, "static")
DEFAULT_WATCH   = "/home/cotions/Downloads"
DEFAULT_DATA    = os.path.join(os.path.expanduser("~"), ".local", "share", "channelvault")

app = Flask(__name__, static_folder=STATIC_DIR)
CORS(app)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config():
    cfg = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    cfg.setdefault("watch_directory", DEFAULT_WATCH)
    cfg.setdefault("data_directory", DEFAULT_DATA)
    return cfg

def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)

def get_db_path():
    return os.path.join(load_config()["data_directory"], "videos.db")

def get_artist_thumbs_dir():
    return os.path.join(load_config()["data_directory"], "artist_thumbs")

def ensure_data_dir(data_dir):
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "artist_thumbs"), exist_ok=True)

_INVALID_CHARS = re.compile(r'[/\\:*?"<>|]')

def _safe_dirname(name):
    return _INVALID_CHARS.sub("-", name).strip()

def sync_artist_folders():
    from collections import defaultdict
    cfg = load_config()
    artist_thumbs_dir = os.path.join(cfg["data_directory"], "artist_thumbs")
    thumbs_dir        = os.path.join(cfg["data_directory"], "thumbs")
    os.makedirs(artist_thumbs_dir, exist_ok=True)
    try:
        conn = get_conn()
        rows = conn.execute(
            """SELECT channel_name, video_id FROM downloaded_videos
               WHERE channel_name IS NOT NULL AND channel_name != ''
               ORDER BY downloaded_at ASC"""
        ).fetchall()
        conn.close()
        channels = defaultdict(list)
        for row in rows:
            channels[row["channel_name"]].append(row["video_id"])

        for name, video_ids in channels.items():
            safe = _safe_dirname(name)
            artist_dir = os.path.join(artist_thumbs_dir, safe)
            os.makedirs(artist_dir, exist_ok=True)
            for video_id in video_ids:
                for ext in (".jpg", ".jpeg", ".webp", ".png"):
                    src = os.path.join(thumbs_dir, f"{video_id}{ext}")
                    dest = os.path.join(artist_dir, f"{video_id}{ext}")
                    if os.path.exists(src) and not os.path.exists(dest):
                        shutil.move(src, dest)

        # Remove thumbs dir if now empty
        if os.path.isdir(thumbs_dir) and not os.listdir(thumbs_dir):
            os.rmdir(thumbs_dir)
            print("[artist_folders] Removed empty thumbs dir")
    except Exception as e:
        print(f"[artist_folders] {e}")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_conn():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute('''
        CREATE TABLE IF NOT EXISTS downloaded_videos (
            video_id         TEXT PRIMARY KEY,
            title            TEXT,
            channel_name     TEXT,
            url              TEXT,
            file_path        TEXT,
            genre            TEXT,
            description      TEXT,
            recorded_date    TEXT,
            duration_secs    REAL,
            file_size_bytes  INTEGER,
            downloaded_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            view_count       INTEGER,
            like_count       INTEGER,
            stats_updated_at TIMESTAMP,
            status           TEXT DEFAULT 'downloaded'
        )
    ''')

    # Migrate: add status column to existing DB if missing
    cols = [row[1] for row in conn.execute("PRAGMA table_info(downloaded_videos)").fetchall()]
    if "status" not in cols:
        conn.execute("ALTER TABLE downloaded_videos ADD COLUMN status TEXT DEFAULT 'downloaded'")
        conn.execute("UPDATE downloaded_videos SET status='downloaded' WHERE status IS NULL")

    # Migrate: absorb wanted_videos table if it still exists
    existing = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='wanted_videos'"
    ).fetchone()
    if existing:
        conn.execute('''
            INSERT OR IGNORE INTO downloaded_videos (video_id, title, channel_name, url, status, downloaded_at)
            SELECT video_id, title, channel_name, url, 'wanted', wanted_at FROM wanted_videos
        ''')
        conn.execute("DROP TABLE wanted_videos")

    conn.execute('''
        CREATE TABLE IF NOT EXISTS playlists (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS playlist_items (
            playlist_id INTEGER NOT NULL,
            video_id    TEXT NOT NULL,
            added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (playlist_id, video_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS watch_sessions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id      TEXT NOT NULL,
            started_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            watched_secs  REAL DEFAULT 0,
            position_secs REAL DEFAULT 0,
            duration_secs REAL,
            completed     INTEGER DEFAULT 0
        )
    ''')

    # Creator profiles scraped from the channel "About" panel (latest snapshot).
    conn.execute('''
        CREATE TABLE IF NOT EXISTS creators (
            channel_name     TEXT PRIMARY KEY,
            handle           TEXT,
            channel_url      TEXT,
            description      TEXT,
            country          TEXT,
            joined_date      TEXT,
            subscriber_count INTEGER,
            subscribers_text TEXT,
            video_count      INTEGER,
            total_views      INTEGER,
            links            TEXT,
            email            TEXT,
            captured_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    conn.close()

# ---------------------------------------------------------------------------
# Metadata extraction
# ---------------------------------------------------------------------------

def _meta_from_tinytag(file_path):
    """Read tags via TinyTag (mp4/m4a/etc). Raises on unsupported containers."""
    tag = TinyTag.get(file_path)
    other       = tag.other if hasattr(tag, "other") and tag.other else {}
    description = other.get("description") or other.get("longdesc") or other.get("long_description")
    if isinstance(description, list):
        description = description[0] if description else None
    year = tag.year
    if isinstance(year, list):
        year = year[0] if year else None
    return {
        "url":           tag.comment,
        "title":         tag.title,
        "artist":        tag.artist,
        "genre":         tag.genre,
        "description":   description,
        "recorded_date": str(year) if year else None,
        "duration":      tag.duration,
        "filesize":      tag.filesize,
    }


def _meta_from_ffprobe(file_path):
    """Fallback reader for containers TinyTag can't parse (webm/mkv)."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", file_path],
        capture_output=True, text=True,
    )
    fmt  = (json.loads(out.stdout or "{}")).get("format", {})
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    date = tags.get("date") or ""
    year = date[:4] if len(date) >= 4 and date[:4].isdigit() else None
    try:
        filesize = int(fmt.get("size"))
    except (TypeError, ValueError):
        filesize = os.path.getsize(file_path)
    try:
        duration = float(fmt.get("duration"))
    except (TypeError, ValueError):
        duration = None
    return {
        "url":           tags.get("comment") or tags.get("purl"),
        "title":         tags.get("title"),
        "artist":        tags.get("artist"),
        "genre":         tags.get("genre"),
        "description":   tags.get("description") or tags.get("synopsis"),
        "recorded_date": year,
        "duration":      duration,
        "filesize":      filesize,
    }


def process_video_file(file_path):
    result = {"file": file_path, "status": None, "title": None, "video_id": None}
    try:
        try:
            meta = _meta_from_tinytag(file_path)
        except Exception:
            meta = None
        # TinyTag failed (unsupported container) or has no URL → try ffprobe.
        if not meta or not meta.get("url"):
            meta = _meta_from_ffprobe(file_path)

        url = meta.get("url")
        if not url or "youtube.com" not in url:
            result["status"] = "skipped"
            return result

        match = re.search(r"v=([a-zA-Z0-9_-]{11})", url)
        if not match:
            result["status"] = "skipped"
            return result
        video_id = match.group(1)

        title         = meta.get("title")
        artist        = meta.get("artist")
        description   = meta.get("description")
        recorded_date = meta.get("recorded_date")

        with _db_lock:
            conn = get_conn()
            # UPSERT: insert new, or promote wanted/ignored → downloaded
            conn.execute('''
                INSERT INTO downloaded_videos
                    (video_id, title, channel_name, url, file_path,
                     genre, description, recorded_date, duration_secs, file_size_bytes, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'downloaded')
                ON CONFLICT(video_id) DO UPDATE SET
                    title=excluded.title,
                    channel_name=excluded.channel_name,
                    url=excluded.url,
                    file_path=excluded.file_path,
                    genre=excluded.genre,
                    description=excluded.description,
                    recorded_date=excluded.recorded_date,
                    duration_secs=excluded.duration_secs,
                    file_size_bytes=excluded.file_size_bytes,
                    downloaded_at=CURRENT_TIMESTAMP,
                    status='downloaded'
                WHERE downloaded_videos.status != 'downloaded'
            ''', (video_id, title, artist, url, file_path,
                  meta.get("genre"), description, recorded_date, meta.get("duration"), meta.get("filesize")))
            conn.commit()
            conn.close()

        result.update({"status": "tracked", "title": title, "video_id": video_id})
        print(f"[tracker] Tracked: {title} ({video_id})")
        # Copy thumbnail directly to artist folder
        if artist:
            artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(artist))
            os.makedirs(artist_dir, exist_ok=True)
            base = os.path.splitext(file_path)[0]
            for ext in (".jpg", ".jpeg", ".webp", ".png"):
                src = base + ext
                if os.path.exists(src):
                    dest = os.path.join(artist_dir, f"{video_id}{ext}")
                    if not os.path.exists(dest):
                        shutil.copy2(src, dest)
                    break
    except Exception as e:
        result["status"] = f"error: {e}"
        print(f"[tracker] Error parsing {file_path}: {e}")
    return result

# ---------------------------------------------------------------------------
# File watcher
# ---------------------------------------------------------------------------

def _is_ignored(path):
    """Return True if any ancestor dir (up to watch root) contains .vaultIgnore."""
    cfg = load_config()
    watch_root = os.path.realpath(cfg.get("watch_directory", DEFAULT_WATCH))
    current = os.path.realpath(os.path.dirname(path) if not os.path.isdir(path) else path)
    while True:
        if os.path.exists(os.path.join(current, ".vaultIgnore")):
            return True
        if current == watch_root or current == os.path.dirname(current):
            break
        current = os.path.dirname(current)
    return False


class VideoDownloadHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.lower().endswith((".mp4", ".mkv", ".webm", ".avi", ".mov")):
            if _is_ignored(event.src_path):
                return
            time.sleep(2)
            process_video_file(event.src_path)

_observer      = None
_observer_lock = threading.Lock()
_db_lock       = threading.Lock()

def start_observer(directory):
    global _observer
    with _observer_lock:
        if _observer and _observer.is_alive():
            _observer.stop()
            _observer.join()
        if not os.path.isdir(directory):
            print(f"[watcher] Directory not found: {directory}")
            return
        handler   = VideoDownloadHandler()
        _observer = Observer()
        _observer.schedule(handler, path=directory, recursive=True)
        _observer.start()
        print(f"[watcher] Monitoring {directory}")

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/")
def ui():
    return send_from_directory(STATIC_DIR, "index.html")

@app.get("/config")
def get_config():
    return jsonify(load_config())

@app.post("/config")
def set_config():
    body = request.get_json(silent=True) or {}
    cfg  = load_config()

    if "watch_directory" in body:
        directory = body["watch_directory"].strip()
        if not directory:
            return jsonify({"ok": False, "error": "watch_directory is required"}), 400
        if not os.path.isdir(directory):
            return jsonify({"ok": False, "error": f"Directory not found: {directory}"}), 400
        cfg["watch_directory"] = directory
        save_config(cfg)
        start_observer(directory)

    if "data_directory" in body:
        data_dir = body["data_directory"].strip()
        if not data_dir:
            return jsonify({"ok": False, "error": "data_directory is required"}), 400
        try:
            ensure_data_dir(data_dir)
        except Exception as e:
            return jsonify({"ok": False, "error": f"Cannot create directory: {e}"}), 400
        old_db = os.path.join(cfg["data_directory"], "videos.db")
        new_db = os.path.join(data_dir, "videos.db")
        if os.path.exists(old_db) and not os.path.exists(new_db):
            shutil.copy2(old_db, new_db)
        cfg["data_directory"] = data_dir
        save_config(cfg)
        init_db()

    return jsonify({"ok": True, **cfg})

@app.get("/browse")
def browse():
    import subprocess
    title = request.args.get("title", "Select folder to watch")
    try:
        result = subprocess.run(
            ["zenity", "--file-selection", "--directory", f"--title={title}"],
            capture_output=True, text=True, timeout=60
        )
        chosen = result.stdout.strip()
        if chosen:
            return jsonify({"ok": True, "directory": chosen})
    except Exception:
        pass
    return jsonify({"ok": False, "directory": None})

@app.get("/browse-file")
def browse_file():
    import subprocess
    title = request.args.get("title", "Select video file")
    try:
        result = subprocess.run(
            ["zenity", "--file-selection", f"--title={title}",
             "--file-filter=Video files (mp4 mkv webm avi mov) | *.mp4 *.mkv *.webm *.avi *.mov",
             "--file-filter=All files | *"],
            capture_output=True, text=True, timeout=60
        )
        chosen = result.stdout.strip()
        if chosen:
            return jsonify({"ok": True, "file": chosen})
    except Exception:
        pass
    return jsonify({"ok": False, "file": None})

@app.post("/scan")
def scan():
    cfg       = load_config()
    directory = cfg.get("watch_directory", DEFAULT_WATCH)
    if not os.path.isdir(directory):
        return jsonify({"ok": False, "error": f"Directory not found: {directory}"}), 400

    files = []
    for root_dir, dirs, filenames in os.walk(directory):
        if os.path.exists(os.path.join(root_dir, ".vaultIgnore")):
            dirs.clear()
            continue
        for f in filenames:
            if f.lower().endswith((".mp4", ".mkv", ".webm", ".avi", ".mov")):
                files.append(os.path.join(root_dir, f))

    BATCH = 10

    def generate():
        total   = len(files)
        tracked = skipped = errors = 0
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        for i, fp in enumerate(files):
            r = process_video_file(fp)
            if r["status"] == "tracked":
                tracked += 1
            elif r["status"] == "skipped":
                skipped += 1
            elif r["status"] and r["status"].startswith("error"):
                errors += 1

            if (i + 1) % BATCH == 0 or (i + 1) == total:
                yield f"data: {json.dumps({'type': 'progress', 'done': i + 1, 'total': total, 'tracked': tracked, 'skipped': skipped, 'errors': errors, 'last': r})}\n\n"

        sync_artist_folders()
        yield f"data: {json.dumps({'type': 'done', 'total': total, 'tracked': tracked, 'skipped': skipped, 'errors': errors})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/check-video/<video_id>")
def check_video(video_id):
    conn = get_conn()
    row  = conn.execute(
        "SELECT * FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    conn.close()
    if row:
        d = dict(row)
        return jsonify({"downloaded": d.get("status") == "downloaded", "status": d.get("status"), "data": d})
    return jsonify({"downloaded": False, "status": None})

@app.post("/update-stats/<video_id>")
def update_stats(video_id):
    body       = request.get_json(silent=True) or {}
    view_count = body.get("view_count")
    like_count = body.get("like_count")
    conn = get_conn()
    conn.execute('''
        UPDATE downloaded_videos
        SET view_count = ?, like_count = ?, stats_updated_at = CURRENT_TIMESTAMP
        WHERE video_id = ? AND status = 'downloaded'
    ''', (view_count, like_count, video_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.get("/videos/ids")
def list_video_ids():
    conn = get_conn()
    rows = conn.execute("SELECT video_id, status FROM downloaded_videos").fetchall()
    conn.close()
    downloaded = [r["video_id"] for r in rows if r["status"] == "downloaded"]
    wanted     = [r["video_id"] for r in rows if r["status"] == "wanted"]
    ignored    = [r["video_id"] for r in rows if r["status"] == "ignored"]
    return jsonify({"ids": downloaded, "wanted_ids": wanted, "ignored_ids": ignored})

def _upsert_mark(video_id, title, channel_name, url, status):
    conn = get_conn()
    conn.execute('''
        INSERT INTO downloaded_videos (video_id, title, channel_name, url, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
            title=COALESCE(excluded.title, downloaded_videos.title),
            channel_name=COALESCE(excluded.channel_name, downloaded_videos.channel_name),
            url=COALESCE(excluded.url, downloaded_videos.url),
            status=excluded.status
        WHERE downloaded_videos.status != 'downloaded'
    ''', (video_id, title, channel_name, url, status))
    conn.commit()
    conn.close()

@app.post("/want-to-download")
def add_wanted():
    body         = request.get_json(silent=True) or {}
    video_id     = (body.get("video_id") or "").strip()
    if not video_id:
        return jsonify({"ok": False, "error": "video_id required"}), 400
    _upsert_mark(video_id, body.get("title"), body.get("channel_name"), body.get("url"), "wanted")
    return jsonify({"ok": True})

@app.post("/do-not-want")
def add_ignored():
    body         = request.get_json(silent=True) or {}
    video_id     = (body.get("video_id") or "").strip()
    if not video_id:
        return jsonify({"ok": False, "error": "video_id required"}), 400
    _upsert_mark(video_id, body.get("title"), body.get("channel_name"), body.get("url"), "ignored")
    return jsonify({"ok": True})

@app.delete("/mark/<video_id>")
def remove_mark(video_id):
    conn = get_conn()
    conn.execute(
        "DELETE FROM downloaded_videos WHERE video_id = ? AND status != 'downloaded'",
        (video_id,)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.get("/wanted")
def list_wanted():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM downloaded_videos WHERE status='wanted' ORDER BY downloaded_at DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.get("/ignored")
def list_ignored():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM downloaded_videos WHERE status='ignored' ORDER BY downloaded_at DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.get("/videos")
def list_videos():
    conn = get_conn()
    rows = conn.execute('''
        SELECT v.*,
               COALESCE(w.watch_count, 0) AS watch_count,
               w.last_watched_at
        FROM downloaded_videos v
        LEFT JOIN (
            SELECT video_id, COUNT(*) AS watch_count, MAX(updated_at) AS last_watched_at
            FROM watch_sessions WHERE completed = 1
            GROUP BY video_id
        ) w ON w.video_id = v.video_id
        WHERE v.status='downloaded' ORDER BY v.downloaded_at DESC
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

_STREAM_MIMES = {
    ".mp4":  "video/mp4",
    ".mkv":  "video/x-matroska",
    ".webm": "video/webm",
    ".avi":  "video/x-msvideo",
    ".mov":  "video/quicktime",
}

@app.get("/stream/<video_id>")
def stream_video(video_id):
    conn = get_conn()
    row  = conn.execute(
        "SELECT file_path FROM downloaded_videos WHERE video_id = ? AND status = 'downloaded'",
        (video_id,)
    ).fetchone()
    conn.close()
    if not row or not row["file_path"]:
        return jsonify({"ok": False, "error": "no file for video"}), 404
    path = row["file_path"]
    if not os.path.isfile(path):
        return jsonify({"ok": False, "error": "file missing on disk"}), 404
    ext  = os.path.splitext(path)[1].lower()
    from flask import send_file
    return send_file(path, mimetype=_STREAM_MIMES.get(ext, "application/octet-stream"), conditional=True)

# ---------------------------------------------------------------------------
# Watch history
# ---------------------------------------------------------------------------

# A session only counts as "watched" once the user has actually played at
# least this fraction of the video (accumulated playtime, not seek position).
WATCHED_THRESHOLD = 0.7
# Ignore trivially short sessions even when duration is unknown.
MIN_WATCHED_SECS = 30

@app.post("/watch-progress/<video_id>")
def watch_progress(video_id):
    body          = request.get_json(silent=True) or {}
    session_id    = body.get("session_id")
    watched_secs  = float(body.get("watched_secs") or 0)
    position_secs = float(body.get("position_secs") or 0)
    duration_secs = body.get("duration_secs")
    duration_secs = float(duration_secs) if duration_secs else None

    if duration_secs:
        completed = 1 if watched_secs >= duration_secs * WATCHED_THRESHOLD else 0
    else:
        completed = 1 if watched_secs >= MIN_WATCHED_SECS else 0

    with _db_lock:
        conn = get_conn()
        if session_id:
            conn.execute('''
                UPDATE watch_sessions SET
                    watched_secs  = ?,
                    position_secs = ?,
                    duration_secs = COALESCE(?, duration_secs),
                    completed     = MAX(completed, ?),
                    updated_at    = CURRENT_TIMESTAMP
                WHERE id = ? AND video_id = ?
            ''', (watched_secs, position_secs, duration_secs, completed, session_id, video_id))
        else:
            cur = conn.execute('''
                INSERT INTO watch_sessions (video_id, watched_secs, position_secs, duration_secs, completed)
                VALUES (?, ?, ?, ?, ?)
            ''', (video_id, watched_secs, position_secs, duration_secs, completed))
            session_id = cur.lastrowid
        conn.commit()
        conn.close()

    return jsonify({"ok": True, "session_id": session_id, "completed": bool(completed)})

@app.get("/watch-history")
def watch_history():
    limit = min(int(request.args.get("limit", 50)), 200)
    conn = get_conn()
    rows = conn.execute('''
        SELECT s.id, s.video_id, s.started_at, s.updated_at,
               s.watched_secs, s.position_secs, s.duration_secs, s.completed,
               v.title, v.channel_name
        FROM watch_sessions s
        LEFT JOIN downloaded_videos v ON v.video_id = s.video_id
        WHERE s.completed = 1
        ORDER BY s.updated_at DESC
        LIMIT ?
    ''', (limit,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.delete("/watch-history/<video_id>")
def clear_watch_history(video_id):
    conn = get_conn()
    conn.execute("DELETE FROM watch_sessions WHERE video_id = ?", (video_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

# ---------------------------------------------------------------------------
# Playlists
# ---------------------------------------------------------------------------

@app.get("/playlists")
def list_playlists():
    conn = get_conn()
    rows = conn.execute('''
        SELECT p.id, p.name, p.created_at, COUNT(pi.video_id) AS video_count
        FROM playlists p
        LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at ASC
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.post("/playlists")
def create_playlist():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    conn = get_conn()
    cur  = conn.execute("INSERT INTO playlists (name) VALUES (?)", (name,))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": new_id, "name": name})

@app.delete("/playlists/<int:playlist_id>")
def delete_playlist(playlist_id):
    conn = get_conn()
    conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
    conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.get("/playlists/<int:playlist_id>")
def get_playlist(playlist_id):
    conn = get_conn()
    pl = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if not pl:
        conn.close()
        return jsonify({"ok": False, "error": "not found"}), 404
    rows = conn.execute('''
        SELECT v.*, pi.added_at AS playlist_added_at
        FROM playlist_items pi
        JOIN downloaded_videos v ON v.video_id = pi.video_id
        WHERE pi.playlist_id = ?
        ORDER BY pi.added_at ASC
    ''', (playlist_id,)).fetchall()
    conn.close()
    return jsonify({"ok": True, "playlist": dict(pl), "videos": [dict(r) for r in rows]})

@app.post("/playlists/<int:playlist_id>/videos")
def add_playlist_video(playlist_id):
    body     = request.get_json(silent=True) or {}
    video_id = (body.get("video_id") or "").strip()
    if not video_id:
        return jsonify({"ok": False, "error": "video_id required"}), 400
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "playlist not found"}), 404
    conn.execute(
        "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id) VALUES (?, ?)",
        (playlist_id, video_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.delete("/playlists/<int:playlist_id>/videos/<video_id>")
def remove_playlist_video(playlist_id, video_id):
    conn = get_conn()
    conn.execute(
        "DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?",
        (playlist_id, video_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

EXPORT_FIELDS = [
    "video_id", "title", "channel_name", "url", "file_path",
    "genre", "description", "recorded_date", "duration_secs",
    "file_size_bytes", "downloaded_at", "view_count", "like_count",
    "stats_updated_at", "status",
]

def _export_rows():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM downloaded_videos ORDER BY downloaded_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/export/json")
def export_json():
    resp = Response(
        json.dumps(_export_rows(), indent=2, ensure_ascii=False),
        mimetype="application/json",
    )
    resp.headers["Content-Disposition"] = 'attachment; filename="channelvault-export.json"'
    return resp

@app.get("/export/csv")
def export_csv():
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(_export_rows())
    # BOM so Excel detects UTF-8
    resp = Response("\ufeff" + buf.getvalue(), mimetype="text/csv")
    resp.headers["Content-Disposition"] = 'attachment; filename="channelvault-export.csv"'
    return resp

@app.get("/userscript/channelvault.user.js")
@app.get("/channelvault.user.js")
def serve_userscript():
    userscript_path = os.path.join(BASE_DIR, "..", "userscript")
    response = send_from_directory(
        os.path.abspath(userscript_path),
        "channelvault.user.js",
        mimetype="application/javascript"
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.post("/videos/manual")
def add_video_manual():
    body     = request.get_json(silent=True) or {}
    raw_id   = (body.get("video_id") or "").strip()
    if not raw_id:
        return jsonify({"ok": False, "error": "video_id is required"}), 400

    # extract bare ID if caller passed a full URL
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", raw_id) or \
        re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", raw_id) or \
        re.search(r"/(?:shorts|embed|v)/([A-Za-z0-9_-]{11})", raw_id)
    video_id = m.group(1) if m else raw_id

    url = body.get("url") or f"https://www.youtube.com/watch?v={video_id}"

    with _db_lock:
        conn = get_conn()
        conn.execute('''
            INSERT INTO downloaded_videos
                (video_id, title, channel_name, url, file_path,
                 genre, description, recorded_date, duration_secs, file_size_bytes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'downloaded')
            ON CONFLICT(video_id) DO UPDATE SET
                title            = COALESCE(excluded.title, downloaded_videos.title),
                channel_name     = COALESCE(excluded.channel_name, downloaded_videos.channel_name),
                url              = COALESCE(excluded.url, downloaded_videos.url),
                file_path        = COALESCE(excluded.file_path, downloaded_videos.file_path),
                genre            = COALESCE(excluded.genre, downloaded_videos.genre),
                description      = COALESCE(excluded.description, downloaded_videos.description),
                recorded_date    = COALESCE(excluded.recorded_date, downloaded_videos.recorded_date),
                duration_secs    = COALESCE(excluded.duration_secs, downloaded_videos.duration_secs),
                file_size_bytes  = COALESCE(excluded.file_size_bytes, downloaded_videos.file_size_bytes),
                downloaded_at    = CURRENT_TIMESTAMP,
                status           = 'downloaded'
        ''', (
            video_id,
            body.get("title") or None,
            body.get("channel_name") or None,
            url,
            body.get("file_path") or None,
            body.get("genre") or None,
            body.get("description") or None,
            body.get("recorded_date") or None,
            body.get("duration_secs") or None,
            body.get("file_size_bytes") or None,
        ))
        conn.commit()
        conn.close()

    return jsonify({"ok": True, "video_id": video_id})


@app.post("/read-file-tags")
def read_file_tags():
    body      = request.get_json(silent=True) or {}
    file_path = (body.get("file_path") or "").strip()
    if not file_path or not os.path.isfile(file_path):
        return jsonify({"ok": False, "error": "File not found"}), 404
    try:
        try:
            meta = _meta_from_tinytag(file_path)
        except Exception:
            meta = None
        if not meta or not meta.get("url"):
            meta = _meta_from_ffprobe(file_path)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    url      = meta.get("url") or ""
    video_id = None
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", url)
    if m:
        video_id = m.group(1)
    else:
        m = re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", url)
        if m:
            video_id = m.group(1)

    return jsonify({
        "ok":           True,
        "video_id":     video_id,
        "title":        meta.get("title"),
        "channel_name": meta.get("artist"),
        "url":          url or (f"https://www.youtube.com/watch?v={video_id}" if video_id else None),
        "genre":        meta.get("genre"),
        "description":  meta.get("description"),
        "recorded_date":meta.get("recorded_date"),
        "duration_secs":meta.get("duration"),
    })


@app.post("/fetch-metadata/<video_id>")
def fetch_metadata(video_id):
    import subprocess, json as _json
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-download", "--no-playlist", url],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return jsonify({"ok": False, "error": "yt-dlp failed"}), 502
        info = _json.loads(result.stdout)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    upload_date = info.get("upload_date")  # YYYYMMDD
    recorded_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}" if upload_date and len(upload_date) == 8 else None

    with _db_lock:
        conn = get_conn()
        conn.execute('''
            UPDATE downloaded_videos SET
                title          = COALESCE(?, title),
                channel_name   = COALESCE(?, channel_name),
                url            = COALESCE(?, url),
                description    = COALESCE(?, description),
                recorded_date  = COALESCE(?, recorded_date),
                duration_secs  = COALESCE(?, duration_secs),
                view_count     = COALESCE(?, view_count),
                like_count     = COALESCE(?, like_count),
                stats_updated_at = CURRENT_TIMESTAMP
            WHERE video_id = ?
        ''', (
            info.get("title") or None,
            info.get("channel") or info.get("uploader") or None,
            info.get("webpage_url") or url,
            info.get("description") or None,
            recorded_date,
            info.get("duration") or None,
            info.get("view_count") or None,
            info.get("like_count") or None,
            video_id,
        ))
        conn.commit()
        conn.close()

    return jsonify({"ok": True, "video_id": video_id})


@app.delete("/videos/<video_id>")
def delete_video(video_id):
    conn = get_conn()
    conn.execute("DELETE FROM downloaded_videos WHERE video_id = ?", (video_id,))
    conn.execute("DELETE FROM watch_sessions WHERE video_id = ?", (video_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.get("/data-quality/duplicates")
def data_quality_duplicates():
    cfg = load_config()
    watch_dir = cfg.get("watch_directory", DEFAULT_WATCH)
    from collections import defaultdict
    groups = defaultdict(list)
    for root, _dirs, files in os.walk(watch_dir):
        for fname in files:
            if not fname.lower().endswith((".mp4", ".mkv", ".webm", ".avi", ".mov")):
                continue
            fpath = os.path.join(root, fname)
            try:
                try:
                    meta = _meta_from_tinytag(fpath)
                except Exception:
                    meta = None
                if not meta or not meta.get("url"):
                    meta = _meta_from_ffprobe(fpath)
                url = meta.get("url") or ""
                m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", url) or \
                    re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", url)
                if m:
                    groups[m.group(1)].append(fpath)
            except Exception:
                pass
    duplicates = [
        {"video_id": vid, "title": None, "files": paths}
        for vid, paths in groups.items()
        if len(paths) > 1
    ]
    if duplicates:
        conn = get_conn()
        for d in duplicates:
            row = conn.execute(
                "SELECT title, channel_name FROM downloaded_videos WHERE video_id = ?", (d["video_id"],)
            ).fetchone()
            if row:
                d["title"] = row["title"]
                d["channel_name"] = row["channel_name"]
        conn.close()
    return jsonify({"ok": True, "duplicates": duplicates})


@app.get("/data-quality/missing")
def data_quality_missing():
    conn = get_conn()
    rows = conn.execute(
        "SELECT video_id, title, channel_name, file_path FROM downloaded_videos "
        "WHERE file_path IS NOT NULL AND status = 'downloaded'"
    ).fetchall()
    conn.close()
    missing = [
        {"video_id": r["video_id"], "title": r["title"],
         "channel_name": r["channel_name"], "file_path": r["file_path"]}
        for r in rows
        if not any(os.path.isfile(unicodedata.normalize(f, r["file_path"])) for f in ("NFC", "NFD", "NFKC", "NFKD"))
    ]
    return jsonify({"ok": True, "missing": missing})


@app.get("/artist-thumb/<path:name>")
def serve_artist_thumb(name):
    artist_thumbs_dir = get_artist_thumbs_dir()
    safe = _safe_dirname(name)
    artist_dir = os.path.join(artist_thumbs_dir, safe)
    if os.path.isdir(artist_dir):
        for fname in os.listdir(artist_dir):
            if fname.lower().endswith((".jpg", ".jpeg", ".webp", ".png")):
                return send_from_directory(artist_dir, fname)
    return ("", 404)


@app.get("/thumb/<video_id>")
def serve_thumb(video_id):
    conn = get_conn()
    row = conn.execute(
        "SELECT channel_name, file_path FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    conn.close()
    # Look in artist folder
    if row and row["channel_name"]:
        artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(row["channel_name"]))
        for ext in (".jpg", ".jpeg", ".webp", ".png"):
            candidate = os.path.join(artist_dir, f"{video_id}{ext}")
            if os.path.exists(candidate):
                return send_from_directory(artist_dir, f"{video_id}{ext}")
    # Fallback to original file location
    if row and row["file_path"]:
        base = os.path.splitext(row["file_path"])[0]
        for ext in (".jpg", ".jpeg", ".webp", ".png"):
            candidate = base + ext
            if os.path.exists(candidate):
                return send_from_directory(os.path.dirname(os.path.abspath(candidate)), os.path.basename(candidate))
    return ("", 404)

# ---------------------------------------------------------------------------
# Creator profiles (scraped from channel "About" panel)
# ---------------------------------------------------------------------------

_CREATOR_FIELDS = [
    "handle", "channel_url", "description", "country", "joined_date",
    "subscriber_count", "subscribers_text", "video_count", "total_views",
    "links", "email",
]


def _creator_row_to_dict(row):
    d = dict(row)
    try:
        d["links"] = json.loads(d["links"]) if d.get("links") else []
    except (TypeError, ValueError):
        d["links"] = []
    return d


@app.post("/creator")
def upsert_creator():
    body         = request.get_json(silent=True) or {}
    channel_name = (body.get("channel_name") or "").strip()
    if not channel_name:
        return jsonify({"ok": False, "error": "channel_name required"}), 400

    links = body.get("links")
    links_json = json.dumps(links) if isinstance(links, (list, dict)) else (links or None)
    vals = {
        "channel_name":     channel_name,
        "handle":           body.get("handle"),
        "channel_url":      body.get("channel_url"),
        "description":      body.get("description"),
        "country":          body.get("country"),
        "joined_date":      body.get("joined_date"),
        "subscriber_count": body.get("subscriber_count"),
        "subscribers_text": body.get("subscribers_text"),
        "video_count":      body.get("video_count"),
        "total_views":      body.get("total_views"),
        "links":            links_json,
        "email":            body.get("email"),
    }
    # Only overwrite a stored field when the new payload actually carries a value,
    # so a partial capture never blanks out previously-saved data.
    set_clauses = ", ".join(
        f"{f}=COALESCE(excluded.{f}, creators.{f})" for f in _CREATOR_FIELDS
    )
    with _db_lock:
        conn = get_conn()
        conn.execute(f'''
            INSERT INTO creators
                (channel_name, handle, channel_url, description, country, joined_date,
                 subscriber_count, subscribers_text, video_count, total_views, links, email)
            VALUES (:channel_name, :handle, :channel_url, :description, :country, :joined_date,
                    :subscriber_count, :subscribers_text, :video_count, :total_views, :links, :email)
            ON CONFLICT(channel_name) DO UPDATE SET
                {set_clauses},
                captured_at=CURRENT_TIMESTAMP
        ''', vals)
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


@app.get("/creators")
def list_creators():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM creators ORDER BY channel_name").fetchall()
    conn.close()
    return jsonify([_creator_row_to_dict(r) for r in rows])


@app.get("/creator/<path:channel_name>")
def get_creator(channel_name):
    conn = get_conn()
    row  = conn.execute(
        "SELECT * FROM creators WHERE channel_name = ?", (channel_name,)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "not found"}), 404
    return jsonify(_creator_row_to_dict(row))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cfg = load_config()
    ensure_data_dir(cfg["data_directory"])
    # One-time migration: copy old backend/videos.db to data_directory if new location is empty
    legacy_db = os.path.join(BASE_DIR, "videos.db")
    new_db    = get_db_path()
    if os.path.exists(legacy_db) and not os.path.exists(new_db):
        shutil.copy2(legacy_db, new_db)
        print(f"[init] Migrated DB to {new_db}")
    init_db()
    sync_artist_folders()
    watcher_thread = threading.Thread(
        target=start_observer, args=(cfg["watch_directory"],), daemon=True
    )
    watcher_thread.start()
    print("[api] Dashboard → http://localhost:3360")
    app.run(host="127.0.0.1", port=3360, debug=False)
