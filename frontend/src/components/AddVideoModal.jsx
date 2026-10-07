import { useState } from "react";
import { addVideoManual, browseFile, fetchMetadata, readFileTags } from "../lib/api";
import Icon from "./Icon";
import { isYouTube } from "../lib/source";

function extractVideoId(input) {
  const s = input.trim();
  // youtu.be/ID  or  youtu.be/ID?t=...
  let m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // ?v=ID  (watch, music.youtube.com, m.youtube.com, all carry v=)
  m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // /shorts/ID  /embed/ID  /v/ID  (youtube.com and youtube-nocookie.com)
  m = s.match(/\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // raw 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}

export default function AddVideoModal({ onClose, onAdded, initialVideo = null }) {
  const isEdit = !!initialVideo;
  // Editing a Twitch VOD / local file: the link is just a link, no fetching.
  const editingOther = isEdit && !isYouTube(initialVideo);
  const ytUrlOf = v => (isYouTube(v) ? `https://www.youtube.com/watch?v=${v.video_id}` : "");

  const [urlInput, setUrlInput] = useState(
    initialVideo ? (initialVideo.url || ytUrlOf(initialVideo)) : ""
  );
  const [form, setForm] = useState(
    initialVideo
      ? {
          video_id:     initialVideo.video_id     || "",
          title:        initialVideo.title         || "",
          channel_name: initialVideo.channel_name  || "",
          url:          initialVideo.url           || ytUrlOf(initialVideo),
          file_path:    initialVideo.file_path     || "",
          recorded_date:initialVideo.recorded_date || "",
          genre:        initialVideo.genre         || "",
          description:  initialVideo.description   || "",
        }
      : { video_id: "", title: "", channel_name: "", url: "", file_path: "", recorded_date: "", genre: "", description: "" }
  );
  const [fetchStatus, setFetchStatus] = useState(isEdit ? null : null);
  const [err,  setErr]  = useState(null);
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function fetchMeta(input) {
    if (editingOther) return;
    const id = extractVideoId(input || urlInput);
    // Another site's link: nothing to fetch, the fields are filled in by hand.
    if (!id) { setFetchStatus(/^https?:\/\//i.test((input || urlInput).trim()) ? "other" : "err"); return; }

    setFetchStatus("loading");
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setForm(f => ({
        ...f,
        video_id:     id,
        url:          `https://www.youtube.com/watch?v=${id}`,
        title:        data.title       || f.title,
        channel_name: data.author_name || f.channel_name,
      }));
      setFetchStatus("ok");
    } catch {
      setForm(f => ({
        ...f,
        video_id: id,
        url:      f.url || `https://www.youtube.com/watch?v=${id}`,
      }));
      setFetchStatus("err");
    }
  }

  async function applyFileTags(path) {
    try {
      const data = await readFileTags(path);
      if (!data.ok) return;
      setForm(f => ({
        ...f,
        video_id:     data.video_id     || f.video_id,
        title:        data.title        || f.title,
        channel_name: data.channel_name || f.channel_name,
        url:          data.url          || f.url,
        genre:        data.genre        || f.genre,
        description:  data.description  || f.description,
        recorded_date:data.recorded_date|| f.recorded_date,
      }));
      if (data.url) {
        setUrlInput(data.url);
        setFetchStatus(data.source === "youtube" ? "ok" : "other");
      }
    } catch {}
  }

  function handleUrlBlur() {
    if (urlInput.trim() && fetchStatus !== "ok" && fetchStatus !== "other") fetchMeta();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // A YouTube id is fetched into form.video_id; anything else is sent as a plain
    // link (or nothing, for a local file) and the server mints the entry's id.
    const ytId    = isEdit ? null : extractVideoId(urlInput);
    const link    = urlInput.trim();
    const payload = isEdit
      ? { ...form, url: editingOther ? link : form.url }
      : ytId
        ? { ...form, video_id: ytId, url: form.url || `https://www.youtube.com/watch?v=${ytId}` }
        : { ...form, video_id: "", url: link };
    if (!payload.video_id && !payload.url && !payload.file_path.trim()) {
      setErr("Paste a video link, or pick the local file.");
      return;
    }
    if (!isEdit && !ytId && link && !/^https?:\/\//i.test(link)) {
      setErr("That's not a YouTube id or a link (https://…).");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await addVideoManual(payload);
      if (res.ok) {
        onClose();
        // An edit keeps what was typed: a fetch would put YouTube's title back.
        if (isEdit || (res.source && res.source !== "youtube")) onAdded();
        else fetchMetadata(res.video_id).then(() => onAdded()).catch(() => onAdded());
      } else {
        setErr(res.error || "Failed to save video.");
        setBusy(false);
      }
    } catch {
      setErr("Request failed — is the backend running?");
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? "Edit Video Metadata" : "Add Video Manually"}</span>
          <button className="modal-close" onClick={onClose}><Icon name="close" /></button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>

          <label>
            {isEdit ? (editingOther ? "Video link" : "YouTube URL") : <>YouTube URL or Video ID <span className="required">*</span></>}
            <div className="fetch-row">
              <input
                type="text"
                placeholder={editingOther ? "https://… (optional)" : "https://www.youtube.com/watch?v=… or video ID"}
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setFetchStatus(null); }}
                onBlur={handleUrlBlur}
                onPaste={e => {
                  const pasted = e.clipboardData.getData("text");
                  setUrlInput(pasted);
                  setFetchStatus(null);
                  setTimeout(() => fetchMeta(pasted), 0);
                  e.preventDefault();
                }}
                autoFocus={!isEdit}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fetchMeta()}
                disabled={editingOther || fetchStatus === "loading" || !urlInput.trim()}
              >
                {fetchStatus === "loading" ? "…" : "Fetch"}
              </button>
            </div>
            {fetchStatus === "ok"  && <span className="field-hint" style={{color:"#81c784"}}>Metadata fetched</span>}
            {fetchStatus === "err" && <span className="field-hint" style={{color:"#ef9a9a"}}>Could not fetch — edit fields manually</span>}
            {fetchStatus === "other" && <span className="field-hint">Not a YouTube link — saved as-is; fill in title and artist, and pick the file</span>}
            {!fetchStatus          && <span className="field-hint">{
              editingOther ? "Where this video lives online, if anywhere"
                : isEdit ? "Fetch to refresh metadata from YouTube"
                : "Paste a URL or ID — metadata will auto-fill. Not on YouTube? Paste its link, or leave empty and pick the file"
            }</span>}
          </label>

          <label>
            Title
            <input type="text" placeholder="Video title" value={form.title} onChange={e => set("title", e.target.value)} autoFocus={isEdit} />
          </label>

          <label>
            Channel / Artist
            <input type="text" placeholder="Channel name" value={form.channel_name} onChange={e => set("channel_name", e.target.value)} />
          </label>

          <label>
            Local File Path
            <div className="fetch-row">
              <input
                type="text"
                placeholder="/home/user/Downloads/video.mp4"
                value={form.file_path}
                onChange={e => set("file_path", e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  try {
                    const data = await browseFile();
                    if (data.ok && data.file) {
                      set("file_path", data.file);
                      applyFileTags(data.file);
                    }
                  } catch {}
                }}
              >
                Browse…
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!form.file_path.trim()}
                onClick={() => applyFileTags(form.file_path)}
                title="Read metadata from file tags"
              >
                Read Tags
              </button>
            </div>
          </label>

          <div className="modal-row">
            <label>
              Year / Date
              <input type="text" placeholder="2024" value={form.recorded_date} onChange={e => set("recorded_date", e.target.value)} />
            </label>
            <label>
              Genre
              <input type="text" placeholder="Music" value={form.genre} onChange={e => set("genre", e.target.value)} />
            </label>
          </div>

          <label>
            Description
            <textarea
              rows={3}
              placeholder="Optional description…"
              value={form.description}
              onChange={e => set("description", e.target.value)}
            />
          </label>

          {err && <div className="msg show err">{err}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save Changes" : "Add Video"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
