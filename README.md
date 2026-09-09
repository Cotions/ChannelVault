# ChannelVault

[![CI](https://github.com/Cotions/ChannelVault/actions/workflows/ci.yml/badge.svg)](https://github.com/Cotions/ChannelVault/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Cotions/ChannelVault?sort=semver)](https://github.com/Cotions/ChannelVault/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Tracks locally downloaded YouTube videos. Shows a green badge on YouTube pages for videos you already have. Tag whole videos or individual parts of them, then play only the parts you tagged. Dashboard at `localhost:3360`.

---

## How it works

1. **Backend** — Flask server scans your download folder, reads metadata from `.mp4`/`.mkv` files, stores it in SQLite, and watches for new downloads in real time.
2. **Dashboard** — React UI to browse, play, tag and organise the library.
3. **Userscript** — Runs in your browser via Tampermonkey. Calls the backend to show a badge on YouTube video pages and cards.

---

## Requirements

- Python 3.10+ (only needed to build; the bundled binary carries its own)
- [bun](https://bun.sh/) or npm (to build the UI)
- `zenity` (folder picker dialogs)
- [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Firefox/Edge)
- Videos downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp) (embeds YouTube URL in file metadata)

---

## 1 — Start it

### Download a release (no build, nothing to install)

Linux x86_64:

```bash
curl -L -o channelvault \
  https://github.com/Cotions/ChannelVault/releases/latest/download/channelvault-linux-x86_64
chmod +x channelvault
./channelvault
```

One file, ~19 MB. It carries its own Python runtime, the backend and the dashboard, and opens `http://localhost:3360` on start. Install `zenity` for the folder-picker buttons (`sudo apt install zenity`).

### One click, from source

```bash
./run.sh
```

Builds the UI if it is stale, sets up the virtualenv, starts the backend, opens the browser. Double-clicking `run.sh` in a file manager opens a terminal for you.

| Command | What it does |
|---------|--------------|
| `./run.sh` | Build if needed, start, open browser |
| `./run.sh --dev` | Vite dev server with hot reload + backend. UI only: the backend rejects cross-origin API calls, so data will not load. Use `--build` to test against real data |
| `./run.sh --build` | Force a UI rebuild, then start |
| `./run.sh --install-launcher` | Add "ChannelVault (source)" to the app menu |
| `./testapp.sh` | Second instance on a **copy** of your database, port 3399 |

### Trying things without risking your library

`./testapp.sh` starts a throwaway instance that shares your videos but not your
database. It copies your data directory once, writes its own config file that the
live app never reads, and runs inside a bubblewrap sandbox where your media folders
and your live database are mounted read-only. Reading and streaming work normally;
a write to a real file fails at the kernel with `Read-only file system`.

```bash
./testapp.sh            # start it (copies the database on first run)
./testapp.sh --status   # show what exists and where
./testapp.sh --reset    # throw the copy away, take a fresh one
```

Both apps can run at once: live on 3360, test on 3399.

### One file, bundled

```bash
./bundle.sh            # → ./dist/channelvault  (~19 MB, no Python needed)
./bundle.sh --install  # → ~/.local/bin + app menu entry with icon
./bundle.sh --uninstall
```

The binary embeds the Flask backend, the built React UI and the userscript. Launch it from the app menu or run `channelvault`; it opens `http://localhost:3360` by itself.

Where things live:

| Thing | Path |
|-------|------|
| Config (bundled binary) | `~/.config/channelvault/config.json` |
| Config (from source) | `backend/config.json` |
| Database + artist thumbs | whatever `data_directory` points at |

Environment overrides: `CHANNELVAULT_PORT`, `CHANNELVAULT_CONFIG`, `CHANNELVAULT_NO_BROWSER=1`. Pass `--no-browser` to keep it from opening a tab.

To point a run at throwaway data instead of your real media:

```bash
CHANNELVAULT_CONFIG=/tmp/cv.json CHANNELVAULT_PORT=3399 ./run.sh
```

---

## 2 — Set watch folder

Open the dashboard, click **Browse…**, select your downloads folder, then click **Save**.

Click **Scan Now** to index existing files. The watcher picks up new downloads automatically (including subfolders).

---

## 3 — Userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open this URL to install the script:

```
https://raw.githubusercontent.com/Cotions/ChannelVault/master/userscript/channelvault.user.js
```

3. Allow `localhost` connections when Tampermonkey prompts.

The badge appears automatically on YouTube video pages and card thumbnails for any video in your vault.

---

## 4 — Tags and segments

Two different things, used together.

- A **segment** is a slice of one video: a start, an end and an optional title.
- A **tag** is a word you invent. It exists once for the whole library, has a colour, and can be attached to a segment or to a whole video.

One segment can carry several tags, and one tag can sit on hundreds of segments across hundreds of videos. Deleting a tag leaves the segments alone; deleting a segment leaves the tag alone.

### Segments arrive on their own

Videos downloaded with chapters already have them embedded. ChannelVault reads those with `ffprobe` and turns each one into a segment, so most of the work is done before you touch anything. On the **Tags** page, **Import chapters** does this for every video that has none yet.

A rescan never overwrites a video that already has segments, so your edits are safe. **Re-import chapters** on a video page refreshes the ones that came from the file and keeps the ones you drew by hand.

### Marking a part yourself

On any video page, the bar under the player shows every segment as a block, stacked into lanes when they overlap. Click a block to jump there. Below it, **New segment** opens a form where the **now** buttons copy the current playback position, so you can mark a range while watching.

### Keyword rules

Give a tag some keywords and any chapter or video title containing one gets that tag, on import and whenever you press **Apply rules**. Rules only ever add, so a tag you removed by hand stays removed until you apply them again.

### Playing only what you tagged

This is the point of the whole thing. Open a tag and press **Play segments**: the player runs every stretch carrying that tag, one after another, switching video files by itself. Shuffle, loop, skip forward and back. It keeps going in the mini player while you browse, so you never have to hunt for the good parts again.

You can also filter the home grid by tag chips, search by tag name, and jump straight to a timestamp from a tag's page.

---

## yt-dlp tip

Use this flag so metadata is embedded and ChannelVault can read it:

```bash
yt-dlp --embed-metadata -o "~/Downloads/%(title)s.%(ext)s" <URL>
```

---

## Folder structure

```
ChannelVault/
├── run.sh               # One-click start from source
├── testapp.sh           # Test instance: copied database, real videos read-only
├── bundle.sh            # Build the single-file executable
├── agents/agent.md      # Orientation for AI coding agents
├── SECURITY.md          # Threat model and how to report an issue
├── packaging/
│   ├── channelvault.spec        # PyInstaller bundle definition
│   ├── ChannelVault.desktop     # App menu entry template
│   └── channelvault.svg         # Icon
├── backend/
│   ├── tracker.py       # Flask API + file watcher + SPA serving
│   ├── start.sh         # Compatibility shim → run.sh
│   └── requirements.txt
├── docs/db-schema.mmd   # Database diagram
├── frontend/            # React + Vite dashboard (built into frontend/dist)
└── userscript/
    └── channelvault.user.js
```

---

## Building and releasing

| Command | What it does |
|---------|--------------|
| `./bundle.sh` | Build `dist/channelvault` locally |
| `./release.sh v0.1.0` | Tag and push; CI builds and publishes the release |

CI (`.github/workflows/ci.yml`) lints the UI, builds the bundle and smoke-tests the running binary on every push and PR. Tagging `v*` triggers `release.yml`, which stamps the version into the binary, builds on Ubuntu 22.04 (low glibc floor, so it runs on older distros) and attaches the binary, a `.tar.gz` and `SHA256SUMS.txt` to the GitHub release.

Every release also carries a build provenance attestation. To prove a download came out of this repository's CI rather than somewhere else:

```bash
gh attestation verify channelvault-linux-x86_64 --repo Cotions/ChannelVault
```

Python dependencies and GitHub Actions are pinned exactly, so a rebuild of the same tag yields the same inputs. See [SECURITY.md](SECURITY.md) for the threat model and how to report an issue.

Only Linux x86_64 is built today. macOS and Windows would each need their own runner in `release.yml`; the code has no Linux-only assumptions apart from `zenity` folder pickers and the terminal-relaunch logic in `run.sh`.

---

## License

MIT — see [LICENSE](LICENSE).

---

## API endpoints

Every API call must send the header `X-ChannelVault: 1`, GET included, or the server answers 403. That is what keeps a random web page in another tab from driving your vault: a cross-origin page cannot attach a custom header. The dashboard and the userscript add it for you. Only the SPA pages, `/assets`, the userscript file, media routes loaded into `<img>`/`<video>` (`/thumb*`, `/stream`, `/artist-thumb`, `/thumbnail-version`, `/import/thumb`) and the `/export/*` downloads are reachable by URL alone.

```bash
curl -H 'X-ChannelVault: 1' http://localhost:3360/videos
```

Video ids must be the 11 character YouTube shape; anything else is a 404.

**Library**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/videos` | Every tracked video, each with its tags |
| GET | `/videos/ids` | Ids only, split into downloaded / wanted / ignored (the userscript uses this) |
| GET | `/check-video/<id>` | Is this video in the vault? |
| POST | `/videos/manual` | Add a video by id or URL, no file needed |
| DELETE | `/videos/<id>` | Remove from the vault |
| POST | `/update-stats/<id>` | Store view and like counts |
| POST | `/fetch-metadata/<id>` | Refresh title, stats and availability from YouTube |
| GET | `/stream/<id>` | Stream the file, with range requests |
| GET | `/export/json`, `/export/csv` | Download the whole library, tags and segments included |

**Wishlist**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/want-to-download` | Mark a video you want |
| POST | `/do-not-want` | Mark a video to ignore |
| GET | `/wanted`, `/ignored` | List either set |
| DELETE | `/mark/<id>` | Clear a mark |

**Tags and segments**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tags` | Tags with video and segment counts, and their keyword rules |
| POST | `/tags` | Create a tag; returns the existing one if the name is taken |
| PATCH | `/tags/<id>` | Rename or recolour |
| DELETE | `/tags/<id>` | Delete it; segments stay, just untagged |
| GET | `/tags/<id>/videos` | Videos carrying the tag, with the matching segments |
| GET | `/tags/<id>/segments` | Flat play queue for the tag, across the library |
| POST | `/tags/<id>/rules` | Add a keyword rule |
| DELETE | `/tags/<id>/rules/<rule_id>` | Remove a keyword rule |
| POST | `/tags/apply-rules` | Run every rule over the library; only ever adds |
| GET | `/videos/<id>/segments` | Segments of one video, plus the tags on the video itself |
| POST | `/videos/<id>/segments` | Create a segment |
| PATCH | `/segments/<id>` | Change its times or title |
| DELETE | `/segments/<id>` | Delete a segment |
| POST | `/segments/<id>/tags` | Tag a segment, creating the tag if it is new |
| DELETE | `/segments/<id>/tags/<tag_id>` | Untag a segment |
| POST | `/videos/<id>/tags` | Tag a whole video |
| DELETE | `/videos/<id>/tags/<tag_id>` | Untag a whole video |
| POST | `/videos/<id>/segments/import-chapters` | Re-read the file's chapters, keeping manual segments |
| POST | `/segments/backfill` | Import chapters library-wide, streaming progress |

**Playlists**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/playlists` | All playlists with their counts |
| POST | `/playlists` | Create one |
| GET | `/playlists/<id>` | One playlist and its videos |
| DELETE | `/playlists/<id>` | Delete it |
| POST | `/playlists/<id>/videos` | Add a video |
| DELETE | `/playlists/<id>/videos/<video_id>` | Remove a video |

**Watch history**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/watch-progress/<id>` | Report playback progress; opens or updates a session |
| GET | `/watch-history` | Completed sessions, newest first |
| DELETE | `/watch-history/<id>` | Forget a video's history |

**Thumbnails**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/thumb/<id>` | Original thumbnail |
| GET | `/thumb-latest/<id>` | Newest fetched thumbnail, else the original |
| GET | `/thumbnails/<id>` | List every version held |
| GET | `/thumbnail-version/<id>/<file>` | One specific version |
| POST | `/fetch-thumbnail/<id>` | Fetch from YouTube, with duplicate detection |
| GET | `/artist-thumb/<name>` | A channel's avatar |

**Creators**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/creator` | Save an About-panel snapshot (the userscript posts this) |
| GET | `/creators` | Every stored profile |
| GET | `/creator/<name>` | One profile |

**Files, importing and housekeeping**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | Current watch folder, data folder and media roots |
| POST | `/config` | Change any of them |
| POST | `/scan` | Index the watch folder, streaming progress |
| GET | `/browse`, `/browse-file` | Native folder and file pickers (needs `zenity`) |
| POST | `/read-file-tags` | Read one file's embedded metadata |
| GET | `/data-quality/duplicates` | Files sharing a video id |
| GET | `/data-quality/missing` | Rows whose file no longer resolves |
| GET | `/organize/preview` | What tidying would do, before it does it |
| POST | `/organize/apply` | Move or copy files into per-artist folders |
| GET | `/import/inspect` | Look at a file before importing it |
| GET | `/import/thumb` | Its sidecar thumbnail |
| POST | `/import/fetch-meta` | Suggest metadata from YouTube, writing nothing |
| POST | `/import/enrich` | Write tags into the file itself with ffmpeg |
| GET | `/userscript/channelvault.user.js` | The userscript, always fresh |
