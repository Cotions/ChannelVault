import { useState, useEffect, useRef } from "react";
import { thumbUrl } from "../lib/api";
import { fmt, fmtDuration } from "../lib/fmt";

export default function VideoCard({ video, onDelete, onEdit, layout = "grid" }) {
  const [thumbOk,    setThumbOk]    = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (confirming && confirmRef.current) confirmRef.current.focus();
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    function onKey(e) {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  async function handleDelete() {
    setConfirming(false);
    setDeleting(true);
    try {
      await onDelete(video.video_id);
    } catch {
      setDeleting(false);
    }
  }

  const ytUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
  const dur   = fmtDuration(video.duration_secs);

  return (
    <div className={`video-card${layout === "list" ? " list" : ""}`}>
      <a href={ytUrl} target="_blank" rel="noreferrer" className="video-thumb-link">
        {thumbOk ? (
          <img
            className="video-thumb"
            src={thumbUrl(video.video_id)}
            alt=""
            onError={() => setThumbOk(false)}
          />
        ) : (
          <div className="video-thumb-placeholder">▶</div>
        )}
      </a>
      <div className="video-info">
        <div className="video-title">
          <a href={ytUrl} target="_blank" rel="noreferrer">{video.title || video.video_id}</a>
        </div>
        <div className="video-meta">
          {dur && <span>{dur}</span>}
          {video.view_count != null && <span>{fmt(video.view_count)} views</span>}
          {video.like_count  != null && <span>{fmt(video.like_count)} likes</span>}
        </div>
      </div>
      <div className="video-actions">
        {confirming ? (
          <>
            <span className="del-confirm-label">Delete?</span>
            <button
              ref={confirmRef}
              className="del-btn del-btn-confirm"
              onClick={handleDelete}
              disabled={deleting}
              title="Confirm delete (Enter)"
            >
              ✓
            </button>
            <button
              className="del-btn"
              onClick={() => setConfirming(false)}
              title="Cancel (Esc)"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            {onEdit && (
              <button className="del-btn" title="Edit metadata" onClick={() => onEdit(video)}>
                ✎
              </button>
            )}
            <button
              className="del-btn"
              title="Remove from vault"
              disabled={deleting}
              onClick={() => setConfirming(true)}
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
