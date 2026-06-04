import { useState } from "react";
import { addVideoManual } from "../lib/api";

const EMPTY = {
  video_id: "", title: "", channel_name: "", url: "",
  file_path: "", recorded_date: "", genre: "", description: "",
};

export default function AddVideoModal({ onClose, onAdded }) {
  const [form, setForm]   = useState(EMPTY);
  const [err,  setErr]    = useState(null);
  const [busy, setBusy]   = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.video_id.trim()) { setErr("Video ID is required."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await addVideoManual(form);
      if (res.ok) { onAdded(); onClose(); }
      else setErr(res.error || "Failed to add video.");
    } catch {
      setErr("Request failed — is the backend running?");
    }
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Add Video Manually</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            YouTube Video ID <span className="required">*</span>
            <input
              type="text"
              placeholder="dQw4w9WgXcQ"
              value={form.video_id}
              onChange={e => set("video_id", e.target.value)}
              autoFocus
            />
            <span className="field-hint">The 11-char ID from the YouTube URL</span>
          </label>

          <label>
            Title
            <input type="text" placeholder="Video title" value={form.title} onChange={e => set("title", e.target.value)} />
          </label>

          <label>
            Channel / Artist
            <input type="text" placeholder="Channel name" value={form.channel_name} onChange={e => set("channel_name", e.target.value)} />
          </label>

          <label>
            YouTube URL
            <input type="text" placeholder="https://www.youtube.com/watch?v=…" value={form.url} onChange={e => set("url", e.target.value)} />
            <span className="field-hint">Leave blank to auto-build from Video ID</span>
          </label>

          <label>
            Local File Path
            <input type="text" placeholder="/home/user/Downloads/video.mp4" value={form.file_path} onChange={e => set("file_path", e.target.value)} />
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
              {busy ? "Saving…" : "Add Video"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
