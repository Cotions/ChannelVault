# ChannelVault

Tracks locally downloaded YouTube videos. Shows a green badge on YouTube pages for videos you already have. Dashboard at `localhost:3360`.

---

## How it works

1. **Backend** — Flask server scans your download folder, reads metadata from `.mp4`/`.mkv` files, stores it in SQLite, and watches for new downloads in real time.
2. **Userscript** — Runs in your browser via Tampermonkey. Calls the backend to show a badge on YouTube video pages and cards.

---

## Requirements

- Python 3.10+
- [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Firefox/Edge)
- Videos downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp) (embeds YouTube URL in file metadata)

---

## 1 — Backend

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

**Start:**

```bash
bash start.sh
```

Double-clicking `start.sh` in your file manager opens a terminal automatically.

Dashboard: [http://localhost:3360](http://localhost:3360)

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
├── backend/
│   ├── tracker.py       # Flask API + file watcher
│   ├── start.sh         # Start script (opens terminal if double-clicked)
│   ├── requirements.txt
│   ├── static/
│   │   └── index.html   # Dashboard UI
│   └── videos.db        # SQLite database (auto-created)
├── userscript/
│   └── channelvault.user.js
└── extension/           # Browser extension (alternative to userscript)
```

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
