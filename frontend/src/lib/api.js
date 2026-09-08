// Dev server runs on a different port, so it needs the absolute backend URL.
// A production build is served by the backend itself, so same-origin is correct
// and the app keeps working on any port.
const BASE = import.meta.env.DEV ? "http://localhost:3360" : "";

// The backend refuses any API request that lacks this header, GET included. A
// hostile page in another tab cannot add a custom header without a CORS
// preflight, which the backend never grants, nor through an <img> or <iframe>.
// Same-origin fetch adds it freely. Media URLs (thumbs, stream, export) are the
// exception: they load via src/href and the backend exempts them.
const CSRF_HEADERS = { "X-ChannelVault": "1" };

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: CSRF_HEADERS });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function patch(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function del(path) {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", headers: CSRF_HEADERS });
  return r.json();
}

export function getConfig()          { return get("/config"); }
export function saveConfig(dir)      { return post("/config", { watch_directory: dir }); }
export function saveDataDir(dir)     { return post("/config", { data_directory: dir }); }
export function saveMediaRoots(roots) { return post("/config", { media_roots: roots }); }
export function browse()             { return get("/browse"); }
export function browseData()         { return get("/browse?title=Select+data+directory"); }
export function browseFile()         { return get("/browse-file"); }
export function readFileTags(path)   { return post("/read-file-tags", { file_path: path }); }
export function getVideos()        { return get("/videos"); }
export function getWanted()        { return get("/wanted"); }
export function getIgnored()       { return get("/ignored"); }
export function deleteVideo(id)    { return del(`/videos/${id}`); }
export function addVideoManual(data) { return post("/videos/manual", data); }
export function fetchMetadata(id)    { return post(`/fetch-metadata/${id}`, {}); }
export function removeMark(id)     { return del(`/mark/${id}`); }
export function getDuplicates()    { return get("/data-quality/duplicates"); }
export function getMissing()       { return get("/data-quality/missing"); }
export function organizePreview(source) {
  return get(`/organize/preview${source ? `?source=${encodeURIComponent(source)}` : ""}`);
}
export function organizeApply({ files, source, mode } = {}) {
  return post("/organize/apply", { files, source, mode });
}
export function importInspect(file)   { return get(`/import/inspect?file=${encodeURIComponent(file)}`); }
export function importThumbUrl(file)  { return `${BASE}/import/thumb?file=${encodeURIComponent(file)}`; }
export function importFetchMeta(file, videoId) { return post("/import/fetch-meta", { file, video_id: videoId }); }
export function importEnrich(file, fields) { return post("/import/enrich", { file, fields }); }
export function thumbUrl(id)       { return `${BASE}/thumb/${id}`; }
export function latestThumbUrl(id) { return `${BASE}/thumb-latest/${id}`; }
export function streamUrl(id)      { return `${BASE}/stream/${id}`; }
export function getPlaylists()           { return get("/playlists"); }
export function createPlaylist(name)     { return post("/playlists", { name }); }
export function deletePlaylist(id)       { return del(`/playlists/${id}`); }
export function getPlaylist(id)          { return get(`/playlists/${id}`); }
export function addToPlaylist(id, videoId)      { return post(`/playlists/${id}/videos`, { video_id: videoId }); }
export function removeFromPlaylist(id, videoId) { return del(`/playlists/${id}/videos/${videoId}`); }
export function postWatchProgress(id, data) { return post(`/watch-progress/${id}`, data); }
export function watchBeacon(id, data) {
  // sendBeacon cannot carry the CSRF header, so use a keepalive fetch: it also
  // survives page unload and lets us attach headers.
  try {
    fetch(`${BASE}/watch-progress/${id}`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
      body: JSON.stringify(data),
    }).catch(() => {});
    return true;
  } catch { return false; }
}
export function getWatchHistory()  { return get("/watch-history"); }
export function exportCsvUrl()     { return `${BASE}/export/csv`; }
export function exportJsonUrl()    { return `${BASE}/export/json`; }
export function artistThumbUrl(name) { return `${BASE}/artist-thumb/${encodeURIComponent(name)}`; }
export function getThumbnails(id)    { return get(`/thumbnails/${id}`); }
export function fetchThumbnail(id, force = false) { return post(`/fetch-thumbnail/${id}`, force ? { force: true } : {}); }
export function thumbnailVersionUrl(id, file) { return `${BASE}/thumbnail-version/${id}/${file}`; }
export function getCreators()      { return get("/creators"); }
export async function getCreator(name) {
  try { return await get(`/creator/${encodeURIComponent(name)}`); }
  catch { return null; }
}

// Tags and segments
export function getTags()                    { return get("/tags"); }
export function createTag(name, color)       { return post("/tags", color ? { name, color } : { name }); }
export function updateTag(id, fields)        { return patch(`/tags/${id}`, fields); }
export function deleteTag(id)                { return del(`/tags/${id}`); }
export function getTagVideos(id)             { return get(`/tags/${id}/videos`); }
export function getTagSegments(id)           { return get(`/tags/${id}/segments`); }
export function addTagRule(id, keyword)      { return post(`/tags/${id}/rules`, { keyword }); }
export function deleteTagRule(id, ruleId)    { return del(`/tags/${id}/rules/${ruleId}`); }
export function applyTagRules()              { return post("/tags/apply-rules", {}); }
export function getSegments(videoId)         { return get(`/videos/${videoId}/segments`); }
export function createSegment(videoId, data) { return post(`/videos/${videoId}/segments`, data); }
export function updateSegment(id, fields)    { return patch(`/segments/${id}`, fields); }
export function deleteSegment(id)            { return del(`/segments/${id}`); }
export function addSegmentTag(id, name)      { return post(`/segments/${id}/tags`, { name }); }
export function removeSegmentTag(id, tagId)  { return del(`/segments/${id}/tags/${tagId}`); }
export function addVideoTag(videoId, name)   { return post(`/videos/${videoId}/tags`, { name }); }
export function removeVideoTag(videoId, tagId) { return del(`/videos/${videoId}/tags/${tagId}`); }
export function importChapters(videoId)      { return post(`/videos/${videoId}/segments/import-chapters`, {}); }
export function backfillSegments(onEvent)    { return stream("/segments/backfill", onEvent); }

export function scan(onEvent) { return stream("/scan", onEvent); }

// Server-sent progress: POST, then hand each `data:` JSON line to onEvent.
export async function stream(path, onEvent) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: CSRF_HEADERS });
  if (!r.ok) throw new Error(`${path} failed`);
  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n\n");
    buf = lines.pop();
    for (const chunk of lines) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch {}
    }
  }
}
