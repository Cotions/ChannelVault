import os
import io
import sys
import socket
import webbrowser
import re
import csv
import time
import json
import shutil
import sqlite3
import hashlib
import subprocess
import urllib.request
import threading
import unicodedata
from tinytag import TinyTag
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context

FROZEN          = getattr(sys, "frozen", False)
BUNDLE_DIR      = getattr(sys, "_MEIPASS", "")
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
REPO_DIR        = os.path.dirname(BASE_DIR)

def _pick_static_dir():
    """Bundled UI when frozen, freshly built UI when running from source."""
    for candidate in (
        os.path.join(BUNDLE_DIR, "static") if FROZEN else "",
        os.path.join(REPO_DIR, "frontend", "dist"),
        os.path.join(BASE_DIR, "static"),
    ):
        if candidate and os.path.exists(os.path.join(candidate, "index.html")):
            return candidate
    return os.path.join(BASE_DIR, "static")

def _pick_config_path():
    """A frozen binary cannot write next to itself, so config lives in ~/.config."""
    override = os.environ.get("CHANNELVAULT_CONFIG")
    if override:
        return os.path.abspath(override)
    legacy = os.path.join(BASE_DIR, "config.json")
    if not FROZEN or os.path.exists(legacy):
        return legacy
    user_cfg = os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config"),
        "channelvault",
    )
    os.makedirs(user_cfg, exist_ok=True)
    return os.path.join(user_cfg, "config.json")

STATIC_DIR      = _pick_static_dir()
CONFIG_PATH     = _pick_config_path()
USERSCRIPT_DIR  = os.path.join(BUNDLE_DIR, "userscript") if FROZEN else os.path.join(REPO_DIR, "userscript")
PORT            = int(os.environ.get("CHANNELVAULT_PORT", "3360"))
# Release builds rewrite this line with the tag being built.
__version__     = "0.0.0-dev"
DEFAULT_WATCH   = os.path.join(os.path.expanduser("~"), "Downloads")
DEFAULT_DATA    = os.path.join(os.path.expanduser("~"), ".local", "share", "channelvault")

app = Flask(__name__, static_folder=None)

# ---------------------------------------------------------------------------
# Origin lockdown
#
# This server binds to 127.0.0.1, but the browser is still an attack path: any
# website open in the same browser can script requests to localhost. Two rules
# close that off without needing a login:
#
#   1. Host header must name this machine. Blocks DNS rebinding, where a remote
#      hostname is pointed at 127.0.0.1 so a page on that origin can talk to us.
#   2. Every state-changing request must carry a custom header. A cross-origin
#      page cannot attach one without a CORS preflight, and we never grant CORS,
#      so the preflight fails. The dashboard is same-origin and sets it freely;
#      the userscript uses GM_xmlhttpRequest, which is not bound by CORS at all.
#
# No CORS headers are sent on purpose. The dashboard is served from this same
# origin in production, so none are needed.
# ---------------------------------------------------------------------------

_ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
CSRF_HEADER    = "X-ChannelVault"
_SAFE_METHODS  = {"GET", "HEAD", "OPTIONS"}


def _host_only(host_header):
    host = (host_header or "").strip().lower()
    if host.startswith("["):                  # IPv6 literal, keep brackets
        return host.split("]")[0] + "]"
    return host.rsplit(":", 1)[0] if ":" in host else host


@app.before_request
def _origin_guard():
    if _host_only(request.headers.get("Host")) not in _ALLOWED_HOSTS:
        return jsonify({"ok": False, "error": "forbidden host"}), 403
    if request.method not in _SAFE_METHODS and not request.headers.get(CSRF_HEADER):
        return jsonify({"ok": False, "error": f"missing {CSRF_HEADER} header"}), 403
    return None

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
    cfg.setdefault("media_roots", [])
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

def _artist_names(channel):
    """Split a collab credit ("A, B") into individual artist names.

    A video's channel_name may credit multiple collaborating artists as a
    comma-separated list; each should get its own artist folder/thumbnail so
    the video surfaces under every collaborator.
    """
    if not channel:
        return []
    return [n.strip() for n in channel.split(",") if n.strip()]

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
            for name in _artist_names(row["channel_name"]):
                channels[name].append(row["video_id"])

        # A collab thumb belongs to several artists, so copy it into each
        # artist folder rather than move; the source is removed afterwards.
        distributed = set()
        for name, video_ids in channels.items():
            safe = _safe_dirname(name)
            artist_dir = os.path.join(artist_thumbs_dir, safe)
            os.makedirs(artist_dir, exist_ok=True)
            for video_id in video_ids:
                for ext in (".jpg", ".jpeg", ".webp", ".png"):
                    src = os.path.join(thumbs_dir, f"{video_id}{ext}")
                    dest = os.path.join(artist_dir, f"{video_id}{ext}")
                    if os.path.exists(src):
                        if not os.path.exists(dest):
                            shutil.copy2(src, dest)
                        distributed.add(src)

        for src in distributed:
            try:
                os.remove(src)
            except OSError:
                pass

        # Prune orphaned artist folders: anything not backed by a current
        # (split) artist name. Catches old combined collab folders and artists
        # whose videos are all gone. Thumbs are a cache, rebuilt next scan.
        valid = {_safe_dirname(name) for name in channels}
        if os.path.isdir(artist_thumbs_dir):
            for entry in os.listdir(artist_thumbs_dir):
                path = os.path.join(artist_thumbs_dir, entry)
                if os.path.isdir(path) and entry not in valid:
                    shutil.rmtree(path, ignore_errors=True)
                    print(f"[artist_folders] Pruned orphan: {entry}")

        # Remove thumbs dir if now empty
        if os.path.isdir(thumbs_dir) and not os.listdir(thumbs_dir):
            os.rmdir(thumbs_dir)
            print("[artist_folders] Removed empty thumbs dir")
    except Exception as e:
        print(f"[artist_folders] {e}")

# ---------------------------------------------------------------------------
# Media path resolution
#
# file_path in the DB is whatever absolute path the file had when it was first
# tracked. Move the library (e.g. to /mnt/media) or open the same DB on another
# OS and those paths go stale. Instead of rewriting every row we resolve at read
# time against a list of "media roots": the literal path first, then the longest
# tail of the stored path that exists under a root, then a basename lookup.
# Roots may include both Windows and Linux paths; non-existent ones are skipped,
# so one config works on either machine.
# ---------------------------------------------------------------------------

_media_index      = None
_media_index_lock = threading.Lock()


def get_media_roots():
    """Configured roots plus the watch directory, in order, existing dirs only."""
    cfg   = load_config()
    roots = [str(r).strip() for r in (cfg.get("media_roots") or []) if str(r).strip()]
    wd    = cfg.get("watch_directory")
    if wd and wd not in roots:
        roots.append(wd)
    seen, out = set(), []
    for r in roots:
        if r not in seen and os.path.isdir(r):
            seen.add(r)
            out.append(r)
    return out


def clear_media_index():
    global _media_index
    with _media_index_lock:
        _media_index = None


def _basename_index():
    """Lazy {filename: full_path} map across all roots; last-resort lookup."""
    global _media_index
    with _media_index_lock:
        if _media_index is None:
            idx = {}
            for root in get_media_roots():
                for dirpath, _dirs, files in os.walk(root):
                    for f in files:
                        idx.setdefault(f, os.path.join(dirpath, f))
            _media_index = idx
        return _media_index


def _exists_norm(path):
    """Existing file matching path under any unicode normalization, else None."""
    for form in ("NFC", "NFD", "NFKC", "NFKD"):
        cand = unicodedata.normalize(form, path)
        if os.path.isfile(cand):
            return cand
    return None


def _split_components(path):
    # Split on both separators so a path stored on one OS resolves on the other.
    return [c for c in re.split(r"[\\/]+", path) if c not in ("", ".")]


def resolve_media_path(stored):
    """Map a stored (possibly stale / cross-OS / relative) path to a real file
    on this machine. Returns an existing absolute path, or None."""
    if not stored:
        return None
    hit = _exists_norm(stored)
    if hit:
        return hit
    comps = _split_components(stored)
    if not comps:
        return None
    roots = get_media_roots()
    # Longest matching tail: handles a moved library whose folder layout is kept
    # (e.g. <old>/Chan/vid.mp4 → <root>/Chan/vid.mp4).
    for root in roots:
        for i in range(len(comps)):
            hit = _exists_norm(os.path.join(root, *comps[i:]))
            if hit:
                return hit
    # Last resort: the file was reorganised — match by name anywhere under a root.
    hit = _basename_index().get(comps[-1])
    return hit if hit and os.path.isfile(hit) else None

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
            status           TEXT DEFAULT 'downloaded',
            availability     TEXT
        )
    ''')

    # Migrate: add status column to existing DB if missing
    cols = [row[1] for row in conn.execute("PRAGMA table_info(downloaded_videos)").fetchall()]
    if "status" not in cols:
        conn.execute("ALTER TABLE downloaded_videos ADD COLUMN status TEXT DEFAULT 'downloaded'")
        conn.execute("UPDATE downloaded_videos SET status='downloaded' WHERE status IS NULL")

    # Migrate: availability — NULL/'available' = ok; 'private'/'deleted'/'members'/'geo'/'unavailable' = can't fetch
    if "availability" not in cols:
        conn.execute("ALTER TABLE downloaded_videos ADD COLUMN availability TEXT")

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
    # File can vanish between discovery and parsing (download still finishing,
    # temp file renamed). Skip quietly instead of logging a scary error.
    if not os.path.isfile(file_path):
        result["status"] = "skipped"
        return result
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
        # Copy thumbnail into each collaborating artist's folder
        base = os.path.splitext(file_path)[0]
        for name in _artist_names(artist):
            artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(name))
            os.makedirs(artist_dir, exist_ok=True)
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


# In-progress download scratch files (yt-dlp, browsers). These end in a video
# extension but get renamed to the final name once complete, so reacting to them
# just races the download and errors out.
_TEMP_PATTERNS = (".temp.mp4", ".part", ".ytdl", ".crdownload", ".download")


def _is_temp_file(path):
    low = path.lower()
    return low.endswith(_TEMP_PATTERNS) or ".temp." in os.path.basename(low) or low.endswith(".part.mp4")


_VIDEO_EXTS = (".mp4", ".mkv", ".webm", ".avi", ".mov")


def _handle_new_path(path):
    if not path.lower().endswith(_VIDEO_EXTS):
        return
    if _is_temp_file(path) or _is_ignored(path):
        return
    time.sleep(2)
    # Download may still be settling / renamed again during the wait.
    if not os.path.isfile(path):
        return
    process_video_file(path)


class VideoDownloadHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            _handle_new_path(event.src_path)

    # yt-dlp downloads to a .temp/.part file then RENAMES it to the final name.
    # A rename fires on_moved (not on_created), so without this the finished
    # download is never tracked.
    def on_moved(self, event):
        if not event.is_directory:
            _handle_new_path(event.dest_path)

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

def _spa():
    if not os.path.exists(os.path.join(STATIC_DIR, "index.html")):
        return (
            "<h1>UI not built</h1><p>Run <code>./run.sh</code> from the repo root, "
            "or <code>cd frontend &amp;&amp; bun run build</code>.</p>",
            503,
        )
    return send_from_directory(STATIC_DIR, "index.html")

def _wants_html():
    """Browser navigation asks for text/html; fetch() from the SPA does not."""
    return "text/html" in request.headers.get("Accept", "")

# Client-side router paths. Anything not listed here stays an API route.
for _rule in (
    "/", "/playlists", "/artists", "/data-quality", "/stats",
    "/artist/<path:_spa_rest>", "/video/<path:_spa_rest>", "/playlist/<path:_spa_rest>",
):
    if _rule == "/playlists":
        continue  # collides with the API route below; handled there via Accept
    app.add_url_rule(
        _rule, f"spa{_rule}", lambda **_kw: _spa(), methods=["GET"]
    )

@app.get("/assets/<path:filename>")
def spa_assets(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "assets"), filename)

@app.get("/vite.svg")
def spa_icon():
    return send_from_directory(STATIC_DIR, "vite.svg")

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
        clear_media_index()
        start_observer(directory)

    if "media_roots" in body:
        roots = body["media_roots"]
        if not isinstance(roots, list):
            return jsonify({"ok": False, "error": "media_roots must be a list"}), 400
        # Don't require existence: a Windows root won't exist when running on
        # Linux (and vice-versa). The resolver skips dead roots at read time.
        cfg["media_roots"] = [str(r).strip() for r in roots if str(r).strip()]
        save_config(cfg)
        clear_media_index()

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
            if f.lower().endswith((".mp4", ".mkv", ".webm", ".avi", ".mov")) and not _is_temp_file(f):
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
        clear_media_index()
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
    path = resolve_media_path(row["file_path"])
    if not path:
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
    if _wants_html():
        return _spa()  # browser navigating to the playlists page, not an API call
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
    userscript_path = USERSCRIPT_DIR
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


def _classify_unavailable(text):
    """Map a yt-dlp error message to an availability state, or None if it looks transient."""
    t = (text or "").lower()
    if "private video" in t or "this video is private" in t:
        return "private"
    if ("members-only" in t or "members only" in t or "join this channel" in t):
        return "members"
    if "not available in your country" in t or "geo" in t and "restrict" in t:
        return "geo"
    if ("video unavailable" in t or "no longer available" in t
            or "has been removed" in t or "removed by the uploader" in t
            or "account associated with this video has been terminated" in t
            or "account associated with this video has been closed" in t
            or "this video has been removed" in t
            or "video has been deleted" in t):
        return "deleted"
    # Other failures (network, rate limit, sign-in/age gate) are likely transient → don't mark.
    return None


def _set_availability(video_id, availability):
    with _db_lock:
        conn = get_conn()
        conn.execute(
            "UPDATE downloaded_videos SET availability = ? WHERE video_id = ?",
            (availability, video_id),
        )
        conn.commit()
        conn.close()


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
            availability = _classify_unavailable(result.stderr)
            if availability:
                _set_availability(video_id, availability)
                return jsonify({"ok": False, "error": "yt-dlp failed", "availability": availability}), 200
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
                stats_updated_at = CURRENT_TIMESTAMP,
                availability   = 'available'
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
        if not resolve_media_path(r["file_path"])
    ]
    return jsonify({"ok": True, "missing": missing})


# ---------------------------------------------------------------------------
# Organize loose downloads → artist folders, then track
#
# yt-dlp drops finished files straight into the watch root. This reads the
# embedded channel/artist tag, moves each loose file into <watch>/<artist>/,
# VERIFIES the move landed, and only then adds it to the DB as a new entry.
# ---------------------------------------------------------------------------

def _read_meta(file_path):
    """Best-effort metadata: TinyTag first, ffprobe fallback. Never raises."""
    try:
        meta = _meta_from_tinytag(file_path)
    except Exception:
        meta = None
    if not meta or not meta.get("url"):
        try:
            meta = _meta_from_ffprobe(file_path)
        except Exception:
            meta = meta or {}
    return meta or {}


def _video_id_from_url(url):
    if not url:
        return None
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", url) or \
        re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


def _loose_video_files(watch_dir):
    """Video files sitting directly in the watch root (not already in a subfolder)."""
    out = []
    for fname in sorted(os.listdir(watch_dir)):
        src = os.path.join(watch_dir, fname)
        if not os.path.isfile(src):
            continue
        if not fname.lower().endswith(_VIDEO_EXTS) or _is_temp_file(fname):
            continue
        out.append(src)
    return out


def _candidate_files(root, recursive):
    """Video files to consider: loose-in-root (organize) or all-of-tree (import)."""
    if not recursive:
        return _loose_video_files(root)
    out = []
    for dirpath, dirs, files in os.walk(root):
        if os.path.exists(os.path.join(dirpath, ".vaultIgnore")):
            dirs.clear()
            continue
        for f in files:
            if f.lower().endswith(_VIDEO_EXTS) and not _is_temp_file(f):
                out.append(os.path.join(dirpath, f))
    return sorted(out)


def _transfer(src, dest, mode):
    """Move or copy the video plus any companion files sharing its stem
    (thumbnail, info json). mode is 'move' or 'copy'."""
    op = shutil.move if mode == "move" else shutil.copy2
    op(src, dest)
    src_base = os.path.splitext(src)[0]
    dst_base = os.path.splitext(dest)[0]
    for ext in (".jpg", ".jpeg", ".webp", ".png", ".info.json", ".description"):
        s = src_base + ext
        if os.path.exists(s) and not os.path.exists(dst_base + ext):
            try:
                op(s, dst_base + ext)
            except Exception:
                pass


@app.get("/organize/preview")
def organize_preview():
    cfg       = load_config()
    watch_dir = cfg.get("watch_directory", DEFAULT_WATCH)
    if not os.path.isdir(watch_dir):
        return jsonify({"ok": False, "error": f"Library folder not found: {watch_dir}"}), 400

    # Optional source = "import" mode: pull from another folder (recursively) into
    # the library. No source = "organize" mode: tidy loose files in the library root.
    source = (request.args.get("source") or "").strip() or watch_dir
    if not os.path.isdir(source):
        return jsonify({"ok": False, "error": f"Source folder not found: {source}"}), 400
    recursive = os.path.abspath(source) != os.path.abspath(watch_dir)

    items = []
    conn  = get_conn()
    for src in _candidate_files(source, recursive):
        fname  = os.path.basename(src)
        meta   = _read_meta(src)
        artist = (meta.get("artist") or "").strip()
        vid    = _video_id_from_url(meta.get("url"))

        row   = conn.execute(
            "SELECT file_path FROM downloaded_videos WHERE video_id=? AND status='downloaded'", (vid,)
        ).fetchone() if vid else None
        in_db = bool(row)
        # Is the tracked copy a *different* file that still exists on disk? Then
        # this loose file is a real duplicate. If the tracked path resolves back
        # to this same file (or is missing), moving + repointing is safe.
        tracked = resolve_media_path(row["file_path"]) if row else None
        duplicate = bool(tracked and os.path.abspath(tracked) != os.path.abspath(src))

        if not artist:
            dest, status = None, "no-artist"
        else:
            dest = os.path.join(watch_dir, _safe_dirname(artist), fname)
            if duplicate:
                status = "duplicate"
            elif os.path.abspath(dest) == os.path.abspath(src):
                status = "in-place"
            else:
                status = "ready"
        items.append({
            "file": src, "basename": fname, "artist": artist or None,
            "video_id": vid, "dest": dest, "status": status,
            "in_db": in_db, "duplicate": duplicate,
        })
    conn.close()
    return jsonify({"ok": True, "items": items})


@app.post("/organize/apply")
def organize_apply():
    body      = request.get_json(silent=True) or {}
    cfg       = load_config()
    watch_dir = cfg.get("watch_directory", DEFAULT_WATCH)
    if not os.path.isdir(watch_dir):
        return jsonify({"ok": False, "error": f"Directory not found: {watch_dir}"}), 400

    mode    = "copy" if body.get("mode") == "copy" else "move"
    source  = (body.get("source") or "").strip() or watch_dir
    files   = body.get("files")
    if isinstance(files, list) and files:
        targets = files
    else:
        targets = _candidate_files(source, os.path.abspath(source) != os.path.abspath(watch_dir))

    results = []
    for src in targets:
        r = {"file": src, "dest": None, "moved": False, "verified": False,
             "added": False, "video_id": None, "status": None}
        if not os.path.isfile(src):
            r["status"] = "missing-source"; results.append(r); continue

        artist = (_read_meta(src).get("artist") or "").strip()
        if not artist:
            r["status"] = "no-artist"; results.append(r); continue

        dest_dir = os.path.join(watch_dir, _safe_dirname(artist))
        dest     = os.path.join(dest_dir, os.path.basename(src))
        r["dest"] = dest

        if os.path.abspath(dest) == os.path.abspath(src):
            r["verified"] = True              # already in the right folder
        elif os.path.exists(dest):
            r["status"] = "dest-exists"; results.append(r); continue
        else:
            try:
                os.makedirs(dest_dir, exist_ok=True)
                _transfer(src, dest, mode)
                r["moved"] = True
            except Exception as e:
                r["status"] = f"{mode}-failed: {e}"; results.append(r); continue
            # Verify the file actually landed BEFORE writing to the DB.
            r["verified"] = os.path.isfile(dest)
            if not r["verified"]:
                r["status"] = "verify-failed"; results.append(r); continue

        pr  = process_video_file(dest)
        vid = pr.get("video_id")
        r["video_id"] = vid
        if pr["status"] in ("skipped",) or (pr["status"] or "").startswith("error"):
            r["status"] = pr["status"]; results.append(r); continue
        # process_video_file won't overwrite the path of an already-'downloaded'
        # row, so force file_path to the verified new location here.
        if vid:
            with _db_lock:
                conn = get_conn()
                cur  = conn.execute(
                    "UPDATE downloaded_videos SET file_path=? WHERE video_id=?", (dest, vid)
                )
                conn.commit()
                conn.close()
        r["added"]  = True
        r["status"] = "filed"
        results.append(r)

    clear_media_index()
    return jsonify({"ok": True, "results": results})


# ---------------------------------------------------------------------------
# Inspect / enrich a single source file before importing
# ---------------------------------------------------------------------------

def _meta_payload(meta):
    artist = (meta.get("artist") or "").strip()
    return {
        "title":         meta.get("title"),
        "artist":        artist or None,
        "url":           meta.get("url"),
        "video_id":      _video_id_from_url(meta.get("url")),
        "genre":         meta.get("genre"),
        "description":   meta.get("description"),
        "recorded_date": meta.get("recorded_date"),
        "duration":      meta.get("duration"),
        "filesize":      meta.get("filesize"),
    }


def _sidecar_thumb(path):
    base = os.path.splitext(path)[0]
    for ext in (".webp", ".jpg", ".jpeg", ".png"):
        if os.path.exists(base + ext):
            return base + ext
    return None


@app.get("/import/inspect")
def import_inspect():
    path = (request.args.get("file") or "").strip()
    if not path or not os.path.isfile(path):
        return jsonify({"ok": False, "error": "file not found"}), 404
    cfg       = load_config()
    watch_dir = cfg.get("watch_directory", DEFAULT_WATCH)
    meta      = _read_meta(path)
    payload   = _meta_payload(meta)
    artist    = payload["artist"]
    vid       = payload["video_id"]
    dest      = os.path.join(watch_dir, _safe_dirname(artist), os.path.basename(path)) if artist else None
    in_db     = False
    if vid:
        conn  = get_conn()
        in_db = bool(conn.execute(
            "SELECT 1 FROM downloaded_videos WHERE video_id=? AND status='downloaded'", (vid,)
        ).fetchone())
        conn.close()
    return jsonify({
        "ok": True, "file": path, "basename": os.path.basename(path),
        "meta": payload, "dest": dest, "in_db": in_db,
        "has_thumb": bool(_sidecar_thumb(path)),
    })


@app.get("/import/thumb")
def import_thumb():
    path = (request.args.get("file") or "").strip()
    thumb = _sidecar_thumb(path) if path and os.path.isfile(path) else None
    if thumb:
        return send_from_directory(os.path.dirname(thumb), os.path.basename(thumb))
    return ("", 404)


@app.post("/import/fetch-meta")
def import_fetch_meta():
    """Suggest metadata from YouTube (yt-dlp) WITHOUT writing anything."""
    body = request.get_json(silent=True) or {}
    path = (body.get("file") or "").strip()
    vid  = body.get("video_id")
    if not vid and path and os.path.isfile(path):
        vid = _video_id_from_url(_read_meta(path).get("url"))
    if not vid:
        return jsonify({"ok": False, "error": "no YouTube id — add a URL first"}), 400
    url = f"https://www.youtube.com/watch?v={vid}"
    try:
        res = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-download", "--no-playlist", url],
            capture_output=True, text=True, timeout=45,
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    if res.returncode != 0:
        avail = _classify_unavailable(res.stderr)
        if avail and path:
            # remember unavailability if this id is already tracked
            _set_availability(vid, avail)
        return jsonify({"ok": False, "error": "yt-dlp failed", "availability": avail}), 200
    info = json.loads(res.stdout)
    ud   = info.get("upload_date")
    rec  = f"{ud[:4]}-{ud[4:6]}-{ud[6:]}" if ud and len(ud) == 8 else None
    return jsonify({"ok": True, "suggested": {
        "title":         info.get("title"),
        "artist":        info.get("channel") or info.get("uploader"),
        "url":           info.get("webpage_url") or url,
        "video_id":      vid,
        "description":   info.get("description"),
        "genre":         (info.get("categories") or [None])[0],
        "recorded_date": rec,
    }})


def _ffmeta_args(fields):
    mapping = {
        "title":       fields.get("title"),
        "artist":      fields.get("artist"),
        "comment":     fields.get("url"),          # tracker reads the URL from the comment tag
        "description": fields.get("description"),
        "date":        fields.get("recorded_date"),
        "genre":       fields.get("genre"),
    }
    out = []
    for k, v in mapping.items():
        if v not in (None, ""):
            out += ["-metadata", f"{k}={v}"]
    return out


@app.post("/import/enrich")
def import_enrich():
    """Write metadata tags into the file itself (ffmpeg stream copy), then verify."""
    body   = request.get_json(silent=True) or {}
    path   = (body.get("file") or "").strip()
    fields = body.get("fields") or {}
    if not path or not os.path.isfile(path):
        return jsonify({"ok": False, "error": "file not found"}), 404
    metargs = _ffmeta_args(fields)
    if not metargs:
        return jsonify({"ok": False, "error": "no fields to write"}), 400

    ext = os.path.splitext(path)[1]
    tmp = path + ".enrich" + ext
    # -map 0 -c copy: keep every stream, no re-encode. -map_metadata 0: preserve
    # existing tags, then the -metadata flags override only the provided fields.
    args = ["ffmpeg", "-y", "-i", path, "-map", "0", "-c", "copy", "-map_metadata", "0"] + metargs + [tmp]
    try:
        res = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    if res.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) < 1024:
        if os.path.exists(tmp):
            try: os.remove(tmp)
            except OSError: pass
        return jsonify({"ok": False, "error": "ffmpeg failed: " + (res.stderr or "")[-300:]}), 500

    os.replace(tmp, path)              # atomic swap over the original
    return jsonify({"ok": True, "meta": _meta_payload(_read_meta(path))})


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
    # Fallback to the sidecar next to the (resolved) video file
    if row and row["file_path"]:
        resolved = resolve_media_path(row["file_path"])
        if resolved:
            base = os.path.splitext(resolved)[0]
            for ext in (".jpg", ".jpeg", ".webp", ".png"):
                candidate = base + ext
                if os.path.exists(candidate):
                    return send_from_directory(os.path.dirname(os.path.abspath(candidate)), os.path.basename(candidate))
    return ("", 404)


@app.get("/thumb-latest/<video_id>")
def serve_thumb_latest(video_id):
    """Newest fetched thumbnail if one exists, else the original."""
    vdir = _thumb_versions_dir(video_id)
    if os.path.isdir(vdir):
        files = [f for f in os.listdir(vdir) if f.lower().endswith((".jpg", ".jpeg", ".webp", ".png"))]
        if files:
            newest = max(files, key=lambda f: os.path.getmtime(os.path.join(vdir, f)))
            return send_from_directory(vdir, newest)
    op = _original_thumb_path(video_id)
    if op:
        return send_from_directory(os.path.dirname(op), os.path.basename(op))
    return ("", 404)

# ---------------------------------------------------------------------------
# Thumbnail versions (original stays with the video; fetched ones kept here)
# ---------------------------------------------------------------------------

def _thumb_versions_dir(video_id):
    return os.path.join(load_config()["data_directory"], "thumb_versions", video_id)


def _original_thumb_path(video_id):
    """Path of the original thumbnail (artist-folder copy, then file sidecar)."""
    conn = get_conn()
    row  = conn.execute(
        "SELECT channel_name, file_path FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    conn.close()
    if row and row["channel_name"]:
        ad = os.path.join(get_artist_thumbs_dir(), _safe_dirname(row["channel_name"]))
        for ext in (".jpg", ".jpeg", ".webp", ".png"):
            p = os.path.join(ad, f"{video_id}{ext}")
            if os.path.exists(p):
                return p
    if row and row["file_path"]:
        resolved = resolve_media_path(row["file_path"])
        if resolved:
            base = os.path.splitext(resolved)[0]
            for ext in (".jpg", ".jpeg", ".webp", ".png"):
                if os.path.exists(base + ext):
                    return base + ext
    return None


def _download_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


# Thumbnails come off the network. Cap decoded size so a crafted image cannot
# balloon into gigabytes of pixels (Pillow decompression-bomb DoS).
_MAX_THUMB_PIXELS = 40_000_000   # ~ 8000x5000


def _pil_image():
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = _MAX_THUMB_PIXELS
    return Image


def _to_webp(raw):
    """Re-encode arbitrary image bytes to webp; None if Pillow can't decode."""
    try:
        import io
        Image = _pil_image()
        img = Image.open(io.BytesIO(raw))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=80, method=6)
        return buf.getvalue()
    except Exception:
        return None


def _fetch_youtube_thumb(video_id, fallback_url=None):
    """Return (bytes, ext). Prefers YouTube's native webp (matches Open Video
    Downloader byte-for-byte); falls back to the resolved url re-encoded to webp."""
    for variant in ("maxresdefault", "sddefault", "hqdefault"):
        try:
            return _download_bytes(f"https://i.ytimg.com/vi_webp/{video_id}/{variant}.webp"), ".webp"
        except Exception:
            continue
    if fallback_url and fallback_url not in ("", "NA"):
        raw = _download_bytes(fallback_url)          # may raise → caller handles
        conv = _to_webp(raw)
        if conv is not None:
            return conv, ".webp"
        ext = ".jpg"
        m = re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", fallback_url, re.I)
        if m:
            ext = "." + m.group(1).lower()
        return raw, ext
    raise ValueError("no thumbnail available")


# Perceptual dedup: byte hashing misses the same image saved in a different
# format/resolution (e.g. original .webp vs fetched maxres .jpg). A dHash
# compares the actual pixels so visually-identical thumbnails are caught.
# dHash is coarse (8x8), so use two bands:
_PHASH_STRONG    = 2  # <= this: definitely the same image → silent dedup
_PHASH_THRESHOLD = 6  # STRONG < d <= this: ambiguous → ask the user (modal)


def _dhash(img_source):
    """64-bit difference hash from raw bytes or a file path; None if undecodable."""
    try:
        import io
        Image = _pil_image()
        src = io.BytesIO(img_source) if isinstance(img_source, (bytes, bytearray)) else img_source
        img = Image.open(src).convert("L").resize((9, 8))
        px = list(img.getdata())
        bits = 0
        for row in range(8):
            base = row * 9
            for col in range(8):
                bits = (bits << 1) | (1 if px[base + col] > px[base + col + 1] else 0)
        return bits
    except Exception:
        return None


def _phash_min_distance(new_hash, paths):
    """Smallest Hamming distance from new_hash to any existing image; None if uncomparable."""
    if new_hash is None:
        return None
    best = None
    for p in paths:
        h = _dhash(p)
        if h is not None:
            d = bin(new_hash ^ h).count("1")
            best = d if best is None else min(best, d)
    return best


@app.post("/fetch-thumbnail/<video_id>")
def fetch_thumbnail(video_id):
    body  = request.get_json(silent=True) or {}
    force = bool(body.get("force")) or request.args.get("force") in ("1", "true")
    url = f"https://www.youtube.com/watch?v={video_id}"
    res = subprocess.run(
        ["yt-dlp", "--no-warnings", "--skip-download", "--print", "%(thumbnail)s", url],
        capture_output=True, text=True, timeout=30,
    )
    if res.returncode != 0:
        avail = _classify_unavailable(res.stderr)
        if avail:
            _set_availability(video_id, avail)
            return jsonify({"ok": False, "error": "yt-dlp failed", "availability": avail}), 200
        return jsonify({"ok": False, "error": "yt-dlp failed"}), 502

    thumb_url = (res.stdout or "").strip().splitlines()[0] if res.stdout.strip() else ""
    try:
        data, ext = _fetch_youtube_thumb(video_id, thumb_url)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502

    digest = hashlib.sha1(data).hexdigest()[:12]
    # Collect existing thumbnails: the original plus any fetched version.
    existing_paths = []
    op = _original_thumb_path(video_id)
    if op:
        existing_paths.append(op)
    vdir = _thumb_versions_dir(video_id)
    if os.path.isdir(vdir):
        existing_paths += [os.path.join(vdir, f) for f in os.listdir(vdir)]

    # 1) exact byte match (fast).
    seen = set()
    if op:
        try:
            with open(op, "rb") as fh:
                seen.add(hashlib.sha1(fh.read()).hexdigest()[:12])
        except OSError:
            pass
    if os.path.isdir(vdir):
        for f in os.listdir(vdir):
            seen.add(os.path.splitext(f)[0])
    if digest in seen:
        return jsonify({"ok": True, "added": False, "reason": "duplicate", "hash": digest})

    # 2) perceptual bands — same image in a different format/resolution.
    if not force:
        dist = _phash_min_distance(_dhash(bytes(data)), existing_paths)
        if dist is not None and dist <= _PHASH_STRONG:
            return jsonify({"ok": True, "added": False, "reason": "duplicate-visual", "hash": digest})
        if dist is not None and dist <= _PHASH_THRESHOLD:
            # Looks similar but might be a genuinely new thumbnail — let the user decide.
            import base64
            mime = "image/webp" if ext == ".webp" else ("image/png" if ext == ".png" else "image/jpeg")
            preview = "data:%s;base64,%s" % (mime, base64.b64encode(bytes(data)).decode())
            return jsonify({
                "ok": True, "added": False, "reason": "maybe-duplicate",
                "hash": digest, "distance": dist, "preview": preview,
            })

    os.makedirs(vdir, exist_ok=True)
    with open(os.path.join(vdir, digest + ext), "wb") as fh:
        fh.write(data)
    return jsonify({"ok": True, "added": True, "hash": digest, "file": digest + ext})


@app.get("/thumbnails/<video_id>")
def list_thumbnails(video_id):
    items = []
    if _original_thumb_path(video_id):
        items.append({"kind": "original", "url": f"/thumb/{video_id}"})
    vdir = _thumb_versions_dir(video_id)
    if os.path.isdir(vdir):
        files = sorted(os.listdir(vdir), key=lambda n: os.path.getmtime(os.path.join(vdir, n)))
        for f in files:
            items.append({"kind": "fetched", "file": f, "url": f"/thumbnail-version/{video_id}/{f}"})
    return jsonify({"ok": True, "thumbnails": items})


@app.get("/thumbnail-version/<video_id>/<path:fname>")
def serve_thumbnail_version(video_id, fname):
    vdir = _thumb_versions_dir(video_id)
    safe = os.path.basename(fname)
    if os.path.exists(os.path.join(vdir, safe)):
        return send_from_directory(vdir, safe)
    return ("", 404)


# ---------------------------------------------------------------------------
# Creator profiles (scraped from channel "About" panel)
# ---------------------------------------------------------------------------

_CREATOR_FIELDS = [
    "handle", "channel_url", "description", "country", "joined_date",
    "subscriber_count", "subscribers_text", "video_count", "total_views",
    "links", "email",
]


_SAFE_LINK_SCHEMES = ("http://", "https://")


def _safe_link(url):
    """Only keep web URLs. Scraped About-panel links are attacker-controlled and
    a javascript: href would execute in the dashboard when clicked."""
    u = (url or "").strip()
    return u if u.lower().startswith(_SAFE_LINK_SCHEMES) else None


def _safe_links(links):
    if not isinstance(links, list):
        return []
    out = []
    for item in links:
        if isinstance(item, dict):
            u = _safe_link(item.get("url"))
            if u:
                out.append({"title": str(item.get("title") or u), "url": u})
        elif isinstance(item, str):
            u = _safe_link(item)
            if u:
                out.append({"title": u, "url": u})
    return out


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

    links      = _safe_links(body.get("links"))
    links_json = json.dumps(links) if links else None
    vals = {
        "channel_name":     channel_name,
        "handle":           body.get("handle"),
        "channel_url":      _safe_link(body.get("channel_url")),
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

def _port_busy(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0

if __name__ == "__main__":
    if "--version" in sys.argv:
        print(f"ChannelVault {__version__}")
        sys.exit(0)
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
    url = f"http://localhost:{PORT}"
    if _port_busy(PORT):
        print(f"[api] Port {PORT} already in use — ChannelVault may already be running.")
        print(f"[api] Opening {url}")
        webbrowser.open(url)
        sys.exit(1)
    if "--no-browser" not in sys.argv and os.environ.get("CHANNELVAULT_NO_BROWSER") != "1":
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"[api] ChannelVault {__version__}")
    print(f"[api] Dashboard → {url}")
    print(f"[api] UI files    {STATIC_DIR}")
    print(f"[api] Config      {CONFIG_PATH}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
