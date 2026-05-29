import os
import re
import time
import sqlite3
import threading
from tinytag import TinyTag
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask import Flask, jsonify, request
from flask_cors import CORS

WATCH_DIRECTORY = "/home/cotions/Downloads"
DB_PATH = os.path.join(os.path.dirname(__file__), "videos.db")

app = Flask(__name__)
CORS(app)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
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
    try:
        tag = TinyTag.get(file_path)

        url = tag.comment
        if not url or "youtube.com" not in url:
            return

        match = re.search(r"v=([a-zA-Z0-9_-]{11})", url)
        if not match:
            return
        video_id = match.group(1)

        title        = tag.title
        channel_name = tag.artist
        genre        = tag.genre
        recorded_date = str(tag.year) if tag.year else None
        duration_secs = tag.duration
        file_size_bytes = tag.filesize

        # TinyTag stores short description in extra dict for MP4 'desc' atom
        extra = tag.extra if hasattr(tag, "extra") and tag.extra else {}
        description = extra.get("description") or extra.get("longdesc") or extra.get("long_description")

        conn = get_conn()
        conn.execute('''
            INSERT OR IGNORE INTO downloaded_videos
                (video_id, title, channel_name, url, file_path,
                 genre, description, recorded_date, duration_secs, file_size_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (video_id, title, channel_name, url, file_path,
              genre, description, recorded_date, duration_secs, file_size_bytes))
        conn.commit()
        conn.close()
        print(f"[tracker] Tracked: {title} — {channel_name} ({video_id})")

    except Exception as e:
        print(f"[tracker] Error parsing {file_path}: {e}")


# ---------------------------------------------------------------------------
# File watcher
# ---------------------------------------------------------------------------

class VideoDownloadHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith((".mp4", ".mkv")):
            time.sleep(2)
            process_video_file(event.src_path)


def start_watcher():
    handler = VideoDownloadHandler()
    observer = Observer()
    observer.schedule(handler, path=WATCH_DIRECTORY, recursive=False)
    observer.start()
    print(f"[watcher] Monitoring {WATCH_DIRECTORY}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/check-video/<video_id>")
def check_video(video_id):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    conn.close()
    if row:
        return jsonify({"downloaded": True, "data": dict(row)})
    return jsonify({"downloaded": False})


@app.post("/update-stats/<video_id>")
def update_stats(video_id):
    body = request.get_json(silent=True) or {}
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


@app.get("/videos")
def list_videos():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM downloaded_videos ORDER BY downloaded_at DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()

    watcher_thread = threading.Thread(target=start_watcher, daemon=True)
    watcher_thread.start()

    print("[api] Starting on http://localhost:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
