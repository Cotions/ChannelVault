import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { streamUrl, thumbUrl, artistThumbUrl } from "../lib/api";
import { fmt, fmtBytes, fmtDuration } from "../lib/fmt";

export default function VideoPage({ videos, onEdit, onFetchMeta, onDelete }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [playErr,    setPlayErr]    = useState(false);
  const [fetching,   setFetching]   = useState(false);
  const [elapsed,    setElapsed]    = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  useEffect(() => {
    if (!confirming) return;
    function onKey(e) {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  useEffect(() => {
    if (!fetching) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(t);
  }, [fetching]);

  const video = videos.find(v => v.video_id === id);

  if (!video) {
    return (
      <div className="card">
        <div className="artist-page-header">
          <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
          <h2 className="artist-page-title">Video</h2>
        </div>
        <div className="empty">{videos.length === 0 ? "Loading…" : "Video not found in vault."}</div>
      </div>
    );
  }

  const ytUrl  = `https://www.youtube.com/watch?v=${video.video_id}`;
  const artist = video.channel_name || "Unknown";

  async function handleFetchMeta() {
    setFetching(true);
    try { await onFetchMeta(video.video_id); } catch {} finally {
      setFetching(false);
      setTimeout(() => setElapsed(null), 5000);
    }
  }

  async function handleDelete() {
    setConfirming(false);
    setDeleting(true);
    try {
      await onDelete(video.video_id);
      navigate(-1);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
        <h2 className="artist-page-title video-page-title">{video.title || video.video_id}</h2>
        <a href={ytUrl} target="_blank" rel="noreferrer" className="btn-yt" title="Open on YouTube">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/>
          </svg>
          YouTube
        </a>
        {elapsed != null && <span className="fetch-timer">{elapsed.toFixed(1)}s</span>}
        <button className="btn-secondary btn-export" onClick={handleFetchMeta} disabled={fetching}>
          {fetching ? "Fetching…" : "⟳ Fetch metadata"}
        </button>
        <button className="btn-secondary btn-export" onClick={() => onEdit(video)}>✎ Edit</button>
        {confirming ? (
          <>
            <span className="del-confirm-label">Delete from vault?</span>
            <button
              className="btn-danger btn-export"
              onClick={handleDelete}
              disabled={deleting}
              autoFocus
              title="Confirm delete"
            >
              ✓ Yes
            </button>
            <button className="btn-secondary btn-export" onClick={() => setConfirming(false)} title="Cancel (Esc)">
              ✕ No
            </button>
          </>
        ) : (
          <button
            className="btn-secondary btn-export btn-page-del"
            disabled={deleting}
            onClick={() => setConfirming(true)}
          >
            ✕
          </button>
        )}
      </div>

      {playErr ? (
        <div className="player-fallback">
          <img src={thumbUrl(video.video_id)} alt="" onError={e => { e.target.style.display = "none"; }} />
          <div className="empty">
            Browser can't play this file{video.file_path ? ` (${video.file_path.split(".").pop()})` : ""}.{" "}
            <a href={ytUrl} target="_blank" rel="noreferrer" style={{ color: "#90caf9" }}>Watch on YouTube</a>
          </div>
        </div>
      ) : (
        <video
          className="video-player"
          controls
          preload="metadata"
          poster={thumbUrl(video.video_id)}
          src={streamUrl(video.video_id)}
          onError={() => setPlayErr(true)}
        />
      )}

      <div className="vp-below">
        <Link to={`/artist/${encodeURIComponent(artist)}`} className="vp-channel" style={{ animationDelay: "60ms" }}>
          <img
            className="vp-channel-avatar"
            src={artistThumbUrl(artist)}
            alt=""
            onError={e => { e.target.style.visibility = "hidden"; }}
          />
          <span className="vp-channel-name">{artist}</span>
          <span className="vp-channel-arrow">→</span>
        </Link>

        <div className="vp-stats">
          {[
            video.duration_secs != null && { num: fmtDuration(video.duration_secs), label: "duration" },
            video.view_count    != null && { num: fmt(video.view_count),            label: "views" },
            video.like_count    != null && { num: fmt(video.like_count),            label: "likes" },
            video.file_size_bytes != null && { num: fmtBytes(video.file_size_bytes), label: "on disk" },
            video.recorded_date && { num: video.recorded_date, label: "uploaded" },
          ].filter(Boolean).map((s, i) => (
            <div key={s.label} className="vp-stat" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <span className="vp-stat-num">{s.num}</span>
              <span className="vp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        {video.description && (
          <div className="vp-desc" style={{ animationDelay: "350ms" }}>
            <div className="vp-desc-label">Description</div>
            <div className="vp-desc-body">{video.description}</div>
          </div>
        )}
      </div>
    </div>
  );
}
