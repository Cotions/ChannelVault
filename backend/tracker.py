import os
import re
import time
import json
import shutil
import sqlite3
import threading
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

    conn.commit()
    conn.close()

# ---------------------------------------------------------------------------
# Metadata extraction
# ---------------------------------------------------------------------------

def process_video_file(file_path):
    result = {"file": file_path, "status": None, "title": None, "video_id": None}
    try:
        tag = TinyTag.get(file_path)
        url = tag.comment
        if not url or "youtube.com" not in url:
            result["status"] = "skipped"
            return result

        match = re.search(r"v=([a-zA-Z0-9_-]{11})", url)
        if not match:
            result["status"] = "skipped"
            return result
        video_id = match.group(1)

        other         = tag.other if hasattr(tag, "other") and tag.other else {}
        description   = other.get("description") or other.get("longdesc") or other.get("long_description")
        if isinstance(description, list):
            description = description[0] if description else None
        year          = tag.year
        if isinstance(year, list):
            year = year[0] if year else None
        recorded_date = str(year) if year else None

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
            ''', (video_id, tag.title, tag.artist, url, file_path,
                  tag.genre, description, recorded_date, tag.duration, tag.filesize))
            conn.commit()
            conn.close()

        result.update({"status": "tracked", "title": tag.title, "video_id": video_id})
        print(f"[tracker] Tracked: {tag.title} ({video_id})")
        # Copy thumbnail directly to artist folder
        if tag.artist:
            artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(tag.artist))
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
        if not event.is_directory and event.src_path.endswith((".mp4", ".mkv")):
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
            if f.endswith((".mp4", ".mkv")):
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
    rows = conn.execute(
        "SELECT * FROM downloaded_videos WHERE status='downloaded' ORDER BY downloaded_at DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

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
    video_id = (body.get("video_id") or "").strip()
    if not video_id:
        return jsonify({"ok": False, "error": "video_id is required"}), 400

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
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

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
