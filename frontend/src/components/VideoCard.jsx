import { useState } from "react";
import { thumbUrl } from "../lib/api";
import { fmt, fmtDuration } from "../lib/fmt";

export default function VideoCard({ video, onDelete }) {
  const [thumbOk, setThumbOk] = useState(true);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.preventDefault();
    setDeleting(true);
    await onDelete(video.video_id);
  }

  const ytUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
  const dur   = fmtDuration(video.duration_secs);

  return (
    <div className="video-card">
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
        <button
          className="del-btn"
          title="Remove from vault"
          disabled={deleting}
          onClick={handleDelete}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
