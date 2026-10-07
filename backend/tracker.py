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
import functools
import queue
import errno
import contextlib
import tempfile
import sqlite3
import base64
import hashlib
import subprocess
import urllib.request
import urllib.parse
import threading
import unicodedata
import uuid
import difflib
import glob
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
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024   # JSON only; nothing here takes uploads


# YouTube ids are exactly 11 URL-safe characters. Refusing anything else at the
# router keeps values like ".." out of every os.path.join that uses a video_id.
from werkzeug.routing import BaseConverter as _BaseConverter

_VIDEO_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")


class _VideoIdConverter(_BaseConverter):
    regex = r"[A-Za-z0-9_-]{11}"


app.url_map.converters["vid"] = _VideoIdConverter


def _valid_video_id(value):
    """The id itself when well-formed, else None."""
    v = (value or "").strip()
    return v if _VIDEO_ID_RE.fullmatch(v) else None


def _clean_err(e):
    """Exception or tool output as display text: control characters become spaces."""
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(e)).strip()


# Entries that aren't YouTube videos (Twitch VODs, Facebook clips, untagged local
# files) get a minted id in the same 11-char shape so every route keeps working.
# A YouTube id packs 64 bits into 11 chars, so its last char is always one of
# these 16; ending a minted id with "_" means it can never equal a real one.
_YT_LAST_CHARS = set("AEIMQUYcgkosw048")
# Untagged files are marked at import with a "local:<key>" comment tag.
_LOCAL_PREFIX  = "local:"


def _mint_id(key):
    digest = hashlib.sha1(key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode()[:10] + "_"


def _entry_id(url):
    """(video_id, source) for a file's URL tag, or (None, None) if it names nothing.
    source is 'youtube', 'local', or the site's name ('twitch', 'facebook', ...)."""
    url = (url or "").strip()
    if not url:
        return None, None
    vid = _video_id_from_url(url)
    if vid:
        return vid, "youtube"
    if url.startswith(_LOCAL_PREFIX):
        key = url[len(_LOCAL_PREFIX):].strip()
        return (_mint_id(url), "local") if key else (None, None)
    m = re.match(r"https?://([^/?#]+)", url)
    if not m:
        return None, None
    host  = m.group(1).lower().split(":")[0]
    parts = [p for p in host.split(".") if p not in ("www", "m", "mobile")]
    # twitch.tv → twitch, www.facebook.com → facebook, clips.twitch.tv → twitch
    # bbc.co.uk → bbc, not co
    if len(parts) >= 3 and parts[-2] in ("co", "com", "net", "org", "ne", "or", "ac", "gov"):
        parts = parts[:-1]
    source = parts[-2] if len(parts) >= 2 else (parts[0] if parts else host)
    if source == "youtube" or source == "youtu":
        return None, None             # a YouTube URL we couldn't read an id from
    return _mint_id(url.split("#")[0]), source

# ---------------------------------------------------------------------------
# Origin lockdown
#
# This server binds to 127.0.0.1, but the browser is still an attack path: any
# website open in the same browser can script requests to localhost. Two rules
# close that off without needing a login:
#
#   1. Host header must name this machine. Blocks DNS rebinding, where a remote
#      hostname is pointed at 127.0.0.1 so a page on that origin can talk to us.
#   2. Every API request must carry a custom header, whatever the method. A
#      cross-origin page cannot attach one without a CORS preflight, and we never
#      grant CORS, so the preflight fails. It also cannot smuggle one through an
#      <img>, <iframe> or top-level navigation. The dashboard is same-origin and
#      sets it freely; the userscript uses GM_xmlhttpRequest, which is not bound
#      by CORS at all.
#
# The only header-free routes are the ones a browser must reach by URL alone:
# the SPA pages, its assets, the userscript file, media served into <img> and
# <video> tags (cross-origin pages cannot read those pixels or bytes), and the
# export downloads behind <a download>. Everything else is denied by default.
#
# No CORS headers are sent on purpose. The dashboard is served from this same
# origin in production, so none are needed.
# ---------------------------------------------------------------------------

_ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
CSRF_HEADER    = "X-ChannelVault"

# Flask endpoint names (the view function names) that may be fetched by URL
# alone. Keep this list short; add to it only for things loaded via src/href.
_PUBLIC_ENDPOINTS = {
    "spa_assets", "spa_icon", "serve_userscript",
    "serve_thumb", "serve_thumb_latest", "serve_artist_thumb",
    "serve_thumbnail_version", "import_thumb", "stream_video",
    "export_json", "export_csv", "stream_audio_track",
}


def _host_only(host_header):
    host = (host_header or "").strip().lower()
    if host.startswith("["):                  # IPv6 literal, keep brackets
        return host.split("]")[0] + "]"
    return host.rsplit(":", 1)[0] if ":" in host else host


def _is_public_endpoint():
    ep = request.endpoint or ""
    if ep.startswith("spa"):
        return True
    if ep in ("list_playlists", "list_tags") and request.method == "GET" and _wants_html():
        return True                            # /playlists and /tags as pages, not as JSON
    return ep in _PUBLIC_ENDPOINTS


@app.before_request
def _origin_guard():
    if _host_only(request.headers.get("Host")) not in _ALLOWED_HOSTS:
        return jsonify({"ok": False, "error": "forbidden host"}), 403
    # Not HEAD: Flask answers HEAD by running the GET handler, side effects and all.
    if request.method == "OPTIONS" or request.endpoint is None:
        return None                            # nothing to protect; let Flask 404/405
    if _is_public_endpoint():
        return None
    if not request.headers.get(CSRF_HEADER):
        return jsonify({"ok": False, "error": f"missing {CSRF_HEADER} header"}), 403
    return None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# A profile is a whole separate library: its own watch folder, media roots and
# data directory (so its own videos.db, thumbs, tags, playlists and stats).
# Everything else in the config (yt-dlp knobs) is shared by all profiles.
# load_config() flattens the active profile into the top level, so the rest of
# the code reads cfg["data_directory"] without knowing profiles exist.
PROFILE_KEYS = ("watch_directory", "data_directory", "media_roots")


def _read_raw_config():
    raw = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            raw = json.load(f)
    if not raw.get("profiles"):
        # Pre-profiles config: its library becomes the "Default" profile.
        default = {"id": "default", "name": "Default"}
        for k in PROFILE_KEYS:
            if k in raw:
                default[k] = raw.pop(k)
        raw["profiles"]       = [default]
        raw["active_profile"] = "default"
    return raw


_config_write_lock = threading.RLock()   # re-entrant: also held around read-modify-write

def _write_raw_config(raw):
    # Own temp name per write + a lock: two saves at once can't interleave
    # into one temp file and leave config.json half-written.
    with _config_write_lock:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(CONFIG_PATH) or ".", suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(raw, f, indent=2)
        os.replace(tmp, CONFIG_PATH)


def _config_locked(fn):
    """Run a config read-modify-write handler under the config lock."""
    @functools.wraps(fn)
    def run(*a, **kw):
        with _config_write_lock:
            return fn(*a, **kw)
    return run


def _copy_db(src, dest):
    """Copy a live SQLite DB including what still sits in its -wal file
    (a plain file copy would drop recent, uncheckpointed changes)."""
    s, d = sqlite3.connect(src), sqlite3.connect(dest)
    try:
        s.backup(d)
    finally:
        d.close()
        s.close()


# A long job (scan, backfill, organize) pins the profile it started in, so a
# switch mid-job can't send the rest of its writes into another library.
_job_profile = threading.local()


def _active_profile(raw):
    pinned = getattr(_job_profile, "id", None)
    want   = pinned or raw.get("active_profile")
    for p in raw["profiles"]:
        if p.get("id") == want:
            return p
    if pinned:
        # The job's library was deleted mid-run: stop rather than carry on in another.
        raise RuntimeError(f"profile {pinned!r} no longer exists")
    return raw["profiles"][0]


@contextlib.contextmanager
def _pinned_profile(profile_id=None):
    prev = getattr(_job_profile, "id", None)
    _job_profile.id = profile_id or load_config()["active_profile"]
    try:
        yield
    finally:
        _job_profile.id = prev


def _stream_in_profile(gen):
    """Run a streaming generator pinned to the profile active right now (when
    the request came in), not whichever is active as it's iterated."""
    pid = load_config()["active_profile"]
    def run():
        with _pinned_profile(pid):
            yield from gen
    return run()


def _profile_defaults(p):
    p.setdefault("watch_directory", DEFAULT_WATCH)
    p.setdefault("data_directory", DEFAULT_DATA)
    p.setdefault("media_roots", [])
    return p


def load_config():
    raw  = _read_raw_config()
    prof = _profile_defaults(dict(_active_profile(raw)))
    cfg  = {k: v for k, v in raw.items() if k not in ("profiles", "active_profile")}
    for k in PROFILE_KEYS:
        cfg[k] = prof[k]
    cfg["active_profile"] = prof["id"]
    cfg["profile_name"]   = prof.get("name") or prof["id"]
    # yt-dlp knobs. Age-restricted videos need a signed-in cookie jar, and
    # YouTube's "n" challenge needs a JavaScript runtime, or the fetch dies with
    # "The page needs to be reloaded". Both are opt-in and empty by default.
    cfg.setdefault("ytdlp_cookies_from_browser", "")
    cfg.setdefault("ytdlp_js_runtime", "")
    return cfg

def save_config(cfg):
    """Profile keys go to the active profile, the rest to the shared top level.
    Read and write under one lock so a concurrent save can't drop this one."""
    with _config_write_lock:
        raw  = _read_raw_config()
        prof = _active_profile(raw)
        for k, v in cfg.items():
            if k in PROFILE_KEYS:
                prof[k] = v
            elif k not in ("active_profile", "profile_name", "profiles"):
                raw[k] = v
        _write_raw_config(raw)

def get_db_path():
    return os.path.join(load_config()["data_directory"], "videos.db")

def get_artist_thumbs_dir():
    return os.path.join(load_config()["data_directory"], "artist_thumbs")

def ensure_data_dir(data_dir):
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "artist_thumbs"), exist_ok=True)

_INVALID_CHARS = re.compile(r'[/\\:*?"<>|\u29f8]')   # \u29f8 is the slash yt-dlp swaps in

def _norm_date(value):
    """A tag date as stored: "YYYY-MM-DD" when the day is known ("20210202",
    "2021-02-02T..."), else "YYYY". None when there's no year."""
    if value is None:
        return None
    s = str(value).strip()
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", s)
    if m and 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 31:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return s[:4] if s[:4].isdigit() else None


def _clean_name(name):
    """An artist/channel name as stored: outer whitespace (U+3000 too) gone, empty is None."""
    return str(name).strip() or None if name is not None else None

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
        # whose videos are all gone. A thumb in there may be the only copy
        # (a renamed channel's), so one whose video is still tracked moves to
        # that video's current artist folders before the folder goes.
        valid = {_safe_dirname(name) for name in channels}
        conn = get_conn()
        tracked_ids = {r[0] for r in conn.execute("SELECT video_id FROM downloaded_videos")}
        conn.close()
        homes = {}
        for name, video_ids in channels.items():
            for video_id in video_ids:
                homes.setdefault(video_id, []).append(os.path.join(artist_thumbs_dir, _safe_dirname(name)))
        if os.path.isdir(artist_thumbs_dir):
            for entry in os.listdir(artist_thumbs_dir):
                path = os.path.join(artist_thumbs_dir, entry)
                if not os.path.isdir(path) or entry in valid:
                    continue
                homeless = False
                for fname in os.listdir(path):
                    vid = os.path.splitext(fname)[0]
                    for home in homes.get(vid, []):
                        dest = os.path.join(home, fname)
                        if not os.path.exists(dest):
                            shutil.copy2(os.path.join(path, fname), dest)
                    # A tracked video with no artist right now (channel cleared)
                    # has nowhere else to keep its thumb: leave the folder be.
                    homeless = homeless or (vid not in homes and vid in tracked_ids)
                if homeless:
                    continue
                shutil.rmtree(path, ignore_errors=True)
                print(f"[artist_folders] Pruned orphan: {entry}")

        # A video's thumb left under an artist it's no longer credited to (a
        # collab split differently, a credit fixed) moves to its current
        # artists' folders.
        for name, video_ids in channels.items():
            artist_dir = os.path.join(artist_thumbs_dir, _safe_dirname(name))
            own = set(video_ids)
            for fname in os.listdir(artist_dir):
                vid, ext = os.path.splitext(fname)
                if vid in own or vid not in homes or ext.lower() not in (".jpg", ".jpeg", ".webp", ".png"):
                    continue
                stale = os.path.join(artist_dir, fname)
                # Two names can share a folder (A/B and A:B both become A-B):
                # then this file is also a current home, never stale.
                if any(os.path.realpath(h) == os.path.realpath(artist_dir) for h in homes[vid]):
                    continue
                for h in homes[vid]:
                    if not os.path.exists(os.path.join(h, fname)):
                        shutil.copy2(stale, os.path.join(h, fname))
                os.remove(stale)

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
    """Lazy {filename: [full paths]} map across all roots; last-resort lookup.
    One name can sit in several places (a staging copy, two "intro.m4a")."""
    global _media_index
    with _media_index_lock:
        if _media_index is None:
            idx, seen = {}, set()
            for root in get_media_roots():
                for dirpath, _dirs, files in os.walk(root):
                    for f in files:
                        p = os.path.join(dirpath, f)
                        real = os.path.realpath(p)
                        if real not in seen:          # overlapping roots list a file once
                            seen.add(real)
                            idx.setdefault(f, []).append(p)
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
    # Last resort: the file was reorganised — match by name anywhere under a root,
    # unless another entry already owns that file (same name, different video).
    cands = [p for p in _basename_index().get(comps[-1], []) if os.path.isfile(p)]
    if not cands:
        return None
    # A file another library entry already points at is that entry's, not this
    # one's. Hidden soundtrack entries share their file with audio_tracks on
    # purpose, so they don't count as owners.
    try:
        conn  = get_conn()
        marks = ",".join("?" * len(cands))
        owned = {r[0] for r in conn.execute(
            f"SELECT file_path FROM downloaded_videos WHERE file_path IN ({marks}) "
            f"AND file_path != ? AND status != 'attached'", (*cands, stored))}
        conn.close()
    except sqlite3.Error:
        owned = set()
    free = [p for p in cands if p not in owned]
    # Two unowned copies: no way to tell which is this entry's, so neither.
    return free[0] if len(free) == 1 else None

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

    # Migrate: availability — NULL/'available' = ok; 'private'/'deleted'/'members'/'geo'/'age'/'unavailable' = can't fetch
    if "availability" not in cols:
        conn.execute("ALTER TABLE downloaded_videos ADD COLUMN availability TEXT")

    # Migrate: where the entry comes from — 'youtube', 'twitch', 'local', ...
    # Everything before this column existed was YouTube.
    if "source" not in cols:
        conn.execute("ALTER TABLE downloaded_videos ADD COLUMN source TEXT DEFAULT 'youtube'")
        conn.execute("UPDATE downloaded_videos SET source='youtube' WHERE source IS NULL")

    # Migrate: a file's embedded chapters are offered once. Without this flag
    # every scan re-read every file without segments, and a video whose
    # segments the user deleted got its chapters back.
    if "chapters_checked" not in cols:
        conn.execute("ALTER TABLE downloaded_videos ADD COLUMN chapters_checked INTEGER DEFAULT 0")
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='segments'").fetchone():
            conn.execute("UPDATE downloaded_videos SET chapters_checked=1 "
                         "WHERE video_id IN (SELECT DISTINCT video_id FROM segments)")

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

    # Channels the user has marked as the same person (a main channel, a shorts
    # channel, a second ASMR channel). Each name sits in at most one group; the
    # artist page lists the rest of its group as "Also on". Names are channel_name
    # display strings, the same key the artists grouping and creators use.
    conn.execute('''
        CREATE TABLE IF NOT EXISTS artist_links (
            channel_name TEXT PRIMARY KEY,
            group_id     INTEGER NOT NULL
        )
    ''')

    # The user's own mark on a channel's fate: "abandoned" when it is still up
    # but the creator stopped uploading, "deleted" when the creator took it
    # down, "banned" when YouTube terminated it. No row means active.
    conn.execute('''
        CREATE TABLE IF NOT EXISTS channel_status (
            channel_name TEXT PRIMARY KEY,
            status       TEXT NOT NULL,
            marked_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Tags are the user's own vocabulary: one row per word, library-wide.
    # Segments are time ranges inside one video (embedded chapters or hand-drawn).
    # A tag attaches to a segment or to a whole video; `source` records whether a
    # person or a keyword rule put it there.
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tags (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
            color      TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tag_rules (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id     INTEGER NOT NULL,
            keyword    TEXT NOT NULL COLLATE NOCASE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS segments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id   TEXT NOT NULL,
            start_secs REAL NOT NULL,
            end_secs   REAL NOT NULL,
            title      TEXT,
            source     TEXT NOT NULL DEFAULT 'manual',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS segment_tags (
            segment_id INTEGER NOT NULL,
            tag_id     INTEGER NOT NULL,
            source     TEXT NOT NULL DEFAULT 'manual',
            PRIMARY KEY (segment_id, tag_id)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS video_tags (
            video_id   TEXT NOT NULL,
            tag_id     INTEGER NOT NULL,
            source     TEXT NOT NULL DEFAULT 'manual',
            PRIMARY KEY (video_id, tag_id)
        )
    ''')
    # A video can carry alternate soundtracks that live in their own files: a
    # re-mixed upload, a dub, a quieter master. The video's own audio is the
    # implicit "Original" track, so only the extra ones get a row. offset_secs
    # shifts the file against the picture when the two were not cut in sync.
    conn.execute('''
        CREATE TABLE IF NOT EXISTS audio_tracks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id      TEXT NOT NULL,
            label         TEXT,
            file_path     TEXT NOT NULL,
            offset_secs   REAL NOT NULL DEFAULT 0,
            duration_secs REAL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (video_id, file_path)
        )
    ''')
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audio_tracks_video ON audio_tracks(video_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_segments_video ON segments(video_id)")
    # resolve_media_path asks "does another entry own this file?" on every fallback hit.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_videos_file_path ON downloaded_videos(file_path)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_segment_tags_tag ON segment_tags(tag_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id)")

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
        "artist":        _clean_name(tag.artist),
        "genre":         tag.genre,
        "description":   description,
        "recorded_date": _norm_date(year),
        "duration":      tag.duration,
        "filesize":      tag.filesize,
    }


def _meta_from_ffprobe(file_path):
    """Fallback reader for containers TinyTag can't parse (webm/mkv)."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", file_path],
        capture_output=True, text=True, timeout=30,   # a corrupt file must not hang a scan
    )
    fmt  = (json.loads(out.stdout or "{}")).get("format", {})
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    date = tags.get("date") or ""
    year = _norm_date(date)
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
        "artist":        _clean_name(tags.get("artist")),
        "genre":         tags.get("genre"),
        "description":   tags.get("description") or tags.get("synopsis"),
        "recorded_date": year,
        "duration":      duration,
        "filesize":      filesize,
    }


def _read_chapters(file_path):
    """Embedded chapters as [{start, end, title}], oldest first. Empty on any failure.

    Kept apart from _meta_from_ffprobe: mp4 files take the TinyTag path and never
    reach ffprobe, yet they are exactly the files that carry chapters."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_chapters", file_path],
            capture_output=True, text=True, timeout=30,
        )
        chapters = (json.loads(out.stdout or "{}")).get("chapters") or []
    except Exception:
        return []
    result = []
    for ch in chapters:
        try:
            start = float(ch.get("start_time"))
            end   = float(ch.get("end_time"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        title = ((ch.get("tags") or {}).get("title") or "").strip() or None
        result.append({"start": start, "end": end, "title": title})
    result.sort(key=lambda c: c["start"])
    return result


_COVER_EXTS = {"mjpeg": ".jpg", "png": ".png", "webp": ".webp"}


def _grab_frame(file_path, dest, duration=None):
    """Save one frame, a tenth of the way in, as a stand-in thumbnail.
    Returns dest, or None (audio-only file, ffmpeg failure)."""
    at = min(max((duration or 0) * 0.1, 0), 60)
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.1f}", "-i", file_path,
             "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", dest],
            capture_output=True, timeout=60, check=True,
        )
    except Exception:
        return None
    return dest if os.path.isfile(dest) and os.path.getsize(dest) > 0 else None


def _extract_cover(file_path, dest_base):
    """Write the file's embedded cover art (yt-dlp --embed-thumbnail) to
    dest_base + its own extension. Returns the written path, or None.

    Only a stream flagged as attached picture counts: in a video file the first
    video stream is the picture itself, not its thumbnail."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", file_path],
            capture_output=True, text=True, timeout=30,
        )
        streams = (json.loads(out.stdout or "{}")).get("streams") or []
    except Exception:
        return None
    for st in streams:
        ext = _COVER_EXTS.get(st.get("codec_name"))
        if not ext or not (st.get("disposition") or {}).get("attached_pic"):
            continue
        dest = dest_base + ext
        try:
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", file_path, "-map", f"0:{st['index']}",
                 "-frames:v", "1", "-c", "copy", dest],
                capture_output=True, timeout=30, check=True,
            )
        except Exception:
            return None
        return dest if os.path.isfile(dest) and os.path.getsize(dest) > 0 else None
    return None


def _is_attached_track(file_path, conn=None):
    """True when this audio file is already an alternate soundtrack of some video.
    Those stay tracks; they must not also turn up as library entries."""
    real = os.path.realpath(file_path)
    own  = conn is None
    conn = conn or get_conn()
    rows = conn.execute("SELECT file_path FROM audio_tracks").fetchall()
    if own:
        conn.close()
    return any(os.path.realpath(resolve_media_path(r["file_path"]) or r["file_path"]) == real
               for r in rows)


def _entries_for_file(conn, path, status):
    """Audio-only library rows (with this status) whose file is path."""
    real = os.path.realpath(path)
    rows = conn.execute(
        "SELECT video_id, title, file_path FROM downloaded_videos WHERE status = ? AND file_path IS NOT NULL",
        (status,),
    ).fetchall()
    return [r for r in rows
            if r["file_path"].lower().endswith(_AUDIO_EXTS)
            and os.path.realpath(resolve_media_path(r["file_path"]) or r["file_path"]) == real]


def process_video_file(file_path):
    result = {"file": file_path, "status": None, "title": None, "video_id": None}
    # File can vanish between discovery and parsing (download still finishing,
    # temp file renamed). Skip quietly instead of logging a scary error.
    if not os.path.isfile(file_path):
        result["status"] = "skipped"
        return result
    if file_path.lower().endswith(_AUDIO_EXTS) and _is_attached_track(file_path):
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
        video_id, source = _entry_id(url)
        if not video_id:
            result["status"] = "skipped"
            return result
        if source == "local":
            url = None                    # the marker isn't a link anywhere

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
                     genre, description, recorded_date, duration_secs, file_size_bytes, source, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'downloaded')
                ON CONFLICT(video_id) DO UPDATE SET
                    title=excluded.title,
                    source=excluded.source,
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
                  meta.get("genre"), description, recorded_date, meta.get("duration"), meta.get("filesize"), source))
            # A tracked row whose file is gone (moved or renamed outside the app)
            # follows this copy, so it doesn't sit there as "missing" forever.
            row = conn.execute("SELECT file_path FROM downloaded_videos WHERE video_id=? AND status='downloaded'",
                               (video_id,)).fetchone()
            if row and row["file_path"] != file_path and not resolve_media_path(row["file_path"]):
                conn.execute("UPDATE downloaded_videos SET file_path=? WHERE video_id=?", (file_path, video_id))
            # An already-tracked row keeps its data, but its size follows the
            # file: a size read while the file was still being copied heals here.
            if meta.get("filesize"):
                conn.execute(
                    "UPDATE downloaded_videos SET file_size_bytes=? "
                    "WHERE video_id=? AND file_path=? AND file_size_bytes IS NOT ?",
                    (meta.get("filesize"), video_id, file_path, meta.get("filesize")))
            conn.commit()
            conn.close()

        result.update({"status": "tracked", "title": title, "video_id": video_id})
        print(f"[tracker] Tracked: {title} ({video_id})")
        # Embedded chapters become segments, once per video: a rescan never
        # brings back segments the user edited or deleted.
        try:
            chapters = _chapters_once(video_id, file_path)
            if chapters:
                with _db_lock:
                    conn = get_conn()
                    added = _import_chapters(conn, video_id, file_path, replace=False, chapters=chapters)
                    if added:
                        _apply_rules(conn, video_ids=[video_id])
                    conn.commit()
                    conn.close()
        except Exception as e:
            print(f"[segments] chapter import failed for {video_id}: {e}")
        # Copy thumbnail into each collaborating artist's folder. No sidecar
        # image (audio downloads usually embed theirs) → pull the embedded one.
        src = _sidecar_thumb(file_path)
        for name in _artist_names(artist):
            artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(name))
            os.makedirs(artist_dir, exist_ok=True)
            dest_base = os.path.join(artist_dir, video_id)
            if any(os.path.exists(dest_base + e) for e in (".jpg", ".jpeg", ".webp", ".png")):
                continue
            if src:
                shutil.copy2(src, dest_base + os.path.splitext(src)[1])
            else:
                src = _extract_cover(file_path, dest_base)
                # Off YouTube there's no thumbnail to fetch later: use a frame.
                if not src and source != "youtube":
                    src = _grab_frame(file_path, dest_base + ".jpg", meta.get("duration"))
    except Exception as e:
        result["status"] = f"error: {_clean_err(e)}"
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
_AUDIO_EXTS = (".mp3", ".m4a", ".aac", ".opus", ".ogg", ".oga", ".flac", ".wav", ".weba")
# What becomes a library entry. An audio-only download (sound worth keeping,
# picture not) is tracked like a video and plays over its thumbnail.
_LIBRARY_EXTS = _VIDEO_EXTS + _AUDIO_EXTS


def _wait_until_settled(path, step=2, limit=1800, stop=None):
    """Block until the file's size and mtime stop changing. False if it vanished
    (renamed/removed while waiting) or the watcher was stopped meanwhile."""
    last = None
    for _ in range(int(limit / step)):
        if stop is not None and stop.wait(step):
            return False
        if stop is None:
            time.sleep(step)
        try:
            st = os.stat(path)
        except OSError:
            return False
        now = (st.st_size, st.st_mtime_ns)
        if now == last:
            return True
        last = now
    return os.path.isfile(path)


def _handle_new_path(path, stop=None):
    if not path.lower().endswith(_LIBRARY_EXTS):
        return
    if _is_temp_file(path) or _is_ignored(path):
        return
    # A copy or a slow download keeps growing after the event fires; wait for
    # the size to hold still so the tracked size/duration are the finished file's.
    if not _wait_until_settled(path, stop=stop):
        return
    # A download that lands straight in the library root gets filed into its
    # artist folder, like "Organize loose files" would. Anything deeper, or a
    # file we can't file (no artist tag, already tracked elsewhere, name clash),
    # is tracked where it sits.
    watch_dir = load_config().get("watch_directory", DEFAULT_WATCH)
    if os.path.realpath(os.path.dirname(path)) == os.path.realpath(watch_dir) \
            and not _tracked_elsewhere(path):
        r = _file_into_library(path, watch_dir)
        if r["status"] == "filed":
            clear_media_index()
            print(f"[watcher] Filed {os.path.basename(path)} into {os.path.dirname(r['dest'])}")
            return
    process_video_file(path)


def _tracked_elsewhere(path):
    """True when this file's video is already tracked at a different path that still exists."""
    vid, _src = _entry_id(_read_meta(path).get("url"))
    if not vid:
        return False
    conn = get_conn()
    row  = conn.execute(
        "SELECT file_path FROM downloaded_videos WHERE video_id=? AND status='downloaded'", (vid,)
    ).fetchone()
    conn.close()
    tracked = resolve_media_path(row["file_path"]) if row else None
    return bool(tracked and os.path.abspath(tracked) != os.path.abspath(path))


class VideoDownloadHandler(FileSystemEventHandler):
    """Hands new files to one worker thread, pinned to the profile the watcher
    was started for. Waiting for a slow copy to settle happens there, so the
    observer can stop at once on a profile switch, and a file that settles
    afterwards is never written into the newly active library."""

    def __init__(self, profile_id):
        super().__init__()
        self.profile_id = profile_id
        self.stopped    = threading.Event()
        self.queue      = queue.Queue()
        threading.Thread(target=self._work, daemon=True).start()

    def _work(self):
        while not self.stopped.is_set():
            try:
                path = self.queue.get(timeout=1)
            except queue.Empty:
                continue
            try:
                with _pinned_profile(self.profile_id):
                    _handle_new_path(path, self.stopped)
            except Exception as e:
                print(f"[watcher] {os.path.basename(path)}: {e}")

    def on_created(self, event):
        if not event.is_directory:
            self.queue.put(event.src_path)

    # yt-dlp downloads to a .temp/.part file then RENAMES it to the final name.
    # A rename fires on_moved (not on_created), so without this the finished
    # download is never tracked.
    def on_moved(self, event):
        if not event.is_directory:
            self.queue.put(event.dest_path)

_observer      = None
_handler       = None
_observer_lock = threading.Lock()
_db_lock       = threading.Lock()

def start_observer(directory):
    global _observer, _handler
    with _observer_lock:
        if _handler:
            _handler.stopped.set()       # its worker drops what's left; a scan picks it up
        if _observer and _observer.is_alive():
            _observer.stop()
            _observer.join()
        if not os.path.isdir(directory):
            print(f"[watcher] Directory not found: {directory}")
            return
        _handler  = VideoDownloadHandler(load_config()["active_profile"])
        _observer = Observer()
        _observer.schedule(_handler, path=directory, recursive=True)
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
    "/", "/playlists", "/artists", "/data-quality", "/stats", "/tags",
    "/artist/<path:_spa_rest>", "/video/<path:_spa_rest>", "/playlist/<path:_spa_rest>",
    "/tag/<path:_spa_rest>",
):
    if _rule in ("/playlists", "/tags"):
        continue  # collide with API routes below; handled there via Accept
    app.add_url_rule(
        _rule, f"spa{_rule}", lambda **_kw: _spa(), methods=["GET"]
    )

@app.get("/assets/<path:filename>")
def spa_assets(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "assets"), filename)

@app.get("/favicon.svg")
def spa_icon():
    return send_from_directory(STATIC_DIR, "favicon.svg")

@app.get("/config")
def get_config():
    return jsonify(load_config())

@app.get("/ytdlp/status")
def ytdlp_status():
    """What yt-dlp we have and whether it can get past age gates and the n challenge."""
    cfg     = load_config()
    version = None
    try:
        r = subprocess.run(["yt-dlp", "--no-update", "--version"],
                           capture_output=True, text=True, timeout=15)
        version = (r.stdout or "").strip() or None
    except Exception:
        pass
    runtimes = {name: shutil.which(name) for name in _JS_RUNTIMES}
    return jsonify({
        "ok":            True,
        "installed":     bool(version),
        "version":       version,
        "cookies_from":  cfg.get("ytdlp_cookies_from_browser") or None,
        "js_runtime":    cfg.get("ytdlp_js_runtime") or None,
        "js_available":  {k: v for k, v in runtimes.items() if v},
        "js_args":       _js_runtime_args(),
    })


# Folders a library must never live in: the app writes and moves files there.
_SYSTEM_DIRS = ("/etc", "/usr", "/bin", "/sbin", "/proc", "/sys", "/dev", "/boot", "/root")


def _system_dir(path):
    """True for /, $HOME itself, or anything in an OS directory."""
    real = os.path.realpath(os.path.expanduser(path))
    if real in ("/", os.path.realpath(os.path.expanduser("~"))):
        return True
    top = "/" + real.split("/")[1] if real.startswith("/") else ""
    return top in _SYSTEM_DIRS or top.startswith("/lib")


@app.post("/config")
@_config_locked
def set_config():
    body = request.get_json(silent=True) or {}
    cfg  = load_config()

    if "watch_directory" in body:
        directory = body["watch_directory"].strip()
        if not directory:
            return jsonify({"ok": False, "error": "watch_directory is required"}), 400
        if not os.path.isdir(directory):
            return jsonify({"ok": False, "error": f"Directory not found: {directory}"}), 400
        owner = _watch_dir_owner(_read_raw_config(), directory, exclude=cfg["active_profile"])
        if owner:
            return jsonify({"ok": False, "error": f"Profile \"{owner}\" already watches that folder or one overlapping it"}), 400
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
        roots = [str(r).strip() for r in roots if str(r).strip()]
        bad   = next((r for r in roots if _system_dir(r)), None)
        if bad:
            return jsonify({"ok": False, "error": f"Not a media folder: {bad}"}), 400
        cfg["media_roots"] = roots
        save_config(cfg)
        clear_media_index()

    # yt-dlp: cookie jar for age-gated videos, JS runtime for the "n" challenge.
    # Both end up on yt-dlp's command line, so only known values get stored.
    if "ytdlp_js_runtime" in body:
        runtime = str(body["ytdlp_js_runtime"] or "").strip()
        if runtime and not _check_js_runtime(runtime):
            return jsonify({"ok": False, "error":
                f"JS runtime must be one of {', '.join(_JS_RUNTIMES)}, or name:/path/to/executable"}), 400
        cfg["ytdlp_js_runtime"] = _check_js_runtime(runtime) or ""
        save_config(cfg)

    if "ytdlp_cookies_from_browser" in body:
        browser = str(body["ytdlp_cookies_from_browser"] or "").strip()
        if browser and not _COOKIE_BROWSER_RE.fullmatch(browser):
            return jsonify({"ok": False, "error": f"Unknown browser: {browser}"}), 400
        cfg["ytdlp_cookies_from_browser"] = browser
        save_config(cfg)
        # Videos parked as "age" were only unfetchable because we had no cookies.
        # Now that there are some, put them back in the queue.
        if cfg["ytdlp_cookies_from_browser"]:
            with _db_lock:
                conn = get_conn()
                conn.execute("UPDATE downloaded_videos SET availability = NULL WHERE availability = 'age'")
                conn.commit()
                conn.close()

    if "data_directory" in body:
        data_dir = body["data_directory"].strip()
        if not data_dir:
            return jsonify({"ok": False, "error": "data_directory is required"}), 400
        if _system_dir(data_dir):
            return jsonify({"ok": False, "error": f"Not a data directory: {data_dir}"}), 400
        owner = _data_dir_owner(_read_raw_config(), data_dir, exclude=cfg["active_profile"])
        if owner:
            return jsonify({"ok": False, "error": f"Profile \"{owner}\" already uses that data directory"}), 400
        try:
            ensure_data_dir(data_dir)
        except Exception as e:
            return jsonify({"ok": False, "error": f"Cannot create directory: {_clean_err(e)}"}), 400
        old_db = os.path.join(cfg["data_directory"], "videos.db")
        new_db = os.path.join(data_dir, "videos.db")
        if os.path.exists(old_db) and not os.path.exists(new_db):
            _copy_db(old_db, new_db)
        cfg["data_directory"] = data_dir
        save_config(cfg)
        init_db()

    return jsonify({"ok": True, **cfg})

# ---------------------------------------------------------------------------
# Profiles: separate libraries, one active at a time
# ---------------------------------------------------------------------------

def _data_dir_owner(raw, data_dir, exclude=None):
    """Name of another profile whose data directory is data_dir, else None.

    Two profiles on one data directory would share a database, which is exactly
    what profiles exist to prevent.
    """
    want = os.path.realpath(os.path.expanduser(data_dir))
    for p in raw["profiles"]:
        if p.get("id") == exclude:
            continue
        have = _profile_defaults(dict(p))["data_directory"]
        if os.path.realpath(os.path.expanduser(have)) == want:
            return p.get("name") or p["id"]
    return None


def _watch_dir_owner(raw, watch_dir, exclude=None):
    """Name of another profile whose watch folder is, contains, or sits inside
    watch_dir, else None. Overlapping watch folders would track one file into
    two libraries."""
    def norm(p):
        return os.path.realpath(os.path.expanduser(p)).rstrip(os.sep) + os.sep
    want = norm(watch_dir)
    for p in raw["profiles"]:
        if p.get("id") == exclude:
            continue
        have = norm(_profile_defaults(dict(p))["watch_directory"])
        if want.startswith(have) or have.startswith(want):
            return p.get("name") or p["id"]
    return None


def _profile_video_count(data_dir):
    db = os.path.join(data_dir, "videos.db")
    if not os.path.exists(db):
        return 0
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        n = conn.execute("SELECT COUNT(*) FROM downloaded_videos WHERE status='downloaded'").fetchone()[0]
        conn.close()
        return n
    except sqlite3.Error:
        return None


def _profile_json(p, active_id):
    p = _profile_defaults(dict(p))
    return {
        "id":              p["id"],
        "name":            p.get("name") or p["id"],
        "watch_directory": p["watch_directory"],
        "data_directory":  p["data_directory"],
        "media_roots":     p["media_roots"],
        "active":          p["id"] == active_id,
        "video_count":     _profile_video_count(p["data_directory"]),
    }


def open_active_library():
    """Point the database, media lookup and folder watcher at the active profile."""
    cfg = load_config()
    ensure_data_dir(cfg["data_directory"])
    clear_media_index()
    _picked_paths.clear()              # import picks belong to the library they were made in
    init_db()
    sync_artist_folders()
    start_observer(cfg["watch_directory"])


@app.get("/profiles")
def list_profiles():
    raw    = _read_raw_config()
    active = _active_profile(raw)["id"]
    return jsonify({
        "ok":       True,
        "active":   active,
        "profiles": [_profile_json(p, active) for p in raw["profiles"]],
    })


@app.post("/profiles")
@_config_locked
def create_profile():
    body  = request.get_json(silent=True) or {}
    name  = str(body.get("name") or "").strip()
    data  = str(body.get("data_directory") or "").strip()
    watch = str(body.get("watch_directory") or "").strip()
    roots = body.get("media_roots") or []
    if not name:
        return jsonify({"ok": False, "error": "Name is required"}), 400
    if not data:
        return jsonify({"ok": False, "error": "Data directory is required"}), 400
    if not watch:
        return jsonify({"ok": False, "error": "Watch folder is required"}), 400
    if not os.path.isdir(watch):
        return jsonify({"ok": False, "error": f"Directory not found: {watch}"}), 400
    if not isinstance(roots, list):
        return jsonify({"ok": False, "error": "media_roots must be a list"}), 400
    if _system_dir(data):
        return jsonify({"ok": False, "error": f"Not a data directory: {data}"}), 400
    bad = next((str(r).strip() for r in roots if str(r).strip() and _system_dir(str(r).strip())), None)
    if bad:
        return jsonify({"ok": False, "error": f"Not a media folder: {bad}"}), 400

    raw = _read_raw_config()
    if any((p.get("name") or "").lower() == name.lower() for p in raw["profiles"]):
        return jsonify({"ok": False, "error": f"A profile named \"{name}\" already exists"}), 400
    owner = _data_dir_owner(raw, data)
    if owner:
        return jsonify({"ok": False, "error": f"Profile \"{owner}\" already uses that data directory"}), 400
    owner = _watch_dir_owner(raw, watch)
    if owner:
        return jsonify({"ok": False, "error": f"Profile \"{owner}\" already watches that folder or one overlapping it"}), 400
    try:
        ensure_data_dir(data)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Cannot create directory: {_clean_err(e)}"}), 400

    profile = {
        "id":              uuid.uuid4().hex[:8],
        "name":            name,
        "watch_directory": watch,
        "data_directory":  data,
        "media_roots":     [str(r).strip() for r in roots if str(r).strip()],
    }
    raw["profiles"].append(profile)
    _write_raw_config(raw)
    return jsonify({"ok": True, "profile": _profile_json(profile, _active_profile(raw)["id"])})


@app.patch("/profiles/<profile_id>")
@_config_locked
def rename_profile(profile_id):
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Name is required"}), 400
    raw = _read_raw_config()
    if any((p.get("name") or "").lower() == name.lower() and p["id"] != profile_id for p in raw["profiles"]):
        return jsonify({"ok": False, "error": f"A profile named \"{name}\" already exists"}), 400
    for p in raw["profiles"]:
        if p["id"] == profile_id:
            p["name"] = name
            _write_raw_config(raw)
            return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "No such profile"}), 404


@app.delete("/profiles/<profile_id>")
@_config_locked
def delete_profile(profile_id):
    """Forget a profile. Its data directory and videos stay on disk untouched."""
    raw = _read_raw_config()
    if _active_profile(raw)["id"] == profile_id:
        return jsonify({"ok": False, "error": "Switch to another profile before removing this one"}), 400
    kept = [p for p in raw["profiles"] if p["id"] != profile_id]
    if len(kept) == len(raw["profiles"]):
        return jsonify({"ok": False, "error": "No such profile"}), 404
    raw["profiles"] = kept
    _write_raw_config(raw)
    return jsonify({"ok": True})


@app.post("/profiles/<profile_id>/activate")
@_config_locked
def activate_profile(profile_id):
    raw = _read_raw_config()
    if not any(p["id"] == profile_id for p in raw["profiles"]):
        return jsonify({"ok": False, "error": "No such profile"}), 404
    previous = raw.get("active_profile")
    raw["active_profile"] = profile_id
    _write_raw_config(raw)
    try:
        open_active_library()
    except Exception as e:
        # Unreachable library (unmounted drive): stay on the one that works.
        raw = _read_raw_config()
        raw["active_profile"] = previous
        _write_raw_config(raw)
        try:
            open_active_library()
        except Exception:
            pass
        return jsonify({"ok": False, "error": f"Cannot open profile: {_clean_err(e)}"}), 500
    print(f"[profiles] Switched to {load_config()['profile_name']}")
    return jsonify({"ok": True, "active": profile_id})


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
            _remember_picked(chosen)
            return jsonify({"ok": True, "directory": chosen})
    except Exception:
        pass
    return jsonify({"ok": False, "directory": None})

_PICKER_FILTERS = {
    "video": "Video files (mp4 mkv webm avi mov) | *.mp4 *.mkv *.webm *.avi *.mov",
    "audio": "Audio files (mp3 m4a aac opus ogg flac wav) | *.mp3 *.m4a *.aac *.opus *.ogg *.oga *.flac *.wav *.weba",
}


@app.get("/browse-file")
def browse_file():
    import subprocess
    title = request.args.get("title", "Select video file")
    kind  = request.args.get("kind", "video")
    try:
        result = subprocess.run(
            ["zenity", "--file-selection", f"--title={title}",
             "--file-filter=" + _PICKER_FILTERS.get(kind, _PICKER_FILTERS["video"]),
             "--file-filter=All files | *"],
            capture_output=True, text=True, timeout=60
        )
        chosen = result.stdout.strip()
        if chosen:
            _remember_picked(chosen)
            return jsonify({"ok": True, "file": chosen})
    except Exception:
        pass
    return jsonify({"ok": False, "file": None})

def _walk_videos(directory):
    """Every library file (video or audio) under directory, skipping .vaultIgnore'd subtrees and temp files."""
    files = []
    for root_dir, dirs, filenames in os.walk(directory):
        if os.path.exists(os.path.join(root_dir, ".vaultIgnore")):
            dirs.clear()
            continue
        for f in filenames:
            if f.lower().endswith(_LIBRARY_EXTS) and not _is_temp_file(f):
                files.append(os.path.join(root_dir, f))
    return files


def _artist_scan_files(artist):
    """Files that may belong to one artist: everything under <root>/<artist>/ in
    any media root, plus videos tagged with this artist that sit (non-recursively)
    next to the files we already track for them."""
    files, seen = [], set()

    def add(fp):
        key = os.path.realpath(fp)
        if key not in seen:
            seen.add(key)
            files.append(fp)

    for root in get_media_roots():
        folder = os.path.join(root, _safe_dirname(artist))
        if os.path.isdir(folder):
            for fp in _walk_videos(folder):
                add(fp)

    conn = get_conn()
    rows = conn.execute(
        "SELECT channel_name, file_path FROM downloaded_videos WHERE file_path IS NOT NULL AND channel_name LIKE ?",
        (f"%{artist}%",),
    ).fetchall()
    conn.close()
    dirs = set()
    for row in rows:
        if artist not in _artist_names(row["channel_name"]):
            continue
        real = resolve_media_path(row["file_path"])
        if real:
            dirs.add(os.path.dirname(real))

    # These folders can be shared (a loose-files root), so only take files whose
    # artist tag credits this artist.
    for d in dirs:
        if _is_ignored(os.path.join(d, "_")):
            continue
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for f in names:
            fp = os.path.join(d, f)
            if os.path.realpath(fp) in seen or not f.lower().endswith(_LIBRARY_EXTS) \
                    or _is_temp_file(f) or not os.path.isfile(fp):
                continue
            if artist in _artist_names(_read_meta(fp).get("artist")):
                add(fp)
    return files


@app.post("/scan")
def scan():
    artist = (request.args.get("artist") or "").strip()
    if artist:
        if _safe_dirname(artist) in (".", ".."):
            # "<root>/.." would walk the folder above the media root
            return jsonify({"ok": False, "error": "bad artist name"}), 400
        files = _artist_scan_files(artist)
    else:
        cfg       = load_config()
        directory = cfg.get("watch_directory", DEFAULT_WATCH)
        if not os.path.isdir(directory):
            return jsonify({"ok": False, "error": f"Directory not found: {directory}"}), 400
        files = _walk_videos(directory)

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

    return Response(stream_with_context(_stream_in_profile(generate())), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/check-video/<vid:video_id>")
def check_video(video_id):
    conn = get_conn()
    row  = conn.execute(
        "SELECT * FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    conn.close()
    if row:
        d = dict(row)
        # An entry folded into another video as its soundtrack is still in the vault.
        status = "downloaded" if d.get("status") == "attached" else d.get("status")
        return jsonify({"downloaded": status == "downloaded", "status": status, "data": d})
    return jsonify({"downloaded": False, "status": None})

@app.post("/update-stats/<vid:video_id>")
def update_stats(video_id):
    body       = request.get_json(silent=True) or {}
    def count(v):
        return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None
    view_count = count(body.get("view_count"))
    like_count = count(body.get("like_count"))
    if view_count is None and like_count is None:
        return jsonify({"ok": False, "error": "no counts"}), 400
    conn = get_conn()
    conn.execute('''
        UPDATE downloaded_videos
        SET view_count = COALESCE(?, view_count), like_count = COALESCE(?, like_count),
            stats_updated_at = CURRENT_TIMESTAMP
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

def _text(v, limit=500):
    """A request value as stored text: strings only (a dict/list from a
    malformed request is dropped, not crashed on), trimmed and capped."""
    return v.strip()[:limit] or None if isinstance(v, str) else None


def _upsert_mark(video_id, title, channel_name, url, status):
    title, url = _text(title), _text(url, 2000)
    if url and not re.match(r"https?://", url, re.I):
        url = None
    conn = get_conn()
    conn.execute('''
        INSERT INTO downloaded_videos (video_id, title, channel_name, url, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
            title=COALESCE(excluded.title, downloaded_videos.title),
            channel_name=COALESCE(excluded.channel_name, downloaded_videos.channel_name),
            url=COALESCE(excluded.url, downloaded_videos.url),
            status=excluded.status
        WHERE downloaded_videos.status NOT IN ('downloaded', 'attached')
    ''', (video_id, title, channel_name, url, status))
    conn.commit()
    conn.close()

@app.post("/want-to-download")
def add_wanted():
    body         = request.get_json(silent=True) or {}
    video_id     = _valid_video_id(body.get("video_id"))
    if not video_id:
        return jsonify({"ok": False, "error": "valid video_id required"}), 400
    _upsert_mark(video_id, body.get("title"), _clean_name(_text(body.get("channel_name"))), body.get("url"), "wanted")
    return jsonify({"ok": True})

@app.post("/do-not-want")
def add_ignored():
    body         = request.get_json(silent=True) or {}
    video_id     = _valid_video_id(body.get("video_id"))
    if not video_id:
        return jsonify({"ok": False, "error": "valid video_id required"}), 400
    _upsert_mark(video_id, body.get("title"), _clean_name(_text(body.get("channel_name"))), body.get("url"), "ignored")
    return jsonify({"ok": True})

@app.delete("/mark/<vid:video_id>")
def remove_mark(video_id):
    # A wanted/ignored entry can carry tags, playlist items or a soundtrack;
    # those go with it, or they'd point at nothing (and a soundtrack entry
    # would stay hidden for good).
    with _db_lock:
        conn = get_conn()
        with conn:
            row = conn.execute("SELECT status FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone()
            if row and row["status"] not in ("downloaded", "attached"):
                _purge_entry(conn, video_id)
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
    videos = [dict(r) for r in rows]
    _attach_tags(conn, videos)
    conn.close()
    return jsonify(videos)

_STREAM_MIMES = {
    ".mp4":  "video/mp4",
    ".mkv":  "video/x-matroska",
    ".webm": "video/webm",
    ".avi":  "video/x-msvideo",
    ".mov":  "video/quicktime",
}

@app.get("/stream/<vid:video_id>")
def stream_video(video_id):
    conn = get_conn()
    row  = conn.execute(
        "SELECT file_path FROM downloaded_videos WHERE video_id = ? AND status = 'downloaded'",
        (video_id,)
    ).fetchone()
    conn.close()
    if not row or not row["file_path"]:
        return jsonify({"ok": False, "error": "no file for video"}), 404
    path = _under_media_roots(resolve_media_path(row["file_path"]))
    if not path:
        return jsonify({"ok": False, "error": "file missing on disk"}), 404
    ext  = os.path.splitext(path)[1].lower()
    from flask import send_file
    mime = _STREAM_MIMES.get(ext) or _AUDIO_MIMES.get(ext, "application/octet-stream")
    return send_file(path, mimetype=mime, conditional=True)

# ---------------------------------------------------------------------------
# Alternate audio tracks
#
# Some uploads ship the same picture with a second soundtrack in a separate
# file (a remaster, a quieter mix, a dub). Attaching one to a video lets the
# player mute the video and play that file alongside it instead.
# ---------------------------------------------------------------------------

_AUDIO_MIMES = {
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".aac":  "audio/aac",
    ".opus": "audio/ogg",
    ".ogg":  "audio/ogg",
    ".oga":  "audio/ogg",
    ".flac": "audio/flac",
    ".wav":  "audio/wav",
    ".weba": "audio/webm",
}

# Trailing "-<youtube id>" or "-(123k)" that downloaders append to a name.
_NAME_SUFFIX_RE = re.compile(r"-(?:[A-Za-z0-9_-]{11}|\(\d+k\))$")


def _under_media_roots(path):
    """The real path when it is a file inside a configured media root, else None.

    Every path that arrives from the client and gets opened goes through here:
    the browser must not be able to name an arbitrary file on disk and stream
    it back through the audio endpoint."""
    if not path:
        return None
    try:
        real = os.path.realpath(path)
    except OSError:
        return None
    if not os.path.isfile(real):
        return None
    for root in get_media_roots():
        r = os.path.realpath(root)
        if real == r or real.startswith(r + os.sep):
            return real
    return None


# Folders and files the user picked in a native dialog or scanned for import this
# session. Imports come from anywhere (a Downloads folder), so these count as
# reachable alongside the media roots. Only header-carrying calls add to them.
_picked_paths = set()


def _remember_picked(path):
    if path:
        _picked_paths.add(os.path.realpath(path))


def _import_allowed(path):
    """Like _under_media_roots, but also accepts files picked or scanned for import."""
    real = _under_media_roots(path)
    if real:
        return real
    try:
        real = os.path.realpath(path)
    except (OSError, ValueError):
        return None
    if not os.path.isfile(real):
        return None
    for p in _picked_paths:
        if real == p or real.startswith(p.rstrip(os.sep) + os.sep):
            return real
    return None


def _resolve_audio_path(stored):
    """Same stale-path handling as video files, then the media-root check."""
    return _under_media_roots(resolve_media_path(stored) or stored)


def _norm_stem(path):
    """Filename reduced to comparable words: no extension, no download suffix,
    no punctuation or decoration, lowercased."""
    stem = os.path.splitext(os.path.basename(path))[0]
    stem = _NAME_SUFFIX_RE.sub("", stem)
    return re.sub(r"[\W_]+", " ", stem, flags=re.UNICODE).strip().lower()


def _default_audio_label(path):
    """A short name for a track. Alternate mixes are usually marked by a
    parenthetical at the end of the filename, so prefer that."""
    stem  = _NAME_SUFFIX_RE.sub("", os.path.splitext(os.path.basename(path))[0]).strip()
    parts = re.findall(r"[(\[]([^()\[\]]{1,40})[)\]]", stem)
    return ((parts[-1].strip() if parts else stem)[:60]) or "Alternate"


def _parse_offset(value):
    if value is None:
        return None
    try:
        secs = float(value)
    except (TypeError, ValueError):
        return None
    # Beyond a few minutes it is a different recording, not a sync nudge.
    return max(-600.0, min(600.0, secs))


def _ffprobe_duration(path):
    """Container duration in seconds via ffprobe, or None."""
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=nw=1:nk=1", path],
                           capture_output=True, text=True, timeout=60)
        return float(r.stdout.strip())
    except Exception:
        return None


def _audio_duration(path):
    try:
        return TinyTag.get(path).duration
    except Exception:
        return None


# Name closeness above which two files are offered as the same recording.
_AUDIO_MATCH_MIN = 0.55


def _audio_suggestions(video_path, attached):
    """Audio files in the library whose name is close to the video's.

    An alternate mix keeps almost the whole title and changes one word, so
    comparing normalised names finds it even when it sits in another folder."""
    if not video_path:
        return []
    target = _norm_stem(video_path)
    if not target:
        return []
    vdir = os.path.dirname(os.path.realpath(video_path))
    seen = {os.path.realpath(p) for p in attached if p}
    out  = []
    for path in {p for paths in _basename_index().values() for p in paths}:
        if not path.lower().endswith(_AUDIO_EXTS):
            continue
        real = os.path.realpath(path)
        if real in seen:
            continue
        # The name index is built once and kept, so it outlives a file that was
        # moved or renamed since. Offering one of those ends in a refusal at
        # attach time, which reads as a button that does nothing.
        if not os.path.isfile(real):
            continue
        score = difflib.SequenceMatcher(None, target, _norm_stem(path)).ratio()
        if os.path.dirname(real) == vdir:
            score += 0.1                       # a sibling file is the usual case
        if score >= _AUDIO_MATCH_MIN:
            out.append({
                "file_path": path,
                "name":      os.path.basename(path),
                "label":     _default_audio_label(path),
                "score":     round(min(score, 1.0), 3),
            })
    out.sort(key=lambda s: (-s["score"], s["name"]))
    out = out[:8]
    for s in out:                              # only the shortlist pays for a tag read
        s["duration_secs"] = _audio_duration(s["file_path"])
    return out


def _track_row(row):
    resolved = _resolve_audio_path(row["file_path"])
    return {
        "id":            row["id"],
        "video_id":      row["video_id"],
        "label":         row["label"] or _default_audio_label(row["file_path"]),
        "file_path":     row["file_path"],
        "offset_secs":   row["offset_secs"],
        "duration_secs": row["duration_secs"],
        "missing":       resolved is None,
        "url":           f"/audio-track/{row['id']}",
    }


def _tracks_for(conn, video_id):
    rows = conn.execute(
        "SELECT * FROM audio_tracks WHERE video_id = ? ORDER BY created_at, id", (video_id,)
    ).fetchall()
    return [_track_row(r) for r in rows]


@app.get("/videos/<vid:video_id>/audio-tracks")
def list_audio_tracks(video_id):
    """Attached tracks, plus files that look like they belong to this video."""
    conn = get_conn()
    vrow = conn.execute(
        "SELECT file_path FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    tracks = _tracks_for(conn, video_id)
    conn.close()
    video_path = resolve_media_path(vrow["file_path"]) if vrow else None
    suggest    = request.args.get("suggest") != "0"
    attached   = [t["file_path"] for t in tracks]
    if video_path:
        attached.append(video_path)
    return jsonify({
        "ok": True,
        "tracks": tracks,
        "suggestions": _audio_suggestions(video_path, attached) if suggest else [],
    })


@app.post("/videos/<vid:video_id>/audio-tracks")
def add_audio_track(video_id):
    body = request.get_json(silent=True) or {}
    raw  = (body.get("file_path") or "").strip()
    if not raw:
        return jsonify({"ok": False, "error": "need file_path"}), 400
    path = _under_media_roots(raw) or _resolve_audio_path(raw)
    if not path:
        # Either a path the user should not be able to name, or one the cached
        # index still believes in. Dropping the index costs one rescan and makes
        # the second attempt tell the truth.
        clear_media_index()
        return jsonify({"ok": False, "error": "file is not inside a media root"}), 400
    if not path.lower().endswith(_AUDIO_EXTS):
        return jsonify({"ok": False, "error": "not an audio file"}), 400
    label  = (body.get("label") or "").strip() or _default_audio_label(path)
    offset = _parse_offset(body.get("offset_secs"))
    duration = _audio_duration(path)      # file read stays outside the DB lock
    with _db_lock:
        conn = get_conn()
        # Only a library video takes a soundtrack: on a wanted mark or a hidden
        # (itself attached) entry, it would vanish from view along with the file's entry.
        if not conn.execute("SELECT 1 FROM downloaded_videos WHERE video_id = ? AND status = 'downloaded'",
                            (video_id,)).fetchone():
            conn.close()
            return jsonify({"ok": False, "error": "video not found"}), 404
        try:
            cur = conn.execute(
                "INSERT INTO audio_tracks (video_id, label, file_path, offset_secs, duration_secs)"
                " VALUES (?, ?, ?, ?, ?)",
                (video_id, label, path, offset or 0.0, duration),
            )
            track_id = cur.lastrowid
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({"ok": False, "error": "already attached"}), 409
        # The file was its own library entry until now. As a soundtrack it lives
        # under this video instead, so the entry drops out of the library; its
        # history and tags stay, and detaching brings it back.
        hidden = [r for r in _entries_for_file(conn, path, "downloaded") if r["video_id"] != video_id]
        for r in hidden:
            conn.execute("UPDATE downloaded_videos SET status = 'attached' WHERE video_id = ?", (r["video_id"],))
        conn.commit()
        row = conn.execute("SELECT * FROM audio_tracks WHERE id = ?", (track_id,)).fetchone()
        conn.close()
    return jsonify({"ok": True, "track": _track_row(row),
                    "hidden": [{"video_id": r["video_id"], "title": r["title"]} for r in hidden]})


@app.patch("/audio-tracks/<int:track_id>")
def update_audio_track(track_id):
    body = request.get_json(silent=True) or {}
    with _db_lock:
        conn = get_conn()
        cur  = conn.execute("SELECT * FROM audio_tracks WHERE id = ?", (track_id,)).fetchone()
        if not cur:
            conn.close()
            return jsonify({"ok": False, "error": "not found"}), 404
        label  = ((body.get("label") or "").strip() or None) if "label" in body else cur["label"]
        offset = cur["offset_secs"]
        if "offset_secs" in body:
            parsed = _parse_offset(body.get("offset_secs"))
            if parsed is None:
                conn.close()
                return jsonify({"ok": False, "error": "bad offset_secs"}), 400
            offset = parsed
        conn.execute("UPDATE audio_tracks SET label = ?, offset_secs = ? WHERE id = ?",
                     (label, offset, track_id))
        conn.commit()
        row = conn.execute("SELECT * FROM audio_tracks WHERE id = ?", (track_id,)).fetchone()
        conn.close()
    return jsonify({"ok": True, "track": _track_row(row)})


def _restore_detached_audio(conn, file_path):
    """Back in the library once no video keeps the file as a soundtrack.
    Call after its audio_tracks row is gone; returns the restored entries."""
    path = resolve_media_path(file_path) or file_path
    if _is_attached_track(path, conn):
        return []
    restored = _entries_for_file(conn, path, "attached")
    for r in restored:
        conn.execute("UPDATE downloaded_videos SET status = 'downloaded' WHERE video_id = ?", (r["video_id"],))
    return restored


@app.delete("/audio-tracks/<int:track_id>")
def delete_audio_track(track_id):
    """Detach only. The audio file itself is left alone on disk."""
    with _db_lock:
        conn = get_conn()
        row = conn.execute("SELECT file_path FROM audio_tracks WHERE id = ?", (track_id,)).fetchone()
        conn.execute("DELETE FROM audio_tracks WHERE id = ?", (track_id,))
        restored = _restore_detached_audio(conn, row["file_path"]) if row else []
        conn.commit()
        conn.close()
    return jsonify({"ok": True, "restored": [r["video_id"] for r in restored]})


@app.get("/audio-track/<int:track_id>")
def stream_audio_track(track_id):
    conn = get_conn()
    row  = conn.execute("SELECT file_path FROM audio_tracks WHERE id = ?", (track_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "no such track"}), 404
    path = _resolve_audio_path(row["file_path"])
    if not path:
        return jsonify({"ok": False, "error": "file missing on disk"}), 404
    ext = os.path.splitext(path)[1].lower()
    from flask import send_file
    return send_file(path, mimetype=_AUDIO_MIMES.get(ext, "application/octet-stream"), conditional=True)


# ---------------------------------------------------------------------------
# Watch history
# ---------------------------------------------------------------------------

# A session only counts as "watched" once the user has actually played at
# least this fraction of the video (accumulated playtime, not seek position).
WATCHED_THRESHOLD = 0.7
# Ignore trivially short sessions even when duration is unknown.
MIN_WATCHED_SECS = 30

@app.post("/watch-progress/<vid:video_id>")
def watch_progress(video_id):
    body = request.get_json(silent=True) or {}
    try:
        session_id    = int(body["session_id"]) if body.get("session_id") else None
        watched_secs  = max(0.0, float(body.get("watched_secs") or 0))
        position_secs = max(0.0, float(body.get("position_secs") or 0))
        duration_secs = float(body["duration_secs"]) if body.get("duration_secs") else None
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "bad numbers"}), 400

    with _db_lock:
        conn = get_conn()
        if session_id:
            row = conn.execute("SELECT watched_secs, duration_secs FROM watch_sessions WHERE id = ? AND video_id = ?",
                               (session_id, video_id)).fetchone()
            # Posts can land out of order (interval + pagehide): never go backwards.
            if row:
                watched_secs  = max(watched_secs, row["watched_secs"] or 0)
                duration_secs = duration_secs or row["duration_secs"]
        if not duration_secs:
            # The player didn't know the length yet: the library does. Only with
            # no length anywhere does a fixed minimum stand in for "most of it".
            v = conn.execute("SELECT duration_secs FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone()
            known = v["duration_secs"] if v else None
        else:
            known = duration_secs
        if known:
            completed = 1 if watched_secs >= known * WATCHED_THRESHOLD else 0
        else:
            completed = 1 if watched_secs >= MIN_WATCHED_SECS else 0

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
            # A player still running on a deleted entry must not leave history behind.
            if not conn.execute("SELECT 1 FROM downloaded_videos WHERE video_id = ? AND status = 'downloaded'",
                                (video_id,)).fetchone():
                conn.close()
                return jsonify({"ok": False, "error": "video not found"}), 404
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

@app.delete("/watch-history/<vid:video_id>")
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
        SELECT p.id, p.name, p.created_at, COUNT(v.video_id) AS video_count
        FROM playlists p
        LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
        LEFT JOIN downloaded_videos v ON v.video_id = pi.video_id AND v.status = 'downloaded'
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
        JOIN downloaded_videos v ON v.video_id = pi.video_id AND v.status = 'downloaded'
        WHERE pi.playlist_id = ?
        ORDER BY pi.added_at ASC, pi.rowid ASC
    ''', (playlist_id,)).fetchall()
    videos = [dict(r) for r in rows]
    _attach_tags(conn, videos)
    conn.close()
    return jsonify({"ok": True, "playlist": dict(pl), "videos": videos})

@app.post("/playlists/<int:playlist_id>/videos")
def add_playlist_video(playlist_id):
    body     = request.get_json(silent=True) or {}
    video_id = _valid_video_id(body.get("video_id"))
    if not video_id:
        return jsonify({"ok": False, "error": "valid video_id required"}), 400
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "playlist not found"}), 404
    if not conn.execute("SELECT 1 FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "video not found"}), 404
    conn.execute(
        "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id) VALUES (?, ?)",
        (playlist_id, video_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.delete("/playlists/<int:playlist_id>/videos/<vid:video_id>")
def remove_playlist_video(playlist_id, video_id):
    conn = get_conn()
    conn.execute(
        "DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?",
        (playlist_id, video_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

def _csv_cell(v):
    """Spreadsheets run a cell starting with = + - @ as a formula: a video id
    like "-B6nJSEpSbI" turns into #NAME?, a crafted title into a formula.
    A leading apostrophe keeps it text."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


EXPORT_FIELDS = [
    "video_id", "title", "channel_name", "url", "file_path",
    "genre", "description", "recorded_date", "duration_secs",
    "file_size_bytes", "downloaded_at", "view_count", "like_count",
    "stats_updated_at", "status", "source", "tags",
]

def _export_rows():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM downloaded_videos ORDER BY downloaded_at DESC"
    ).fetchall()
    videos = [dict(r) for r in rows]
    _attach_tags(conn, videos)
    segs = conn.execute('''
        SELECT s.id, s.video_id, s.start_secs, s.end_secs, s.title, s.source,
               GROUP_CONCAT(t.name, '; ') AS tag_names
        FROM segments s
        LEFT JOIN segment_tags st ON st.segment_id = s.id
        LEFT JOIN tags t ON t.id = st.tag_id
        GROUP BY s.id ORDER BY s.video_id, s.start_secs
    ''').fetchall()
    conn.close()
    by_video = {}
    for r in segs:
        d = dict(r)
        d["tags"] = [n for n in (d.pop("tag_names") or "").split("; ") if n]
        by_video.setdefault(d.pop("video_id"), []).append(d)
    for v in videos:
        v["segments"] = by_video.get(v["video_id"], [])
        v["tags"]     = [t["name"] for t in v["tags"]]          # names only; CSV-friendly
    return videos

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
    writer.writerows({k: _csv_cell(v) for k, v in {**r, "tags": "; ".join(r["tags"])}.items()}
                     for r in _export_rows())
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
    body      = request.get_json(silent=True) or {}
    raw_id    = _text(body.get("video_id")) or ""
    url       = _text(body.get("url"), 2000) or ""
    file_path = _text(body.get("file_path"), 4096) or ""

    if url and not re.match(r"https?://", url, re.I):
        return jsonify({"ok": False, "error": "url must be an http(s) link"}), 400

    # extract bare ID if caller passed a full URL
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", raw_id) or \
        re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", raw_id) or \
        re.search(r"/(?:shorts|embed|v)/([A-Za-z0-9_-]{11})", raw_id)
    video_id = _valid_video_id(m.group(1) if m else raw_id)
    source   = None
    if video_id:
        conn = get_conn()
        row  = conn.execute("SELECT source FROM downloaded_videos WHERE video_id=?", (video_id,)).fetchone()
        conn.close()
        # Editing an existing entry keeps its source; a new bare id is YouTube's.
        if not row:
            source = "youtube" if video_id[-1] in _YT_LAST_CHARS else None
            if not source:
                return jsonify({"ok": False, "error": "not a YouTube video id"}), 400
    else:
        # Not YouTube: a link to another site, or just a file on disk.
        video_id, source = _entry_id(url)
        # A file already carrying a link or local: marker keeps the id the
        # tracker gives it, or adding it here would make a second entry.
        if not video_id and file_path and os.path.isfile(file_path):
            try:
                video_id, source = _entry_id(_read_meta(file_path).get("url"))
            except Exception:
                pass
        if not video_id and file_path:
            video_id, source = _mint_id(_LOCAL_PREFIX + os.path.realpath(file_path)), "local"
        if not video_id:
            return jsonify({"ok": False, "error": "needs a video link or a local file"}), 400

    if not url and source == "youtube":
        url = f"https://www.youtube.com/watch?v={video_id}"

    # A file on disk must be one the user can reach through the app anyway. A
    # path that doesn't exist (another machine's drive) is only stored, and an
    # entry keeping the path it already has is left alone.
    if file_path and os.path.exists(file_path) and not _import_allowed(file_path):
        conn = get_conn()
        row  = conn.execute("SELECT file_path FROM downloaded_videos WHERE video_id=?", (video_id,)).fetchone()
        conn.close()
        if not row or row["file_path"] != file_path:
            return jsonify({"ok": False, "error": "file is not inside a media folder"}), 400

    with _db_lock:
        conn = get_conn()
        conn.execute('''
            INSERT INTO downloaded_videos
                (video_id, title, channel_name, url, file_path,
                 genre, description, recorded_date, duration_secs, file_size_bytes, source, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'youtube'), 'downloaded')
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
                -- An edit keeps the original download date and a hidden (attached)
                -- audio entry stays hidden; wanted/ignored still get promoted.
                downloaded_at    = CASE WHEN downloaded_videos.status IN ('downloaded', 'attached')
                                        THEN downloaded_videos.downloaded_at ELSE CURRENT_TIMESTAMP END,
                status           = CASE WHEN downloaded_videos.status = 'attached'
                                        THEN 'attached' ELSE 'downloaded' END
        ''', (
            video_id,
            body.get("title") or None,
            _clean_name(body.get("channel_name")),
            url or None,
            file_path or None,
            body.get("genre") or None,
            body.get("description") or None,
            body.get("recorded_date") or None,
            body.get("duration_secs") or None,
            body.get("file_size_bytes") or None,
            source,
        ))
        conn.commit()
        conn.close()

    # Nothing will ever fetch a thumbnail for a non-YouTube entry: take a frame.
    if source and source != "youtube" and os.path.isfile(file_path):
        artist = (body.get("channel_name") or "").strip()
        for name in _artist_names(artist):
            artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(name))
            dest_base  = os.path.join(artist_dir, video_id)
            if any(os.path.exists(dest_base + e) for e in (".jpg", ".jpeg", ".webp", ".png")):
                continue
            os.makedirs(artist_dir, exist_ok=True)
            side = _sidecar_thumb(file_path)
            if side:
                shutil.copy2(side, dest_base + os.path.splitext(side)[1])
            elif not _extract_cover(file_path, dest_base):
                _grab_frame(file_path, dest_base + ".jpg", _read_meta(file_path).get("duration"))

    return jsonify({"ok": True, "video_id": video_id, "source": source})


@app.post("/read-file-tags")
def read_file_tags():
    body      = request.get_json(silent=True) or {}
    file_path = (body.get("file_path") or "").strip()
    if not file_path or not os.path.isfile(file_path):
        return jsonify({"ok": False, "error": "File not found"}), 404
    if not _import_allowed(file_path):
        return jsonify({"ok": False, "error": "Not in a media or import folder"}), 403
    try:
        try:
            meta = _meta_from_tinytag(file_path)
        except Exception:
            meta = None
        if not meta or not meta.get("url"):
            meta = _meta_from_ffprobe(file_path)
    except Exception as e:
        return jsonify({"ok": False, "error": _clean_err(e)}), 500

    url              = meta.get("url") or ""
    video_id, source = _entry_id(url)
    if source == "local":
        url = ""

    return jsonify({
        "ok":           True,
        "video_id":     video_id,
        "title":        meta.get("title"),
        "channel_name": meta.get("artist"),
        "url":          url or (f"https://www.youtube.com/watch?v={video_id}" if source == "youtube" else None),
        "source":       source,
        "genre":        meta.get("genre"),
        "description":  meta.get("description"),
        "recorded_date":meta.get("recorded_date"),
        "duration_secs":meta.get("duration"),
    })


# ---------------------------------------------------------------------------
# yt-dlp invocation
# ---------------------------------------------------------------------------

# Runtimes yt-dlp can drive, highest priority first. Only "deno" is enabled by
# default, so an installed node/bun is invisible unless we pass --js-runtimes.
_JS_RUNTIMES = ("deno", "node", "quickjs", "bun")


def _js_runtime_args():
    """--js-runtimes flags for whichever runtime is configured or on PATH.

    Without one, YouTube's "n" challenge cannot be solved and a fetch that got
    past the age gate still fails with "The page needs to be reloaded".
    """
    configured = _check_js_runtime(load_config().get("ytdlp_js_runtime"))
    if configured:
        return ["--js-runtimes", configured]

    found = []
    for name in _JS_RUNTIMES:
        path = shutil.which(name)
        if path:
            found.append(f"{name}:{path}")
    return [arg for f in found for arg in ("--js-runtimes", f)]


def _check_js_runtime(value):
    """value as a --js-runtimes argument ("node" or "node:/path/to/node"), else None.

    Accepts a runtime name, name:path, or a bare path. A path must be an existing
    executable named after its runtime, so the setting can't run any binary."""
    value = (value or "").strip()
    if value in _JS_RUNTIMES:
        return value
    name, sep, path = value.partition(":")
    if not sep:
        name, path = "", value
    path = os.path.expanduser(path.strip())
    base = os.path.basename(path.rstrip("/")).lower()
    base = base[:-4] if base.endswith(".exe") else base
    name = name.strip() or base
    if name not in _JS_RUNTIMES or base != name:
        return None
    if not (os.path.isfile(path) and os.access(path, os.X_OK)):
        return None
    return f"{name}:{path}"


# Browsers yt-dlp reads cookies from, optionally with a ":profile" suffix.
_COOKIE_BROWSER_RE = re.compile(
    r"(?:brave|chrome|chromium|edge|firefox|opera|safari|vivaldi|whale)(?::[^\x00-\x1f]+)?")


def _cookie_args():
    """--cookies-from-browser flags, if a browser is configured.

    Age-restricted videos ("Sign in to confirm your age") cannot be fetched at
    all without a signed-in cookie jar; no player client bypasses it.
    """
    browser = (load_config().get("ytdlp_cookies_from_browser") or "").strip()
    return ["--cookies-from-browser", browser] if _COOKIE_BROWSER_RE.fullmatch(browser) else []


def _ytdlp(*args, timeout=45):
    """Run yt-dlp with the configured cookie jar and JS runtime."""
    cmd = ["yt-dlp", "--no-update"] + _cookie_args() + _js_runtime_args() + list(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _ytdlp_error(stderr):
    """The last ERROR line yt-dlp printed, trimmed for display."""
    for line in reversed((stderr or "").splitlines()):
        line = line.strip()
        if line.startswith("ERROR:"):
            line = line[len("ERROR:"):].strip()
            # Drop the "[youtube] <id>: " prefix and the trailing help links.
            line = re.sub(r"^\[[^\]]+\]\s*[A-Za-z0-9_-]{11}:\s*", "", line)
            line = re.split(r"\s+(?:Use --cookies|See\s+https?://)", line)[0]
            return _clean_err(line)[:300]
    return "yt-dlp failed"


def _classify_unavailable(text):
    """Map a yt-dlp error message to an availability state, or None if it looks transient."""
    t = (text or "").lower()
    # Throttling and bot checks wear YouTube's "Video unavailable" wording too
    # ("This content isn't available, try again later"). Never mark those.
    if any(m in t for m in ("try again later", "rate-limit", "rate limit", "too many requests",
                            "http error 429", "not a bot", "temporarily")):
        return None
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
    # Age-gated. Only a signed-in cookie jar gets past it, so without one this is
    # permanent, not transient — mark it so the video stops sitting at the top of
    # the "oldest fetch" list forever. Configuring cookies clears the mark.
    if "confirm your age" in t and not _cookie_args():
        return "age"
    # Other failures (network, rate limit, bot check) are likely transient → don't mark.
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


def _not_youtube(video_id):
    """An error response when this entry isn't a YouTube video, else None."""
    conn = get_conn()
    row  = conn.execute("SELECT source FROM downloaded_videos WHERE video_id=?", (video_id,)).fetchone()
    conn.close()
    if (row and (row["source"] or "youtube") != "youtube") or video_id[-1] not in _YT_LAST_CHARS:
        return jsonify({"ok": False, "error": "not a YouTube video"}), 400
    return None


@app.post("/fetch-metadata/<vid:video_id>")
def fetch_metadata(video_id):
    import json as _json
    if (err := _not_youtube(video_id)):
        return err
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        result = _ytdlp("--dump-json", "--no-download", "--no-playlist", url, timeout=60)
        if result.returncode != 0:
            reason       = _ytdlp_error(result.stderr)
            availability = _classify_unavailable(result.stderr)
            if availability:
                _set_availability(video_id, availability)
                return jsonify({"ok": False, "error": reason, "availability": availability}), 200
            return jsonify({"ok": False, "error": reason}), 502
        info = _json.loads(result.stdout)
    except Exception as e:
        return jsonify({"ok": False, "error": _clean_err(e)}), 500

    upload_date = info.get("upload_date")  # YYYYMMDD
    recorded_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}" if upload_date and len(upload_date) == 8 else None

    # The file's own credit (collabs "A, B", a name from before a channel
    # rename) and its real length win; the fetch only fills them when missing.
    with _db_lock:
        conn = get_conn()
        conn.execute('''
            UPDATE downloaded_videos SET
                title          = COALESCE(?, title),
                channel_name   = COALESCE(NULLIF(TRIM(channel_name), ''), ?),
                url            = COALESCE(?, url),
                description    = COALESCE(?, description),
                recorded_date  = COALESCE(?, recorded_date),
                duration_secs  = COALESCE(duration_secs, ?),
                view_count     = COALESCE(?, view_count),
                like_count     = COALESCE(?, like_count),
                stats_updated_at = CURRENT_TIMESTAMP,
                availability   = 'available'
            WHERE video_id = ?
        ''', (
            info.get("title") or None,
            _clean_name(info.get("channel") or info.get("uploader")),
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


def _purge_entry(conn, video_id):
    """Delete an entry and every row hanging off it, in the caller's transaction."""
    tracks = conn.execute("SELECT file_path FROM audio_tracks WHERE video_id = ?", (video_id,)).fetchall()
    conn.execute("DELETE FROM audio_tracks WHERE video_id = ?", (video_id,))
    # Its soundtracks were hidden audio entries; unhide the ones it was the last user of.
    for t in tracks:
        _restore_detached_audio(conn, t["file_path"])
    conn.execute("DELETE FROM downloaded_videos WHERE video_id = ?", (video_id,))
    conn.execute("DELETE FROM playlist_items WHERE video_id = ?", (video_id,))
    conn.execute("DELETE FROM watch_sessions WHERE video_id = ?", (video_id,))
    conn.execute("DELETE FROM segment_tags WHERE segment_id IN (SELECT id FROM segments WHERE video_id = ?)", (video_id,))
    conn.execute("DELETE FROM segments WHERE video_id = ?", (video_id,))
    conn.execute("DELETE FROM video_tags WHERE video_id = ?", (video_id,))
    shutil.rmtree(_thumb_versions_dir(video_id), ignore_errors=True)   # fetched thumbs die with the entry


@app.delete("/videos/<vid:video_id>")
def delete_video(video_id):
    with _db_lock:
        conn = get_conn()
        with conn:
            _purge_entry(conn, video_id)
        conn.close()
    return jsonify({"ok": True})

@app.get("/data-quality/duplicates")
def data_quality_duplicates():
    cfg = load_config()
    watch_dir = cfg.get("watch_directory", DEFAULT_WATCH)
    from collections import defaultdict
    groups = defaultdict(list)
    # A soundtrack carries its video's link on purpose; it's not a second copy.
    conn = get_conn()
    tracks = {os.path.realpath(resolve_media_path(r[0]) or r[0])
              for r in conn.execute("SELECT file_path FROM audio_tracks")}
    conn.close()
    for root, _dirs, files in os.walk(watch_dir):
        for fname in files:
            if not fname.lower().endswith(_LIBRARY_EXTS):
                continue
            fpath = os.path.join(root, fname)
            if os.path.realpath(fpath) in tracks:
                continue
            try:
                try:
                    meta = _meta_from_tinytag(fpath)
                except Exception:
                    meta = None
                if not meta or not meta.get("url"):
                    meta = _meta_from_ffprobe(fpath)
                vid, _src = _entry_id(meta.get("url"))
                if vid:
                    groups[vid].append(fpath)
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


_GONE = ("deleted", "private", "members", "unavailable")


@app.get("/data-quality/checks")
def data_quality_checks():
    """Cheaper library checks found by the data audit. Each check is a list of
    items {video_id?, title, detail}; the page renders them all the same way."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT video_id, title, channel_name, file_path, file_size_bytes, recorded_date, "
        "availability, source FROM downloaded_videos WHERE status = 'downloaded'"
    ).fetchall()
    profiles = {r["channel_name"] for r in conn.execute("SELECT channel_name FROM creators")}
    marked   = {r["channel_name"] for r in conn.execute("SELECT channel_name FROM channel_status")}
    # Soundtracks and the hidden entries behind them are files in use, not loose ones.
    in_use   = {os.path.realpath(r[0]) for r in conn.execute(
        "SELECT file_path FROM audio_tracks UNION SELECT file_path FROM downloaded_videos "
        "WHERE status = 'attached' AND file_path IS NOT NULL")}
    conn.close()

    def item(r, detail):
        return {"video_id": r["video_id"], "title": r["title"] or r["video_id"], "detail": detail}

    names, dates, stale, sizes = [], [], [], []
    per_artist = {}
    for r in rows:
        ch = r["channel_name"]
        if ch is not None and _clean_name(ch) != ch:
            names.append(item(r, f"{ch!r}"))
        rd = r["recorded_date"]
        if rd and not re.fullmatch(r"\d{4}(-\d{2}-\d{2})?", rd):
            dates.append(item(r, f"{rd} (should be {_norm_date(rd) or 'a date'})"))
        for name in _artist_names(ch):
            a = per_artist.setdefault(name, {"total": 0, "gone": 0, "yt": 0})
            a["total"] += 1
            if (r["source"] or "youtube") == "youtube":
                a["yt"] += 1
                a["gone"] += r["availability"] in _GONE
        fp = r["file_path"]
        if not fp:
            continue
        if os.path.isfile(fp):
            if r["file_size_bytes"] is not None and os.path.getsize(fp) != r["file_size_bytes"]:
                sizes.append(item(r, f"stored {r['file_size_bytes']:,} bytes, file is {os.path.getsize(fp):,}"))
        else:
            hit = resolve_media_path(fp)
            if hit:
                stale.append(item(r, f"{fp} → {hit}"))

    dead = [
        {"title": name, "detail": f"{a['gone']} of {a['yt']} YouTube videos gone, channel not marked"}
        for name, a in sorted(per_artist.items())
        if a["yt"] >= 3 and a["gone"] / a["yt"] >= 0.8 and name not in marked
    ]
    no_profile = [
        {"title": name, "detail": f"{a['total']} video{'s' if a['total'] != 1 else ''}"}
        for name, a in sorted(per_artist.items(), key=lambda kv: -kv[1]["total"])
        if name not in profiles
    ]

    # Leftovers on disk: partial downloads anywhere, media loose in the root.
    watch_dir = load_config().get("watch_directory", DEFAULT_WATCH)
    tracked   = {os.path.realpath(r["file_path"]) for r in rows if r["file_path"]} | in_use
    partial, loose = [], []
    if os.path.isdir(watch_dir):
        for dirpath, _, files in os.walk(watch_dir):
            for f in files:
                p = os.path.join(dirpath, f)
                if f.lower().endswith((".part", ".ytdl")):
                    partial.append({"title": f, "detail": p})
                elif dirpath.rstrip(os.sep) == watch_dir.rstrip(os.sep) \
                        and f.lower().endswith(_LIBRARY_EXTS) and not _is_temp_file(p) \
                        and os.path.realpath(p) not in tracked:
                    loose.append({"title": f, "detail": "untracked, in the library root"})

    checks = [
        ("names",   "channel names with stray spaces", names),
        ("dates",   "dates in an odd format", dates),
        ("dead",    "channels mostly gone but not marked", dead),
        ("stale",   "paths found only by fallback", stale),
        ("sizes",   "stored sizes that don't match the file", sizes),
        ("partial", "leftover partial downloads", partial),
        ("loose",   "untracked files in the library root", loose),
        ("profile", "artists without a creator profile", no_profile),
    ]
    return jsonify({"ok": True, "checks": [
        {"key": k, "label": label, "items": items} for k, label, items in checks]})


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


_YT_HOST = re.compile(r"^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$")


def _video_id_from_url(url):
    """The YouTube id in a YouTube link, else None. Another site's "?v=123..."
    is not a YouTube id, and the id must be exactly 11 characters."""
    if not url:
        return None
    m = re.match(r"(?:https?://)?([^/?#:]+)", url.strip(), re.I)
    if not m or not _YT_HOST.match(m.group(1).lower()):
        return None
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])", url) or \
        re.search(r"(?:youtu\.be/|/(?:shorts|live|embed|v)/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])", url)
    return m.group(1) if m else None


def _loose_video_files(watch_dir):
    """Video files sitting directly in the watch root (not already in a subfolder)."""
    out = []
    for fname in sorted(os.listdir(watch_dir)):
        src = os.path.join(watch_dir, fname)
        if not os.path.isfile(src):
            continue
        if not fname.lower().endswith(_LIBRARY_EXTS) or _is_temp_file(fname):
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
            if f.lower().endswith(_LIBRARY_EXTS) and not _is_temp_file(f):
                out.append(os.path.join(dirpath, f))
    return sorted(out)


_filing_lock = threading.Lock()


def _place(src, dest, mode):
    """Move or copy one file to dest without ever overwriting anything there.

    A same-drive move is a rename. Otherwise the bytes go to dest.part first
    (the watcher skips .part) and only a complete copy is renamed into place,
    so a crash or a slow copy never leaves a half file under the real name.
    The lock keeps the watcher and an organize run from filing two different
    files onto one name at the same moment."""
    with _filing_lock:
        if os.path.exists(dest):
            raise FileExistsError(f"already exists: {dest}")
        if mode == "move":
            try:
                os.rename(src, dest)
                return
            except OSError as e:
                if e.errno != errno.EXDEV:
                    raise
        part = dest + ".part"
        try:
            shutil.copy2(src, part)
            if os.path.getsize(part) != os.path.getsize(src):
                raise OSError("copy came out short")
            if os.path.exists(dest):
                raise FileExistsError(f"already exists: {dest}")
            os.replace(part, dest)
        finally:
            if os.path.exists(part):
                os.remove(part)
        if mode == "move":
            os.remove(src)


# What may sit next to a video as "<stem>.<ext>" or "<stem>.<lang>.<ext>".
_SIDECAR_RE = re.compile(r"(?:[a-z0-9_-]{1,12}\.)?(?:jpe?g|webp|png|info\.json|description|vtt|srt|ass|ssa|lrc|nfo)")


def _transfer(src, dest, mode):
    """Move or copy the video plus any companion files sharing its stem
    (thumbnail, info json). mode is 'move' or 'copy'."""
    _place(src, dest, mode)
    src_base = os.path.splitext(src)[0]
    dst_base = os.path.splitext(dest)[0]
    left = []
    # Every "<stem>.<ext>" / "<stem>.<lang>.<ext>" companion: thumbnail, info
    # json, description, subtitles, nfo. Other videos sharing the stem stay.
    folder = os.path.dirname(src) or "."
    stem   = os.path.basename(src_base) + "."
    names  = [os.path.basename(p) for p in glob.glob(glob.escape(src_base) + ".*")]
    videos = {os.path.splitext(n)[0] + "." for n in names if n.lower().endswith(_LIBRARY_EXTS)}
    for name in sorted(names):
        s = os.path.join(folder, name)
        if not name.startswith(stem) or s == src or not os.path.isfile(s):
            continue
        rest = name[len(stem):]
        if not _SIDECAR_RE.fullmatch(rest.lower()):
            continue
        # "A.part2.jpg" belongs to "A.part2.mp4", not to "A.mp4"
        if "." in rest and any(name.startswith(v) and len(v) > len(stem) for v in videos):
            continue
        try:
            _place(s, dst_base + name[len(stem) - 1:], mode)
        except Exception:
            left.append(name)               # name taken at the destination; never overwrite
    return left


def _file_into_library(src, watch_dir, mode="move"):
    """Move (or copy) one file into <watch>/<artist>/, verify it landed, then track it.
    Returns a per-file result dict; never raises."""
    r = {"file": src, "dest": None, "moved": False, "verified": False,
         "added": False, "video_id": None, "status": None}
    if not os.path.isfile(src):
        r["status"] = "missing-source"; return r

    meta   = _read_meta(src)
    artist = (meta.get("artist") or "").strip()
    if not artist:
        r["status"] = "no-artist"; return r
    # The tracker would skip it after the move: no link and no local marker yet.
    if not _entry_id(meta.get("url"))[0]:
        r["status"] = "no-link"; return r

    folder = _safe_dirname(artist)
    if folder in ("", ".", ".."):
        r["status"] = "bad-artist"; return r          # "<watch>/.." is outside the library
    # Filing a second copy would move the entry onto it and orphan the first;
    # filing a soundtrack would bring its hidden entry back.
    if _tracked_elsewhere(src):
        r["status"] = "duplicate"; return r
    if src.lower().endswith(_AUDIO_EXTS) and _is_attached_track(src):
        r["status"] = "soundtrack"; return r

    dest_dir = os.path.join(watch_dir, folder)
    dest     = os.path.join(dest_dir, os.path.basename(src))
    r["dest"] = dest

    if os.path.abspath(dest) == os.path.abspath(src):
        r["verified"] = True              # already in the right folder
    elif os.path.exists(dest):
        r["status"] = "dest-exists"; return r
    else:
        try:
            os.makedirs(dest_dir, exist_ok=True)
            r["sidecars_left"] = _transfer(src, dest, mode)
            r["moved"] = True
        except Exception as e:
            r["status"] = f"{mode}-failed: {_clean_err(e)}"; return r
        # Verify the file actually landed BEFORE writing to the DB.
        r["verified"] = os.path.isfile(dest)
        if not r["verified"]:
            r["status"] = "verify-failed"; return r

    pr  = process_video_file(dest)
    vid = pr.get("video_id")
    r["video_id"] = vid
    if pr["status"] in ("skipped",) or (pr["status"] or "").startswith("error"):
        r["status"] = pr["status"]; return r
    # process_video_file won't overwrite the path of an already-'downloaded'
    # row, so force file_path to the verified new location here.
    if vid:
        with _db_lock:
            conn = get_conn()
            conn.execute(
                "UPDATE downloaded_videos SET file_path=? WHERE video_id=?", (dest, vid)
            )
            conn.commit()
            conn.close()
    r["added"]  = True
    r["status"] = "filed"
    return r


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
    if _system_dir(source):
        return jsonify({"ok": False, "error": f"Not a media folder: {source}"}), 400
    _remember_picked(source)
    recursive = os.path.abspath(source) != os.path.abspath(watch_dir)

    items = []
    conn  = get_conn()
    for src in _candidate_files(source, recursive):
        fname  = os.path.basename(src)
        meta   = _read_meta(src)
        artist = (meta.get("artist") or "").strip()
        vid, _src = _entry_id(meta.get("url"))

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
        elif not vid:
            dest, status = None, "no-link"
        elif _safe_dirname(artist) in ("", ".", ".."):
            dest, status = None, "bad-artist"
        elif src.lower().endswith(_AUDIO_EXTS) and _is_attached_track(src, conn):
            dest, status = None, "soundtrack"
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
    with _pinned_profile():
        return _organize_apply()


def _organize_apply():
    body      = request.get_json(silent=True) or {}
    cfg       = load_config()
    watch_dir = cfg.get("watch_directory", DEFAULT_WATCH)
    if not os.path.isdir(watch_dir):
        return jsonify({"ok": False, "error": f"Directory not found: {watch_dir}"}), 400

    mode    = "copy" if body.get("mode") == "copy" else "move"
    source  = (body.get("source") or "").strip() or watch_dir
    files   = body.get("files")
    # Only files the app can already see: media roots, or a folder scanned for import.
    if isinstance(files, list) and files:
        targets = [str(f) for f in files]
        bad     = next((f for f in targets if not _import_allowed(f)), None)
        if bad:
            return jsonify({"ok": False, "error": f"Not in a media or import folder: {bad}"}), 400
    else:
        real = os.path.realpath(source)
        if not os.path.isdir(real) or not (
                any(real == os.path.realpath(r) or real.startswith(os.path.realpath(r) + os.sep)
                    for r in get_media_roots())
                or any(real == p or real.startswith(p.rstrip(os.sep) + os.sep) for p in _picked_paths)):
            return jsonify({"ok": False, "error": f"Not a media or import folder: {source}"}), 400
        targets = _candidate_files(source, os.path.abspath(source) != os.path.abspath(watch_dir))

    results = [_file_into_library(src, watch_dir, mode) for src in targets]

    clear_media_index()
    return jsonify({"ok": True, "results": results})


# ---------------------------------------------------------------------------
# Inspect / enrich a single source file before importing
# ---------------------------------------------------------------------------

def _meta_payload(meta):
    artist = (meta.get("artist") or "").strip()
    vid, source = _entry_id(meta.get("url"))
    return {
        "title":         meta.get("title"),
        "artist":        artist or None,
        "url":           None if source == "local" else meta.get("url"),
        "video_id":      vid,
        "source":        source,
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
    if not _import_allowed(path):
        return jsonify({"ok": False, "error": "Not in a media or import folder"}), 403
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
    path = _import_allowed((request.args.get("file") or "").strip())
    thumb = _sidecar_thumb(path) if path else None
    if thumb:
        return send_from_directory(os.path.dirname(thumb), os.path.basename(thumb))
    return ("", 404)


@app.post("/import/fetch-meta")
def import_fetch_meta():
    """Suggest metadata from YouTube (yt-dlp) WITHOUT writing anything."""
    body = request.get_json(silent=True) or {}
    path = (body.get("file") or "").strip()
    vid  = _valid_video_id(str(body.get("video_id") or ""))
    if not vid and path and os.path.isfile(path):
        vid = _video_id_from_url(_read_meta(path).get("url"))
    # Minted ids (non-YouTube entries) end in "_", which no YouTube id can.
    if not vid or vid[-1] not in _YT_LAST_CHARS:
        return jsonify({"ok": False, "error": "no YouTube id — add a URL first"}), 400
    url = f"https://www.youtube.com/watch?v={vid}"
    try:
        res = _ytdlp("--dump-json", "--no-download", "--no-playlist", url, timeout=60)
    except Exception as e:
        return jsonify({"ok": False, "error": _clean_err(e)}), 500
    if res.returncode != 0:
        avail = _classify_unavailable(res.stderr)
        if avail and path:
            # remember unavailability if this id is already tracked
            _set_availability(vid, avail)
        return jsonify({"ok": False, "error": _ytdlp_error(res.stderr), "availability": avail}), 200
    info = json.loads(res.stdout)
    ud   = info.get("upload_date")
    rec  = f"{ud[:4]}-{ud[4:6]}-{ud[6:]}" if ud and len(ud) == 8 else None
    return jsonify({"ok": True, "suggested": {
        "title":         info.get("title"),
        "artist":        _clean_name(info.get("channel") or info.get("uploader")),
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


def _tracked_row_for_file(conn, path):
    """The library row whose file is path, or None."""
    real = os.path.realpath(path)
    rows = conn.execute(
        "SELECT video_id, file_path FROM downloaded_videos WHERE status = 'downloaded' "
        "AND instr(file_path, ?) > 0", (os.path.basename(path),)).fetchall()
    for r in rows:
        if os.path.realpath(resolve_media_path(r["file_path"]) or r["file_path"]) == real:
            return r
    return None


@app.post("/import/enrich")
def import_enrich():
    """Write metadata tags into the file itself (ffmpeg stream copy), then verify."""
    body   = request.get_json(silent=True) or {}
    path   = (body.get("file") or "").strip()
    fields = body.get("fields") or {}
    if not path or not os.path.isfile(path):
        return jsonify({"ok": False, "error": "file not found"}), 404
    if not _import_allowed(path):
        return jsonify({"ok": False, "error": "Not in a media or import folder"}), 403
    # No link anywhere (a rip, a clip from a dead site): mark the file as a local
    # entry so the tracker can still give it a stable id.
    fields = dict(fields)
    if not (fields.get("url") or "").strip():
        if _read_meta(path).get("url"):
            fields.pop("url", None)                 # keep the existing tag as is
        else:
            fields["url"] = _LOCAL_PREFIX + uuid.uuid4().hex
    metargs = _ffmeta_args(fields)
    if not metargs:
        return jsonify({"ok": False, "error": "no fields to write"}), 400
    # A tracked file keeps its id: a new link would make the watcher add the
    # same file again as a second entry, with none of the first one's history.
    conn = get_conn()
    tracked = _tracked_row_for_file(conn, path)
    conn.close()
    if tracked and fields.get("url") and _entry_id(fields["url"])[0] != tracked["video_id"]:
        return jsonify({"ok": False, "error": "this file is already in the library under another link; "
                                              "the link can't be changed here"}), 409

    ext = os.path.splitext(path)[1]
    tmp = path + ".enrich.temp" + ext  # ".temp." keeps the watcher off it
    # -map 0 -c copy: keep every stream, no re-encode. -map_metadata 0: preserve
    # existing tags, then the -metadata flags override only the provided fields.
    args = ["ffmpeg", "-y", "-i", path, "-map", "0", "-c", "copy", "-map_metadata", "0"] + metargs + [tmp]
    try:
        res = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except Exception as e:
        if os.path.exists(tmp):
            try: os.remove(tmp)
            except OSError: pass
        return jsonify({"ok": False, "error": _clean_err(e)}), 500

    if res.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) < 1024:
        if os.path.exists(tmp):
            try: os.remove(tmp)
            except OSError: pass
        return jsonify({"ok": False, "error": "ffmpeg failed: " + _clean_err((res.stderr or "")[-300:])}), 500

    # The original is the only copy: refuse a rewrite that came out shorter.
    old_d, new_d = _ffprobe_duration(path), _ffprobe_duration(tmp)
    if old_d and (not new_d or abs(old_d - new_d) > 1.0):
        try: os.remove(tmp)
        except OSError: pass
        return jsonify({"ok": False, "error": "rewritten file's length doesn't match the original; left it untouched"}), 500

    os.replace(tmp, path)              # atomic swap over the original
    meta = _read_meta(path)
    if tracked:
        # A rescan never re-reads a tracked file, so the library row follows here.
        with _db_lock:
            conn = get_conn()
            conn.execute('''
                UPDATE downloaded_videos SET title = COALESCE(?, title),
                    channel_name = COALESCE(?, channel_name), genre = COALESCE(?, genre),
                    description = COALESCE(?, description), recorded_date = COALESCE(?, recorded_date),
                    file_size_bytes = ?
                WHERE video_id = ?
            ''', (meta.get("title"), _clean_name(meta.get("artist")), meta.get("genre"),
                  meta.get("description"), _norm_date(meta.get("recorded_date")),
                  os.path.getsize(path), tracked["video_id"]))
            conn.commit()
            conn.close()
    return jsonify({"ok": True, "meta": _meta_payload(meta)})


@app.get("/artist-thumb/<path:name>")
def serve_artist_thumb(name):
    artist_thumbs_dir = os.path.realpath(get_artist_thumbs_dir())
    safe = _safe_dirname(name)
    if not safe or safe.startswith("."):          # also rules out "." and ".."
        return ("", 404)
    artist_dir = os.path.realpath(os.path.join(artist_thumbs_dir, safe))
    if artist_dir == artist_thumbs_dir or \
            os.path.commonpath([artist_dir, artist_thumbs_dir]) != artist_thumbs_dir:
        return ("", 404)
    if os.path.isdir(artist_dir):
        for fname in os.listdir(artist_dir):
            if fname.lower().endswith((".jpg", ".jpeg", ".webp", ".png")):
                return send_from_directory(artist_dir, fname)
    return ("", 404)


@app.get("/thumb/<vid:video_id>")
def serve_thumb(video_id):
    conn = get_conn()
    row = conn.execute(
        "SELECT channel_name, file_path FROM downloaded_videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    conn.close()
    # Look in artist folder (a collab's copies sit under each split name)
    for name in _artist_names(row["channel_name"] if row else None):
        artist_dir = os.path.join(get_artist_thumbs_dir(), _safe_dirname(name))
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


@app.get("/thumb-latest/<vid:video_id>")
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
    for name in _artist_names(row["channel_name"] if row else None):
        ad = os.path.join(get_artist_thumbs_dir(), _safe_dirname(name))
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


_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024   # thumbnails are well under this


# Only YouTube's image CDNs: the fallback url comes from yt-dlp output, so it
# must not be able to point (or redirect) us at localhost or the LAN.
_THUMB_HOSTS = ("ytimg.com", "ggpht.com", "googleusercontent.com")


def _check_thumb_url(url):
    parts = urllib.parse.urlsplit(str(url))
    host  = (parts.hostname or "").lower()
    if parts.scheme != "https" or not any(host == h or host.endswith("." + h) for h in _THUMB_HOSTS):
        raise ValueError("thumbnail host not allowed")


class _ThumbRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Re-check the host on every redirect hop."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_thumb_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_thumb_opener = urllib.request.build_opener(_ThumbRedirectHandler)


def _download_bytes(url):
    _check_thumb_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with _thumb_opener.open(req, timeout=20) as r:
        data = r.read(_MAX_DOWNLOAD_BYTES + 1)
    if len(data) > _MAX_DOWNLOAD_BYTES:
        raise ValueError("thumbnail too large")
    return data


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


@app.post("/fetch-thumbnail/<vid:video_id>")
def fetch_thumbnail(video_id):
    if (err := _not_youtube(video_id)):
        return err
    body  = request.get_json(silent=True) or {}
    force = bool(body.get("force")) or request.args.get("force") in ("1", "true")
    # YouTube's image CDN first: no yt-dlp call, so no bot check or rate limit
    # in the way. yt-dlp only resolves an odd thumbnail URL when that fails.
    try:
        data, ext = _fetch_youtube_thumb(video_id)
    except Exception:
        url = f"https://www.youtube.com/watch?v={video_id}"
        res = _ytdlp("--no-warnings", "--skip-download", "--print", "%(thumbnail)s", url, timeout=60)
        if res.returncode != 0:
            avail = _classify_unavailable(res.stderr)
            if avail:
                _set_availability(video_id, avail)
                return jsonify({"ok": False, "error": _ytdlp_error(res.stderr), "availability": avail}), 200
            return jsonify({"ok": False, "error": _ytdlp_error(res.stderr)}), 502
        thumb_url = (res.stdout or "").strip().splitlines()[0] if res.stdout.strip() else ""
        try:
            data, ext = _fetch_youtube_thumb(video_id, thumb_url)
        except Exception as e:
            return jsonify({"ok": False, "error": _clean_err(e)}), 502

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


@app.get("/thumbnails/<vid:video_id>")
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


@app.get("/thumbnail-version/<vid:video_id>/<path:fname>")
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


def _unwrap_yt_redirect(url):
    """YouTube wraps every About-panel link as youtube.com/redirect?...&q=<target>.
    Return the real target so the link opens directly and its site is visible."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return url
    host = (parts.hostname or "").lower()
    if not (host == "youtube.com" or host.endswith(".youtube.com")) or parts.path != "/redirect":
        return url
    target = (urllib.parse.parse_qs(parts.query).get("q") or [""])[0].strip()
    if not target:
        return url
    if "://" not in target:
        target = "https://" + target
    return target


def _safe_link(url):
    """Only keep web URLs. Scraped About-panel links are attacker-controlled and
    a javascript: href would execute in the dashboard when clicked."""
    u = _unwrap_yt_redirect((url or "").strip())
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
        # Re-run the filter on read: rows saved before redirect unwrapping still
        # hold youtube.com/redirect wrappers.
        d["links"] = _safe_links(json.loads(d["links"])) if d.get("links") else []
    except (TypeError, ValueError):
        d["links"] = []
    return d


@app.post("/creator")
def upsert_creator():
    body         = request.get_json(silent=True) or {}
    channel_name = _clean_name(body.get("channel_name") if isinstance(body.get("channel_name"), str) else "")
    if not channel_name:
        return jsonify({"ok": False, "error": "channel_name required"}), 400

    def count(v):
        # Scraped numbers: a string or float from a bad parse must not land in
        # an integer column and break sorting.
        try:
            n = int(v) if v is not None and not isinstance(v, bool) else None
        except (TypeError, ValueError):
            return None
        return n if n is not None and n >= 0 else None

    links      = _safe_links(body.get("links"))
    links_json = json.dumps(links) if links else None
    vals = {
        "channel_name":     channel_name,
        "handle":           _text(body.get("handle"), 200),
        "channel_url":      _safe_link(body.get("channel_url")),
        "description":      _text(body.get("description"), 10000),
        "country":          _text(body.get("country"), 100),
        "joined_date":      _text(body.get("joined_date"), 100),
        "subscriber_count": count(body.get("subscriber_count")),
        "subscribers_text": _text(body.get("subscribers_text"), 100),
        "video_count":      count(body.get("video_count")),
        "total_views":      count(body.get("total_views")),
        "links":            links_json,
        "email":            _text(body.get("email"), 320),
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


def _linked_artists(conn, channel_name):
    row = conn.execute(
        "SELECT group_id FROM artist_links WHERE channel_name = ?", (channel_name,)
    ).fetchone()
    if not row:
        return []
    rows = conn.execute(
        "SELECT channel_name FROM artist_links WHERE group_id = ? AND channel_name != ? "
        "ORDER BY channel_name COLLATE NOCASE",
        (row["group_id"], channel_name),
    ).fetchall()
    return [r["channel_name"] for r in rows]


@app.get("/artist-links/<path:channel_name>")
def get_artist_links(channel_name):
    conn = get_conn()
    names = _linked_artists(conn, channel_name)
    conn.close()
    return jsonify(names)


def _body_name(body, key):
    v = body.get(key)
    return _clean_name(v) if isinstance(v, str) else None


def _known_artist(conn, name):
    """A name some video credits (alone or in a collab) or a captured creator.
    Rows keyed by a typo or a stale name would never show anywhere."""
    if conn.execute("SELECT 1 FROM creators WHERE channel_name = ?", (name,)).fetchone():
        return True
    rows = conn.execute(
        "SELECT DISTINCT channel_name FROM downloaded_videos WHERE instr(channel_name, ?) > 0", (name,))
    return any(name in _artist_names(r[0]) for r in rows)


@app.post("/artist-links")
def link_artists():
    """Mark two channels as the same person. Linking into an existing group
    pulls the whole other group along, so A-B plus B-C ends as one A-B-C group."""
    body = request.get_json(silent=True) or {}
    a, b = _body_name(body, "a"), _body_name(body, "b")
    if not a or not b or a == b:
        return jsonify({"ok": False, "error": "two different channel names required"}), 400
    with _db_lock:
        conn = get_conn()
        unknown = [n for n in (a, b) if not _known_artist(conn, n)]
        if unknown:
            conn.close()
            return jsonify({"ok": False, "error": f"no videos from {unknown[0]}"}), 404
        groups = {
            r["channel_name"]: r["group_id"]
            for r in conn.execute(
                "SELECT channel_name, group_id FROM artist_links WHERE channel_name IN (?, ?)", (a, b)
            )
        }
        ga, gb = groups.get(a), groups.get(b)
        if ga is None and gb is None:
            gid = (conn.execute("SELECT MAX(group_id) FROM artist_links").fetchone()[0] or 0) + 1
            conn.executemany(
                "INSERT INTO artist_links (channel_name, group_id) VALUES (?, ?)", [(a, gid), (b, gid)]
            )
        elif ga is None:
            conn.execute("INSERT INTO artist_links (channel_name, group_id) VALUES (?, ?)", (a, gb))
            gid = gb
        elif gb is None:
            conn.execute("INSERT INTO artist_links (channel_name, group_id) VALUES (?, ?)", (b, ga))
            gid = ga
        else:
            conn.execute("UPDATE artist_links SET group_id = ? WHERE group_id = ?", (ga, gb))
            gid = ga
        conn.commit()
        names = _linked_artists(conn, a)
        conn.close()
    return jsonify({"ok": True, "linked": names})


@app.delete("/artist-links/<path:channel_name>")
def unlink_artist(channel_name):
    """Take one channel out of its group. A group left with a single member is
    dissolved, since one channel linked to nothing means nothing."""
    with _db_lock:
        conn = get_conn()
        row = conn.execute(
            "SELECT group_id FROM artist_links WHERE channel_name = ?", (channel_name,)
        ).fetchone()
        if row:
            conn.execute("DELETE FROM artist_links WHERE channel_name = ?", (channel_name,))
            left = conn.execute(
                "SELECT COUNT(*) FROM artist_links WHERE group_id = ?", (row["group_id"],)
            ).fetchone()[0]
            if left < 2:
                conn.execute("DELETE FROM artist_links WHERE group_id = ?", (row["group_id"],))
            conn.commit()
        conn.close()
    return jsonify({"ok": True})


_CHANNEL_STATUSES = ("abandoned", "deleted", "banned")


@app.get("/channel-status")
def list_channel_status():
    conn = get_conn()
    rows = conn.execute("SELECT channel_name, status, marked_at FROM channel_status").fetchall()
    conn.close()
    return jsonify({r["channel_name"]: {"status": r["status"], "marked_at": r["marked_at"]} for r in rows})


@app.post("/channel-status")
def set_channel_status():
    """Mark a channel abandoned, deleted or banned; a null status clears the mark."""
    body         = request.get_json(silent=True) or {}
    channel_name = _body_name(body, "channel_name")
    status       = body.get("status")
    if not channel_name:
        return jsonify({"ok": False, "error": "channel_name required"}), 400
    if status is not None and status not in _CHANNEL_STATUSES:
        return jsonify({"ok": False, "error": "status must be abandoned, deleted, banned or null"}), 400
    with _db_lock:
        conn = get_conn()
        if status is not None and not _known_artist(conn, channel_name):
            conn.close()
            return jsonify({"ok": False, "error": f"no videos from {channel_name}"}), 404
        if status is None:
            conn.execute("DELETE FROM channel_status WHERE channel_name = ?", (channel_name,))
        else:
            conn.execute('''
                INSERT INTO channel_status (channel_name, status) VALUES (?, ?)
                ON CONFLICT(channel_name) DO UPDATE SET status = excluded.status, marked_at = CURRENT_TIMESTAMP
            ''', (channel_name, status))
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Tags and segments
#
# A tag is a word the user invents; it lives once, library-wide, with a colour
# and optional keyword rules. A segment is a time range inside one video, either
# an embedded chapter or hand-drawn. Tags attach to segments or to whole videos.
# ---------------------------------------------------------------------------

_TAG_PALETTE = [
    "#4ade80", "#5b9dff", "#f59e0b", "#f472b6", "#a78bfa",
    "#22d3ee", "#fb7185", "#84cc16", "#e879f9", "#fbbf24",
]


def _tag_row(row):
    return {"id": row["id"], "name": row["name"], "color": row["color"]}


def _ensure_tag(conn, name, color=None):
    """Return the tag row for `name`, creating it (case-insensitive) if missing."""
    name = (name or "").strip()[:60]          # same cap as creating one by hand
    if not name:
        return None
    row = conn.execute("SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    if row:
        return _tag_row(row)
    if not color:
        n = conn.execute("SELECT COUNT(*) FROM tags").fetchone()[0]
        color = _TAG_PALETTE[n % len(_TAG_PALETTE)]
    cur = conn.execute("INSERT INTO tags (name, color) VALUES (?, ?)", (name, color))
    return {"id": cur.lastrowid, "name": name, "color": color}


def _attach_tags(conn, videos):
    """Add `tags: [{id, name, color}]` to each video dict: direct tags plus any
    tag carried by one of its segments."""
    if not videos:
        return videos
    rows = conn.execute('''
        SELECT x.video_id, t.id, t.name, t.color
        FROM (
            SELECT video_id, tag_id FROM video_tags
            UNION
            SELECT s.video_id, st.tag_id FROM segment_tags st JOIN segments s ON s.id = st.segment_id
        ) x
        JOIN tags t ON t.id = x.tag_id
        ORDER BY t.name COLLATE NOCASE
    ''').fetchall()
    by_video = {}
    for r in rows:
        by_video.setdefault(r["video_id"], []).append(_tag_row(r))
    for v in videos:
        v["tags"] = by_video.get(v["video_id"], [])
    return videos


def _segments_for(conn, video_id):
    segs = [dict(r) for r in conn.execute(
        "SELECT * FROM segments WHERE video_id = ? ORDER BY start_secs, end_secs", (video_id,)
    ).fetchall()]
    if segs:
        ids = [s["id"] for s in segs]
        marks = ",".join("?" * len(ids))
        rows = conn.execute(f'''
            SELECT st.segment_id, st.source, t.id, t.name, t.color
            FROM segment_tags st JOIN tags t ON t.id = st.tag_id
            WHERE st.segment_id IN ({marks}) ORDER BY t.name COLLATE NOCASE
        ''', ids).fetchall()
        by_seg = {}
        for r in rows:
            by_seg.setdefault(r["segment_id"], []).append({**_tag_row(r), "source": r["source"]})
        for s in segs:
            s["tags"] = by_seg.get(s["id"], [])
    return segs


def _chapters_to_import(video_id, file_path):
    """Chapters for a video that has no segments yet, read without holding the
    DB lock (ffprobe can take seconds). [] when there's nothing to import."""
    conn = get_conn()
    has_any = conn.execute("SELECT 1 FROM segments WHERE video_id = ? LIMIT 1", (video_id,)).fetchone()
    conn.close()
    return [] if has_any else (_read_chapters(file_path) or [])


def _chapters_once(video_id, file_path):
    """_chapters_to_import for the scan: only the first time a video is seen,
    so deleting a video's segments sticks. Marks the video checked."""
    conn = get_conn()
    row = conn.execute("SELECT chapters_checked FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone()
    conn.close()
    if not row or row["chapters_checked"]:
        return []
    chapters = _chapters_to_import(video_id, file_path)
    with _db_lock:
        conn = get_conn()
        conn.execute("UPDATE downloaded_videos SET chapters_checked = 1 WHERE video_id = ?", (video_id,))
        conn.commit()
        conn.close()
    return chapters


def _import_chapters(conn, video_id, file_path, replace=False, chapters=None):
    """Turn embedded chapters into `source='chapter'` segments. Returns how many
    were added. With replace=False a video that already has segments is left
    alone; with replace=True only the chapter-sourced ones are swapped out."""
    has_any = conn.execute("SELECT 1 FROM segments WHERE video_id = ? LIMIT 1", (video_id,)).fetchone()
    if has_any and not replace:
        return 0
    if chapters is None:
        chapters = _read_chapters(file_path)
    if not chapters:
        return 0
    if replace:
        conn.execute('''DELETE FROM segment_tags WHERE segment_id IN
                        (SELECT id FROM segments WHERE video_id = ? AND source = 'chapter')''', (video_id,))
        conn.execute("DELETE FROM segments WHERE video_id = ? AND source = 'chapter'", (video_id,))
    conn.executemany(
        "INSERT INTO segments (video_id, start_secs, end_secs, title, source) VALUES (?, ?, ?, ?, 'chapter')",
        [(video_id, c["start"], c["end"], c["title"]) for c in chapters],
    )
    return len(chapters)


def _apply_rules(conn, video_ids=None):
    """Attach tags by keyword: any segment title or video title containing a
    rule's keyword (case-insensitive) gets that rule's tag with source='rule'.
    Idempotent; only adds. Returns {"segments": n, "videos": n} newly tagged."""
    rules = conn.execute("SELECT tag_id, keyword FROM tag_rules").fetchall()
    if not rules:
        return {"segments": 0, "videos": 0}
    if video_ids:
        marks  = ",".join("?" * len(video_ids))
        params = list(video_ids)
        segs = conn.execute(f"SELECT id, title FROM segments WHERE video_id IN ({marks})", params).fetchall()
        vids = conn.execute(f"SELECT video_id, title FROM downloaded_videos WHERE status = 'downloaded' AND video_id IN ({marks})", params).fetchall()
    else:
        segs = conn.execute("SELECT id, title FROM segments").fetchall()
        vids = conn.execute("SELECT video_id, title FROM downloaded_videos WHERE status = 'downloaded'").fetchall()
    added = {"segments": 0, "videos": 0}
    for rule in rules:
        kw = (rule["keyword"] or "").strip().lower()
        if not kw:
            continue
        for s in segs:
            if kw in (s["title"] or "").lower():
                cur = conn.execute("INSERT OR IGNORE INTO segment_tags (segment_id, tag_id, source) VALUES (?, ?, 'rule')",
                                   (s["id"], rule["tag_id"]))
                added["segments"] += max(cur.rowcount, 0)
        for v in vids:
            if kw in (v["title"] or "").lower():
                cur = conn.execute("INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'rule')",
                                   (v["video_id"], rule["tag_id"]))
                added["videos"] += max(cur.rowcount, 0)
    return added


def _parse_secs(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v >= 0 else None


# ---- tags ------------------------------------------------------------------

@app.get("/tags")
def list_tags():
    if _wants_html():
        return _spa()  # browser navigating to the tags page, not an API call
    conn = get_conn()
    rows = conn.execute('''
        SELECT t.id, t.name, t.color, t.created_at,
               (SELECT COUNT(*) FROM segment_tags st JOIN segments s ON s.id = st.segment_id
                    JOIN downloaded_videos v ON v.video_id = s.video_id AND v.status = 'downloaded'
                    WHERE st.tag_id = t.id) AS segment_count,
               (SELECT COUNT(DISTINCT x.video_id) FROM (
                    SELECT video_id FROM video_tags WHERE tag_id = t.id
                    UNION
                    SELECT s.video_id FROM segment_tags st JOIN segments s ON s.id = st.segment_id
                    WHERE st.tag_id = t.id
               ) x JOIN downloaded_videos v ON v.video_id = x.video_id AND v.status = 'downloaded') AS video_count
        FROM tags t ORDER BY t.name COLLATE NOCASE
    ''').fetchall()
    rules = conn.execute("SELECT id, tag_id, keyword FROM tag_rules ORDER BY keyword COLLATE NOCASE").fetchall()
    conn.close()
    by_tag = {}
    for r in rules:
        by_tag.setdefault(r["tag_id"], []).append({"id": r["id"], "keyword": r["keyword"]})
    out = []
    for r in rows:
        d = dict(r)
        d["rules"] = by_tag.get(d["id"], [])
        out.append(d)
    return jsonify(out)


@app.post("/tags")
def create_tag():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    if len(name) > 60:
        return jsonify({"ok": False, "error": "name too long"}), 400
    with _db_lock:
        conn = get_conn()
        tag = _ensure_tag(conn, name, body.get("color"))
        conn.commit()
        conn.close()
    return jsonify({"ok": True, **tag})


@app.patch("/tags/<int:tag_id>")
def update_tag(tag_id):
    body = request.get_json(silent=True) or {}
    sets, params = [], []
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "name required"}), 400
        if len(name) > 60:
            return jsonify({"ok": False, "error": "name too long"}), 400
        sets.append("name = ?"); params.append(name)
    if "color" in body:
        color = (body.get("color") or "").strip()
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            return jsonify({"ok": False, "error": "color must be #rrggbb"}), 400
        sets.append("color = ?"); params.append(color)
    if not sets:
        return jsonify({"ok": False, "error": "nothing to update"}), 400
    with _db_lock:
        conn = get_conn()
        try:
            conn.execute(f"UPDATE tags SET {', '.join(sets)} WHERE id = ?", params + [tag_id])
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({"ok": False, "error": "a tag with that name already exists"}), 409
        row = conn.execute("SELECT id, name, color FROM tags WHERE id = ?", (tag_id,)).fetchone()
        conn.close()
    if not row:
        return jsonify({"ok": False, "error": "not found"}), 404
    return jsonify({"ok": True, **_tag_row(row)})


@app.delete("/tags/<int:tag_id>")
def delete_tag(tag_id):
    with _db_lock:
        conn = get_conn()
        conn.execute("DELETE FROM segment_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM video_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tag_rules WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


@app.get("/tags/<int:tag_id>/videos")
def tag_videos(tag_id):
    """Every downloaded video carrying the tag, with the segments that match."""
    conn = get_conn()
    tag = conn.execute("SELECT id, name, color FROM tags WHERE id = ?", (tag_id,)).fetchone()
    if not tag:
        conn.close()
        return jsonify({"ok": False, "error": "not found"}), 404
    rows = conn.execute('''
        SELECT v.*, COALESCE(w.watch_count, 0) AS watch_count, w.last_watched_at
        FROM downloaded_videos v
        LEFT JOIN (
            SELECT video_id, COUNT(*) AS watch_count, MAX(updated_at) AS last_watched_at
            FROM watch_sessions WHERE completed = 1 GROUP BY video_id
        ) w ON w.video_id = v.video_id
        WHERE v.status = 'downloaded' AND v.video_id IN (
            SELECT video_id FROM video_tags WHERE tag_id = ?
            UNION
            SELECT s.video_id FROM segment_tags st JOIN segments s ON s.id = st.segment_id WHERE st.tag_id = ?
        )
        ORDER BY v.downloaded_at DESC
    ''', (tag_id, tag_id)).fetchall()
    videos = [dict(r) for r in rows]
    _attach_tags(conn, videos)
    segs = conn.execute('''
        SELECT s.id, s.video_id, s.start_secs, s.end_secs, s.title
        FROM segment_tags st JOIN segments s ON s.id = st.segment_id
        WHERE st.tag_id = ? ORDER BY s.video_id, s.start_secs
    ''', (tag_id,)).fetchall()
    direct = {r["video_id"] for r in conn.execute("SELECT video_id FROM video_tags WHERE tag_id = ?", (tag_id,))}
    conn.close()
    by_video = {}
    for r in segs:
        by_video.setdefault(r["video_id"], []).append(dict(r))
    for v in videos:
        v["matched_segments"] = by_video.get(v["video_id"], [])
        v["tagged_whole"]     = v["video_id"] in direct
    return jsonify({"ok": True, "tag": _tag_row(tag), "videos": videos})


@app.get("/tags/<int:tag_id>/segments")
def tag_segments(tag_id):
    """Flat play queue: every tagged segment across the library, newest video
    first, then by start time. A video tagged as a whole (and with no tagged
    segments of its own) contributes one item spanning its full length."""
    conn = get_conn()
    tag = conn.execute("SELECT id, name, color FROM tags WHERE id = ?", (tag_id,)).fetchone()
    if not tag:
        conn.close()
        return jsonify({"ok": False, "error": "not found"}), 404
    rows = conn.execute('''
        SELECT s.id AS segment_id, s.video_id, s.start_secs, s.end_secs, s.title,
               v.title AS video_title, v.channel_name, v.downloaded_at
        FROM segment_tags st
        JOIN segments s ON s.id = st.segment_id
        JOIN downloaded_videos v ON v.video_id = s.video_id AND v.status = 'downloaded'
        WHERE st.tag_id = ?
    ''', (tag_id,)).fetchall()
    items = [dict(r) for r in rows]
    covered = {i["video_id"] for i in items}
    whole = conn.execute('''
        SELECT v.video_id, v.title AS video_title, v.channel_name, v.duration_secs, v.downloaded_at
        FROM video_tags vt JOIN downloaded_videos v ON v.video_id = vt.video_id AND v.status = 'downloaded'
        WHERE vt.tag_id = ?
    ''', (tag_id,)).fetchall()
    conn.close()
    for r in whole:
        if r["video_id"] in covered:
            continue
        items.append({
            "segment_id": None, "video_id": r["video_id"], "start_secs": 0.0,
            "end_secs": r["duration_secs"], "title": None,
            "video_title": r["video_title"], "channel_name": r["channel_name"],
            "downloaded_at": r["downloaded_at"],
        })
    # Newest video first, then chronological inside the video.
    items.sort(key=lambda i: (-(_ts(i["downloaded_at"])), i["start_secs"] or 0.0))
    for i in items:
        i.pop("downloaded_at", None)
    return jsonify({"ok": True, "tag": _tag_row(tag), "items": items})


def _ts(value):
    """Sortable number from a SQLite timestamp string; 0 when unknown."""
    try:
        return time.mktime(time.strptime(str(value)[:19], "%Y-%m-%d %H:%M:%S"))
    except Exception:
        return 0.0


@app.post("/tags/<int:tag_id>/rules")
def add_tag_rule(tag_id):
    body    = request.get_json(silent=True) or {}
    keyword = (body.get("keyword") or "").strip()
    if not keyword:
        return jsonify({"ok": False, "error": "keyword required"}), 400
    with _db_lock:
        conn = get_conn()
        if not conn.execute("SELECT 1 FROM tags WHERE id = ?", (tag_id,)).fetchone():
            conn.close()
            return jsonify({"ok": False, "error": "not found"}), 404
        dup = conn.execute("SELECT id FROM tag_rules WHERE tag_id = ? AND keyword = ? COLLATE NOCASE",
                           (tag_id, keyword)).fetchone()
        if dup:
            conn.close()
            return jsonify({"ok": True, "id": dup["id"], "keyword": keyword, "duplicate": True})
        cur = conn.execute("INSERT INTO tag_rules (tag_id, keyword) VALUES (?, ?)", (tag_id, keyword))
        conn.commit()
        conn.close()
    return jsonify({"ok": True, "id": cur.lastrowid, "keyword": keyword})


@app.delete("/tags/<int:tag_id>/rules/<int:rule_id>")
def delete_tag_rule(tag_id, rule_id):
    with _db_lock:
        conn = get_conn()
        conn.execute("DELETE FROM tag_rules WHERE id = ? AND tag_id = ?", (rule_id, tag_id))
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


@app.post("/tags/apply-rules")
def apply_tag_rules():
    """Run every keyword rule over the whole library. Only adds; a tag the user
    removed by hand comes back only if they press this again."""
    with _db_lock:
        conn = get_conn()
        added = _apply_rules(conn)
        conn.commit()
        conn.close()
    return jsonify({"ok": True, **added})


# ---- segments ---------------------------------------------------------------

@app.get("/videos/<vid:video_id>/segments")
def list_segments(video_id):
    """Segments with their tags, plus the tags attached to the video as a whole
    (kept apart so the UI can offer to remove exactly those)."""
    conn = get_conn()
    segs = _segments_for(conn, video_id)
    direct = [
        {**_tag_row(r), "source": r["source"]} for r in conn.execute('''
            SELECT t.id, t.name, t.color, vt.source FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
            WHERE vt.video_id = ? ORDER BY t.name COLLATE NOCASE
        ''', (video_id,)).fetchall()
    ]
    conn.close()
    return jsonify({"ok": True, "segments": segs, "video_tags": direct})


@app.post("/videos/<vid:video_id>/segments")
def create_segment(video_id):
    body  = request.get_json(silent=True) or {}
    start = _parse_secs(body.get("start_secs"))
    end   = _parse_secs(body.get("end_secs"))
    if start is None or end is None or end <= start:
        return jsonify({"ok": False, "error": "need 0 <= start_secs < end_secs"}), 400
    title = (body.get("title") or "").strip() or None
    names = [n for n in (body.get("tags") or []) if isinstance(n, str) and n.strip()]
    with _db_lock:
        conn = get_conn()
        row = conn.execute("SELECT duration_secs FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"ok": False, "error": "video not found"}), 404
        if row["duration_secs"] and end > row["duration_secs"] + 1:
            end = float(row["duration_secs"])
            if end <= start:
                conn.close()
                return jsonify({"ok": False, "error": "start is past the end of the video"}), 400
        cur = conn.execute(
            "INSERT INTO segments (video_id, start_secs, end_secs, title, source) VALUES (?, ?, ?, ?, 'manual')",
            (video_id, start, end, title),
        )
        seg_id = cur.lastrowid
        for n in names:
            tag = _ensure_tag(conn, n)
            conn.execute("INSERT OR IGNORE INTO segment_tags (segment_id, tag_id, source) VALUES (?, ?, 'manual')",
                         (seg_id, tag["id"]))
        _apply_rules(conn, video_ids=[video_id])
        conn.commit()
        seg = next(s for s in _segments_for(conn, video_id) if s["id"] == seg_id)
        conn.close()
    return jsonify({"ok": True, "segment": seg})


@app.patch("/segments/<int:segment_id>")
def update_segment(segment_id):
    body = request.get_json(silent=True) or {}
    with _db_lock:
        conn = get_conn()
        cur = conn.execute("SELECT * FROM segments WHERE id = ?", (segment_id,)).fetchone()
        if not cur:
            conn.close()
            return jsonify({"ok": False, "error": "not found"}), 404
        start = _parse_secs(body.get("start_secs")) if "start_secs" in body else cur["start_secs"]
        end   = _parse_secs(body.get("end_secs"))   if "end_secs"   in body else cur["end_secs"]
        if start is None or end is None or end <= start:
            conn.close()
            return jsonify({"ok": False, "error": "need 0 <= start_secs < end_secs"}), 400
        title = ((body.get("title") or "").strip() or None) if "title" in body else cur["title"]
        conn.execute("UPDATE segments SET start_secs = ?, end_secs = ?, title = ? WHERE id = ?",
                     (start, end, title, segment_id))
        _apply_rules(conn, video_ids=[cur["video_id"]])   # a renamed segment can now match a rule
        conn.commit()
        seg = next(s for s in _segments_for(conn, cur["video_id"]) if s["id"] == segment_id)
        conn.close()
    return jsonify({"ok": True, "segment": seg})


@app.delete("/segments/<int:segment_id>")
def delete_segment(segment_id):
    with _db_lock:
        conn = get_conn()
        conn.execute("DELETE FROM segment_tags WHERE segment_id = ?", (segment_id,))
        conn.execute("DELETE FROM segments WHERE id = ?", (segment_id,))
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


@app.post("/segments/<int:segment_id>/tags")
def add_segment_tag(segment_id):
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    with _db_lock:
        conn = get_conn()
        if not conn.execute("SELECT 1 FROM segments WHERE id = ?", (segment_id,)).fetchone():
            conn.close()
            return jsonify({"ok": False, "error": "not found"}), 404
        tag = _ensure_tag(conn, name)
        conn.execute("INSERT OR IGNORE INTO segment_tags (segment_id, tag_id, source) VALUES (?, ?, 'manual')",
                     (segment_id, tag["id"]))
        conn.commit()
        conn.close()
    return jsonify({"ok": True, "tag": tag})


@app.delete("/segments/<int:segment_id>/tags/<int:tag_id>")
def remove_segment_tag(segment_id, tag_id):
    with _db_lock:
        conn = get_conn()
        conn.execute("DELETE FROM segment_tags WHERE segment_id = ? AND tag_id = ?", (segment_id, tag_id))
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


@app.post("/videos/<vid:video_id>/tags")
def add_video_tag(video_id):
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    with _db_lock:
        conn = get_conn()
        if not conn.execute("SELECT 1 FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone():
            conn.close()
            return jsonify({"ok": False, "error": "video not found"}), 404
        tag = _ensure_tag(conn, name)
        conn.execute("INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'manual')",
                     (video_id, tag["id"]))
        conn.commit()
        conn.close()
    return jsonify({"ok": True, "tag": tag})


@app.delete("/videos/<vid:video_id>/tags/<int:tag_id>")
def remove_video_tag(video_id, tag_id):
    with _db_lock:
        conn = get_conn()
        conn.execute("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?", (video_id, tag_id))
        conn.commit()
        conn.close()
    return jsonify({"ok": True})


@app.post("/videos/<vid:video_id>/segments/import-chapters")
def import_chapters(video_id):
    """Re-read the file's embedded chapters. Chapter-sourced segments are
    replaced; hand-drawn ones are kept."""
    conn = get_conn()
    row = conn.execute("SELECT file_path FROM downloaded_videos WHERE video_id = ?", (video_id,)).fetchone()
    conn.close()
    path = resolve_media_path(row["file_path"]) if row and row["file_path"] else None
    if not path:
        return jsonify({"ok": False, "error": "file missing on disk"}), 404
    with _db_lock:
        conn = get_conn()
        added = _import_chapters(conn, video_id, path, replace=True)
        if added:
            _apply_rules(conn, video_ids=[video_id])
        conn.commit()
        segs = _segments_for(conn, video_id)
        conn.close()
    return jsonify({"ok": True, "added": added, "segments": segs})


@app.post("/segments/backfill")
def backfill_segments():
    """Import chapters for every video that has no segments yet. Streams
    progress like /scan so the UI can show a running count."""
    conn = get_conn()
    rows = conn.execute('''
        SELECT video_id, file_path FROM downloaded_videos
        WHERE status = 'downloaded' AND file_path IS NOT NULL
          AND video_id NOT IN (SELECT DISTINCT video_id FROM segments)
        ORDER BY downloaded_at DESC
    ''').fetchall()
    conn.close()
    targets = [(r["video_id"], r["file_path"]) for r in rows]

    def generate():
        total = len(targets)
        done = with_chapters = segments = missing = 0
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        for vid, stored in targets:
            path = resolve_media_path(stored)
            if not path:
                missing += 1
            else:
                try:
                    chapters = _chapters_to_import(vid, path)
                    n = 0
                    if chapters:
                        with _db_lock:
                            conn = get_conn()
                            n = _import_chapters(conn, vid, path, replace=False, chapters=chapters)
                            if n:
                                _apply_rules(conn, video_ids=[vid])
                            conn.commit()
                            conn.close()
                    if n:
                        with_chapters += 1
                        segments += n
                except Exception as e:
                    print(f"[segments] backfill failed for {vid}: {e}")
            done += 1
            if done % 10 == 0 or done == total:
                yield f"data: {json.dumps({'type': 'progress', 'done': done, 'total': total, 'with_chapters': with_chapters, 'segments': segments, 'missing': missing})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'total': total, 'with_chapters': with_chapters, 'segments': segments, 'missing': missing})}\n\n"

    return Response(stream_with_context(_stream_in_profile(generate())), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------

@app.route("/shutdown", methods=["POST"])
def shutdown_app():
    """Quit the app from the dashboard.

    Werkzeug removed its shutdown function in 2.1 and the watcher runs in a
    daemon thread, so there is nothing to unwind: exit the process. The timer
    exists only so Flask can flush this response before the interpreter dies.
    os._exit skips atexit handlers, which is safe here because every request
    commits its own SQLite transaction.
    """
    def quit_now():
        with _observer_lock:
            if _observer:
                _observer.stop()
        os._exit(0)

    threading.Timer(0.4, quit_now).start()
    print("[api] Shutdown requested from the dashboard")
    return jsonify({"ok": True})


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
    url = f"http://localhost:{PORT}"
    # Before touching the database: a second launch must leave the running one's alone.
    if _port_busy(PORT):
        print(f"[api] Port {PORT} already in use — ChannelVault may already be running.")
        print(f"[api] Opening {url}")
        webbrowser.open(url)
        sys.exit(1)
    cfg = load_config()
    ensure_data_dir(cfg["data_directory"])
    # One-time migration: copy old backend/videos.db to data_directory if new location is empty
    legacy_db = os.path.join(BASE_DIR, "videos.db")
    new_db    = get_db_path()
    if os.path.exists(legacy_db) and not os.path.exists(new_db):
        _copy_db(legacy_db, new_db)
        print(f"[init] Migrated DB to {new_db}")
    init_db()
    sync_artist_folders()
    watcher_thread = threading.Thread(
        target=start_observer, args=(cfg["watch_directory"],), daemon=True
    )
    watcher_thread.start()
    if "--no-browser" not in sys.argv and os.environ.get("CHANNELVAULT_NO_BROWSER") != "1":
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"[api] ChannelVault {__version__}")
    print(f"[api] Dashboard → {url}")
    print(f"[api] UI files    {STATIC_DIR}")
    print(f"[api] Config      {CONFIG_PATH}")
    print(f"[api] Profile     {cfg['profile_name']} ({cfg['data_directory']})")
    app.run(host="127.0.0.1", port=PORT, debug=False)
