# ChannelVault

[![CI](https://github.com/Cotions/ChannelVault/actions/workflows/ci.yml/badge.svg)](https://github.com/Cotions/ChannelVault/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Cotions/ChannelVault?sort=semver)](https://github.com/Cotions/ChannelVault/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Tracks locally downloaded YouTube videos. Shows a green badge on YouTube pages for videos you already have. Dashboard at `localhost:3360`.

---

## How it works

1. **Backend** — Flask server scans your download folder, reads metadata from `.mp4`/`.mkv` files, stores it in SQLite, and watches for new downloads in real time.
2. **Userscript** — Runs in your browser via Tampermonkey. Calls the backend to show a badge on YouTube video pages and cards.

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
├── bundle.sh            # Build the single-file executable
├── packaging/
│   ├── channelvault.spec        # PyInstaller bundle definition
│   ├── ChannelVault.desktop     # App menu entry template
│   └── channelvault.svg         # Icon
├── backend/
│   ├── tracker.py       # Flask API + file watcher + SPA serving
│   ├── start.sh         # Compatibility shim → run.sh
│   └── requirements.txt
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

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/config` | Get watch directory |
| POST | `/config` | Set watch directory |
| GET | `/browse` | Open folder picker dialog |
| POST | `/scan` | Scan watch folder recursively |
| GET | `/videos` | List all tracked videos |
| GET | `/videos/ids` | List video IDs only |
| DELETE | `/videos/<id>` | Remove from vault |
| GET | `/check-video/<id>` | Check if video is tracked |
| POST | `/update-stats/<id>` | Update view/like counts |
