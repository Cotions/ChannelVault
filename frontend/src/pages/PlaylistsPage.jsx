import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { thumbUrl } from "../lib/api";

export default function PlaylistsPage({ playlists, query, onCreatePlaylist, onDeletePlaylist }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const q = (query || "").trim().toLowerCase();
  const shown = q ? playlists.filter(pl => pl.name.toLowerCase().includes(q)) : playlists;

  async function handleCreate(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await onCreatePlaylist(n);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="page-head">
        <h2 className="page-title">Playlists</h2>
        <span className="page-count">{shown.length.toLocaleString()}</span>
      </div>
      <form className="folder-row" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New playlist name…"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <button className="btn-secondary" type="submit" disabled={busy || !name.trim()}>Create</button>
      </form>
      {shown.length === 0 ? (
        <div className="empty" style={{ marginTop: 14 }}>
          {q ? "No matching playlists." : "No playlists yet. Make one here, or use Add to playlist on any video."}
        </div>
      ) : (
        <div className="playlist-list">
          {shown.map(pl => (
            // Not an <a>: it holds the delete button. Keyboard opens it like a link.
            <div
              key={pl.id}
              className="playlist-row"
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/playlist/${pl.id}`)}
              onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/playlist/${pl.id}`); }}
            >
              <span className="playlist-cover">
                {pl.cover_id
                  ? <img src={thumbUrl(pl.cover_id, "card")} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = "none"; }} />
                  : <Icon name="playlist" size={18} className="playlist-icon" />}
              </span>
              <span className="playlist-name">{pl.name}</span>
              <span className="playlist-count">{pl.video_count}<span className="playlist-count-label">video{pl.video_count === 1 ? "" : "s"}</span></span>
              <button
                className="del-btn del-btn-danger"
                title="Delete playlist"
                onClick={e => {
                  e.stopPropagation();
                  if (window.confirm(`Delete playlist "${pl.name}"? The videos stay in the library.`)) onDeletePlaylist(pl.id);
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
