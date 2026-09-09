# Agent guide: ChannelVault

Orientation for an AI agent working in this repo. Read this before changing code.
It describes what the project *is now*, not what it was originally specced to be.

## What it is

A local-first vault for YouTube videos you downloaded yourself. A Flask backend
indexes the files, a React dashboard browses them, and a Tampermonkey userscript
badges videos on youtube.com that you already have. Everything runs on
`127.0.0.1`; there is no server, no account and no telemetry.

## Layout

```
backend/tracker.py     Everything server-side: schema, API, file watcher, SPA serving
frontend/src/          React 18 + Vite dashboard (built to frontend/dist)
userscript/            The Tampermonkey script
packaging/             PyInstaller spec, desktop entry, icon
run.sh                 Start from source        bundle.sh   Build the single binary
testapp.sh             Second instance on a copy of the DB
docs/db-schema.mmd     Mermaid ER diagram, hand-maintained — update it with the schema
```

`backend/tracker.py` is one large file on purpose. Do not split it without being
asked; the bundle spec and the release stamping both target that path.

## Non-negotiables

**Security model.** Every API request must carry the header `X-ChannelVault`,
GET included. A `before_request` guard denies by default and also checks the
`Host` header against localhost. No CORS headers are ever sent.

- A new route is protected automatically. Do nothing.
- Only add a view function name to `_PUBLIC_ENDPOINTS` if a browser must load it
  by URL alone: `<img>`, `<video>`, `<a download>`. Media routes must stay GET
  and header-free for exactly that reason.
- Any new client, curl test or CI check has to send the header.
- Never re-enable `flask-cors`. See `SECURITY.md`.

**Video ids** are 11 URL-safe characters, enforced by the `vid` route converter
and `_valid_video_id` for body fields. That is what keeps `..` out of the
`os.path.join` calls that build thumbnail paths.

**Foreign keys are off** in SQLite here. Cascades are written by hand; follow
`delete_video` and `delete_tag` when adding a table that references another.

**Never test against the live database.** Use `./testapp.sh` (port 3399). It
copies the data directory, uses its own config file, and runs under bubblewrap
with the media folders and live database mounted read-only. The user's library is
1200+ real videos and `/organize/apply` and `/import/enrich` move and overwrite
files.

## Data model

`downloaded_videos` is the spine, keyed by `video_id`. `status` is
`downloaded | wanted | ignored`; `availability` records why a video can no longer
be fetched. Around it: `playlists` + `playlist_items`, `watch_sessions`,
`creators` (an About-panel snapshot keyed by channel name).

Then the tagging pair, which people mix up:

- **A segment** is a slice of time inside one video: start, end, optional title.
  `source` is `chapter` (read from the file) or `manual`.
- **A tag** is a word the user invents. It exists once, library-wide, with a
  colour and optional keyword rules.

A tag attaches to a segment (`segment_tags`) or to a whole video (`video_tags`),
many-to-many. Each link records `source`, `manual` or `rule`, so a keyword rule
never silently overwrites a human decision. Deleting a tag leaves the segments;
deleting a segment leaves the tag.

Migrations follow the existing style: `CREATE TABLE IF NOT EXISTS`, then column
adds guarded by a single `PRAGMA table_info` read. There is no version table.

## How the pieces behave

**Metadata** comes from the file itself. TinyTag first, `ffprobe -show_format` as
a fallback, because TinyTag cannot parse Matroska and much of a real library is
webm. The YouTube URL lives in the `comment` or `purl` tag and the id is regexed
out of it. Any new metadata path must use both readers.

**Chapters** are read separately, with `ffprobe -show_chapters`, because mp4
files take the TinyTag path and never reach the format probe, yet they are
exactly the files carrying chapters. A video imports its chapters once; a rescan
leaves a video that already has segments alone, so user edits survive.

**Keyword rules** match segment and video titles case-insensitively and only ever
add. A tag the user removed by hand stays removed until they apply rules again.

**The player** never unmounts. A single `<video>` lives in a fixed shell that is
positioned over a placeholder on the video page by a requestAnimationFrame loop,
so navigation cannot pause it. The provider exposes the element plus
`seek`/`play`/`pause`. Live playback position deliberately stays *out* of context
state, since the provider wraps the whole app; `usePlaybackTime` subscribes to the
element from the one page that needs it.

**Segment play mode** is a queue in the provider. Advancing is watched from the
existing time-update handler. Opening another video by hand ends the queue; the
queue moving itself does not, which a short-lived flag distinguishes.

## Frontend conventions

One global stylesheet, `frontend/src/index.css`, in comment-delimited sections.
No CSS modules. Class prefixes by area: `vp-` video page, `seg-` segments, `tag-`
tags, `cv-` player shell. The palette lives in custom properties at the top;
glow effects are written as literal `rgba(74, 222, 128, …)` to match what is
already there.

State is flat `useState` per concern, no store and no react-query. `App.jsx` owns
the collections and passes them down; a mutation calls its handler and refetches.
Modals follow `AddVideoModal`; destructive actions use the two-step inline
confirm from `VideoCard`, with Escape to cancel.

Every API call goes through `frontend/src/lib/api.js`, which attaches the
security header. Do not call `fetch` against the backend from a component.

## Working here

```bash
./run.sh                       # build UI if stale, start on 3360
./testapp.sh                   # test instance on 3399, copied DB, media read-only
cd frontend && bun run lint    # must be clean of errors; warnings are tolerated
cd frontend && bun run build
./bundle.sh --install          # rebuild the binary the user actually runs
```

`./run.sh --dev` is UI-only: Vite on 5173 is cross-origin and the backend refuses
it. That is intentional. If dev data is ever needed, add a Vite `server.proxy`
rather than weakening the guard.

The backend has no auto-reload. After editing `tracker.py`, restart it or new
routes keep returning 404.

CI builds the binary and runs a smoke test that asserts the security guard: 403
without the header, 403 on a forged Host, 404 on malformed ids, and no CORS
headers. Add a check there when you add a route worth protecting.

## Style

Match the surrounding code. Comments explain *why*, especially where something
looks odd, since most of the oddities here are load-bearing. Commit messages are
plain prose in the imperative, explaining the reason for the change, with no
emoji and no bullet lists of files.

Keep the project domain-neutral. Whatever a given user's library contains, the
code, UI copy, docs and commits use generic examples: "intro", "interview",
"outro".
