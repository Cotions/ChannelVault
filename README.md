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
| `./run.sh --dev` | Vite dev server with hot reload + backend |
| `./run.sh --build` | Force a UI rebuild, then start |
| `./run.sh --install-launcher` | Add "ChannelVault (source)" to the app menu |

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

Only Linux x86_64 is built today. macOS and Windows would each need their own runner in `release.yml`; the code has no Linux-only assumptions apart from `zenity` folder pickers and the terminal-relaunch logic in `run.sh`.

---

## License

MIT — see [LICENSE](LICENSE).

---

## API endpoints

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
