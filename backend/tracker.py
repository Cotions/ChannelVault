import os
import re
import time
import json
import sqlite3
import threading
from tinytag import TinyTag
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
from flask_cors import CORS

BASE_DIR        = os.path.dirname(__file__)
DB_PATH         = os.path.join(BASE_DIR, "videos.db")
CONFIG_PATH     = os.path.join(BASE_DIR, "config.json")
STATIC_DIR      = os.path.join(BASE_DIR, "static")
DEFAULT_WATCH   = "/home/cotions/Downloads"

app = Flask(__name__, static_folder=STATIC_DIR)
CORS(app)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {"watch_directory": DEFAULT_WATCH}

def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_conn():
    conn = sqlite3.connect(DB_PATH)
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
            stats_updated_at TIMESTAMP
        )
    ''')
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
            conn.execute('''
                INSERT OR IGNORE INTO downloaded_videos
                    (video_id, title, channel_name, url, file_path,
                     genre, description, recorded_date, duration_secs, file_size_bytes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (video_id, tag.title, tag.artist, url, file_path,
                  tag.genre, description, recorded_date, tag.duration, tag.filesize))
            conn.commit()
            conn.close()

        result.update({"status": "tracked", "title": tag.title, "video_id": video_id})
        print(f"[tracker] Tracked: {tag.title} ({video_id})")
    except Exception as e:
        result["status"] = f"error: {e}"
        print(f"[tracker] Error parsing {file_path}: {e}")
    return result

# ---------------------------------------------------------------------------
# File watcher
# ---------------------------------------------------------------------------

class VideoDownloadHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith((".mp4", ".mkv")):
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
    directory = body.get("watch_directory", "").strip()
    if not directory:
        return jsonify({"ok": False, "error": "watch_directory is required"}), 400
    if not os.path.isdir(directory):
        return jsonify({"ok": False, "error": f"Directory not found: {directory}"}), 400
    cfg = load_config()
    cfg["watch_directory"] = directory
    save_config(cfg)
    start_observer(directory)
    return jsonify({"ok": True, "watch_directory": directory})

@app.get("/browse")
def browse():
    import subprocess
    try:
        result = subprocess.run(
            ["zenity", "--file-selection", "--directory", "--title=Select folder to watch"],
            capture_output=True, text=True, timeout=60
        )
        chosen = result.stdout.strip()
        if chosen:
            return jsonify({"ok": True, "directory": chosen})
    except Exception:
        pass
    return jsonify({"ok": False, "directory": None})

@app.post("/scan")
def scan():
    cfg       = load_config()
    directory = cfg.get("watch_directory", DEFAULT_WATCH)
    if not os.path.isdir(directory):
        return jsonify({"ok": False, "error": f"Directory not found: {directory}"}), 400

    files = []
    for root_dir, _, filenames in os.walk(directory):
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
        return jsonify({"downloaded": True, "data": dict(row)})
    return jsonify({"downloaded": False})

@app.post("/update-stats/<video_id>")
def update_stats(video_id):
    body       = request.get_json(silent=True) or {}
    view_count = body.get("view_count")
    like_count = body.get("like_count")
    conn = get_conn()
    conn.execute('''
        UPDATE downloaded_videos
        SET view_count = ?, like_count = ?, stats_updated_at = CURRENT_TIMESTAMP
        WHERE video_id = ?
    ''', (view_count, like_count, video_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.get("/videos/ids")
def list_video_ids():
    conn = get_conn()
    rows = conn.execute("SELECT video_id FROM downloaded_videos").fetchall()
    conn.close()
    return jsonify({"ids": [r["video_id"] for r in rows]})

@app.get("/videos")
def list_videos():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM downloaded_videos ORDER BY downloaded_at DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.delete("/videos/<video_id>")
def delete_video(video_id):
    conn = get_conn()
    conn.execute("DELETE FROM downloaded_videos WHERE video_id = ?", (video_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    cfg = load_config()
    watcher_thread = threading.Thread(
        target=start_observer, args=(cfg["watch_directory"],), daemon=True
    )
    watcher_thread.start()
    print("[api] Dashboard → http://localhost:3360")
    app.run(host="127.0.0.1", port=3360, debug=False)
