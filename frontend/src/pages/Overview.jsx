import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { artistThumbUrl } from "../lib/api";

function ArtistCard({ name, count, onClick }) {
  const [hasThumb, setHasThumb] = useState(true);
  return (
    <div className="creator-card" onClick={onClick}>
      {hasThumb && (
        <img
          className="creator-avatar"
          src={artistThumbUrl(name)}
          alt=""
          onError={() => setHasThumb(false)}
        />
      )}
      <span className="creator-name" title={name}>{name}</span>
      <span className="creator-count">{count}</span>
    </div>
  );
}

export default function Overview({ videos, wanted, ignored, onRemoveMark }) {
  const navigate = useNavigate();

  const counts = {};
  for (const v of videos) {
    const ch = v.channel_name || "Unknown";
    counts[ch] = (counts[ch] || 0) + 1;
  }
  const artists = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {/* Stats */}
      <div className="card">
        <div className="card-title">Library</div>
        <div className="stats-row">
          <div className="stat">
            <div className="stat-num">{videos.length}</div>
            <div className="stat-label">Total</div>
          </div>
          <div className="stat">
            <div className="stat-num">{videos.filter(v => v.view_count != null).length}</div>
            <div className="stat-label">With stats</div>
          </div>
          <div className="stat">
            <div className="stat-num" style={{ color: "#90caf9" }}>{wanted.length}</div>
            <div className="stat-label">Wanted</div>
          </div>
          <div className="stat">
            <div className="stat-num" style={{ color: "#ef9a9a" }}>{ignored.length}</div>
            <div className="stat-label">Ignored</div>
          </div>
        </div>
      </div>

      {/* Artists */}
      <div className="card">
        <div className="card-title">Artists</div>
        {artists.length === 0 ? (
          <div className="empty">No data yet.</div>
        ) : (
          <div className="creator-grid">
            {artists.map(([name, count]) => (
              <ArtistCard key={name} name={name} count={count} onClick={() => navigate(`/artist/${encodeURIComponent(name)}`)} />
            ))}
          </div>
        )}
      </div>

      {/* Wanted */}
      <div className="card">
        <div className="card-title">Download Wishlist</div>
        {wanted.length === 0 ? (
          <div className="empty">No videos in wishlist.</div>
        ) : (
          <div className="wanted-list">
            {wanted.map(v => (
              <div key={v.video_id} className="wanted-item">
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer">
                  {v.title || v.video_id}
                </a>
                <span className="wanted-channel">{v.channel_name || "—"}</span>
                <button className="del-btn" onClick={() => onRemoveMark(v.video_id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ignored */}
      <div className="card">
        <div className="card-title" style={{ color: "#ef9a9a" }}>Not Interested</div>
        {ignored.length === 0 ? (
          <div className="empty">No ignored videos.</div>
        ) : (
          <div className="wanted-list">
            {ignored.map(v => (
              <div key={v.video_id} className="ignored-item">
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer">
                  {v.title || v.video_id}
                </a>
                <span className="wanted-channel">{v.channel_name || "—"}</span>
                <button className="del-btn" onClick={() => onRemoveMark(v.video_id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
