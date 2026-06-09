import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { readLayout, saveLayout } from "../lib/layout";
import { SORT_OPTIONS, sortVideos } from "../lib/sort";
import VideoCard from "../components/VideoCard";

export default function ArtistPage({ videos, wanted, ignored, onDelete, onRemoveMark, onEdit, onFetchMeta, playlists, onAddToPlaylist }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const artist   = decodeURIComponent(name);
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useState("date");

  function switchLayout(next) {
    setLayout(next);
    saveLayout(next);
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
          <Link to={`/artist/${encodeURIComponent(artist)}/stats`} className="btn-secondary btn-export">Stats</Link>
        )}
        {artistVideos.length > 1 && (
          <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
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
          {sortVideos(artistVideos, sort).map(v => (
            <VideoCard
              key={v.video_id}
              video={v}
              onDelete={onDelete}
              onEdit={onEdit}
              onFetchMeta={onFetchMeta}
              playlists={playlists}
              onAddToPlaylist={onAddToPlaylist}
              layout={layout}
            />
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
