import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import VideoCard from "../components/VideoCard";

function readLayout() {
  try {
    return localStorage.getItem("cv:layout") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export default function ArtistPage({ videos, wanted, ignored, onDelete, onRemoveMark, onEdit, onFetchMeta }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const artist   = decodeURIComponent(name);
  const [layout, setLayout] = useState(readLayout);

  function switchLayout(next) {
    setLayout(next);
    try { localStorage.setItem("cv:layout", next); } catch {}
  }

  const artistVideos  = videos.filter(v => (v.channel_name || "Unknown") === artist);
  const artistWanted  = wanted.filter(v => (v.channel_name || "Unknown") === artist);
  const artistIgnored = ignored.filter(v => (v.channel_name || "Unknown") === artist);

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate("/")}>← Back</button>
        <h2 className="artist-page-title">{artist}</h2>
        {artistVideos.length > 0 && (
          <span className="artist-badge">{artistVideos.length} video{artistVideos.length !== 1 ? "s" : ""}</span>
        )}
        {artistWanted.length > 0 && (
          <span className="artist-badge" style={{ background: "#1565c033", color: "#90caf9" }}>⬇ {artistWanted.length} wanted</span>
        )}
        {artistIgnored.length > 0 && (
          <span className="artist-badge" style={{ background: "#b71c1c33", color: "#ef9a9a" }}>✕ {artistIgnored.length} skipped</span>
        )}
        {artistVideos.length > 0 && (
          <div className="layout-toggle">
            <button
              className={`btn-ghost${layout === "grid" ? " active" : ""}`}
              onClick={() => switchLayout("grid")}
              title="Grid view"
            >
              ▦
            </button>
            <button
              className={`btn-ghost${layout === "list" ? " active" : ""}`}
              onClick={() => switchLayout("list")}
              title="List view"
            >
              ☰
            </button>
          </div>
        )}
      </div>

      {artistVideos.length > 0 && (
        <div className={layout === "list" ? "video-list" : "video-grid"}>
          {artistVideos.map(v => (
            <VideoCard key={v.video_id} video={v} onDelete={onDelete} onEdit={onEdit} onFetchMeta={onFetchMeta} layout={layout} />
          ))}
        </div>
      )}

      {artistWanted.length > 0 && (
        <div style={{ marginTop: artistVideos.length > 0 ? 24 : 0 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Wanted</div>
          <div className="wanted-list">
            {artistWanted.map(v => (
              <div key={v.video_id} className="wanted-item">
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer">
                  {v.title || v.video_id}
                </a>
                <button className="del-btn" onClick={() => onRemoveMark(v.video_id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {artistIgnored.length > 0 && (
        <div style={{ marginTop: (artistVideos.length > 0 || artistWanted.length > 0) ? 24 : 0 }}>
          <div className="card-title" style={{ marginBottom: 8, color: "#ef9a9a" }}>Skipped</div>
          <div className="wanted-list">
            {artistIgnored.map(v => (
              <div key={v.video_id} className="ignored-item">
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer">
                  {v.title || v.video_id}
                </a>
                <button className="del-btn" onClick={() => onRemoveMark(v.video_id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {artistVideos.length === 0 && artistWanted.length === 0 && artistIgnored.length === 0 && (
        <div className="empty">No videos found for this artist.</div>
      )}
    </div>
  );
}
