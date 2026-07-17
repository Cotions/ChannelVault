# Agent Instructions: Project "ChannelVault"

## 1. Project Overview & Goal
The objective is to build ChannelVault, a local-first application and browser extension that automatically tracks downloaded YouTube videos. 

The user utilizes Open Video Downloader (OVD) to download videos into a local directory on a Linux machine (/home/cotions/Downloads). OVD embeds YouTube metadata natively into the MP4 container. ChannelVault captures this data locally and displays download statuses directly inside the user's desktop web browser via an extension overlay.

---

## 2. System Architecture (Monorepo)

channelvault/
├── agent.md             # This instruction file
├── backend/             # Python Local Service
│   ├── tracker.py       # File watcher, DB manager, and API server
│   ├── requirements.txt # Python dependencies
│   └── videos.db        # SQLite database (auto-generated)
└── extension/           # Browser Extension (Manifest V3)
    ├── manifest.json    # Extension configuration
    ├── content.js       # YouTube DOM manipulation & status checking
    └── icons/           # UI Assets

---

## 3. Data & Metadata Specifications
When a video is parsed, the agent must extract metadata fields mapped from the internal MP4 container tags (written by OVD/Lavf):

* Movie name (TinyTag: tag.title) -> Video Title
* Performer (TinyTag: tag.artist) -> YouTube Channel Name
* Comment (TinyTag: tag.comment) -> YouTube Source URL (e.g., https://www.youtube.com/watch?v=VIDEO_ID)

### Extraction Logic:
The unique YouTube Video ID must be extracted cleanly from the Comment URL string using the following regex pattern: v=([a-zA-Z0-9_-]{11}). This Video ID serves as the PRIMARY KEY in the database.

---

## 4. Component Technical Specifications

### Phase 1: Python Backend (backend/)
* File Watching: Use watchdog to monitor /home/cotions/Downloads. Filter for newly created .mp4 files. Implement a 2-second sleep buffer to let OVD complete disk-writing operations before parsing.
* Metadata Parsing: Use tinytag to natively read the internal container attributes (title, artist, comment).
* Database: Local SQLite database (videos.db).
  
  CREATE TABLE IF NOT EXISTS downloaded_videos (
      video_id TEXT PRIMARY KEY,
      title TEXT,
      channel_name TEXT,
      url TEXT,
      file_path TEXT,
      downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

* API Server: Run a lightweight local server (using Flask or FastAPI) on http://localhost:5000. 
  * Endpoint: GET /check-video/<video_id>
  * Response: {"downloaded": true} or {"downloaded": false}
  * CORS: Must have Cross-Origin Resource Sharing (CORS) enabled to allow requests from the browser extension context.

### Phase 2: Browser Extension (extension/)
* Manifest version: Manifest V3.
* Permissions: activeTab, hostPermissions for https://*.youtube.com/*.
* Content Script (content.js):
  1. Runs automatically on https://www.youtube.com/watch?v=*.
  2. Extracts the ?v= parameter from the window location URL.
  3. Fires an asynchronous fetch request to http://localhost:5000/check-video/<video_id>.
  4. If the video is flagged as downloaded: true, dynamically injects a visible visual indicator (e.g., a green badge or checkmark label) near the YouTube video title element on the web page.

---

## 5. Coding Instructions for the Agent
1. Step 1: Initialize the directory structure. Create backend/requirements.txt containing watchdog, tinytag, and your API framework of choice (e.g., flask or fastapi + uvicorn).
2. Step 2: Write backend/tracker.py including both the background file system watcher and the web API server loops. Ensure database initialization runs automatically on startup.
3. Step 3: Write extension/manifest.json ensuring match patterns target YouTube explicitly.
4. Step 4: Write extension/content.js handling DOM monitoring/mutation to safely append the download indicator without breaking YouTube's interface dynamics.