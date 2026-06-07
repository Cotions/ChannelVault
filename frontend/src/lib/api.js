const BASE = "http://localhost:3360";

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function del(path) {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE" });
  return r.json();
}

export function getConfig()          { return get("/config"); }
export function saveConfig(dir)      { return post("/config", { watch_directory: dir }); }
export function saveDataDir(dir)     { return post("/config", { data_directory: dir }); }
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
export function thumbUrl(id)       { return `${BASE}/thumb/${id}`; }
export function streamUrl(id)      { return `${BASE}/stream/${id}`; }
export function getPlaylists()           { return get("/playlists"); }
export function createPlaylist(name)     { return post("/playlists", { name }); }
export function deletePlaylist(id)       { return del(`/playlists/${id}`); }
export function getPlaylist(id)          { return get(`/playlists/${id}`); }
export function addToPlaylist(id, videoId)      { return post(`/playlists/${id}/videos`, { video_id: videoId }); }
export function removeFromPlaylist(id, videoId) { return del(`/playlists/${id}/videos/${videoId}`); }
export function exportCsvUrl()     { return `${BASE}/export/csv`; }
export function exportJsonUrl()    { return `${BASE}/export/json`; }
export function artistThumbUrl(name) { return `${BASE}/artist-thumb/${encodeURIComponent(name)}`; }

export async function scan(onEvent) {
  const r = await fetch(`${BASE}/scan`, { method: "POST" });
  if (!r.ok) throw new Error("Scan failed");
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
