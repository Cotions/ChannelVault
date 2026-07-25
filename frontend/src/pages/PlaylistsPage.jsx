import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";

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
          {q ? "No matching playlists." : "No playlists yet."}
        </div>
      ) : (
        <div className="playlist-list">
          {shown.map(pl => (
            <div key={pl.id} className="playlist-row" onClick={() => navigate(`/playlist/${pl.id}`)}>
              <Icon name="playlist" size={15} className="playlist-icon" />
              <span className="playlist-name">{pl.name}</span>
              <span className="playlist-count">{pl.video_count}</span>
              <button
                className="del-btn del-btn-danger"
                title="Delete playlist"
                onClick={e => { e.stopPropagation(); onDeletePlaylist(pl.id); }}
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
