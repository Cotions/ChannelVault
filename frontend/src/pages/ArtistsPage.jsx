import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { artistThumbUrl } from "../lib/api";

function ArtistCard({ name, stats, onClick }) {
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
      <div className="creator-counts">
        {stats.downloaded > 0 && <span className="creator-count">{stats.downloaded}</span>}
        {stats.wanted > 0 && <span className="creator-count-wanted">⬇{stats.wanted}</span>}
        {stats.ignored > 0 && <span className="creator-count-ignored">✕{stats.ignored}</span>}
      </div>
    </div>
  );
}

export default function ArtistsPage({ videos, wanted, ignored, query }) {
  const navigate = useNavigate();
  const q = (query || "").trim().toLowerCase();

  const artistStats = {};
  for (const v of videos) {
    const ch = v.channel_name || "Unknown";
    if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
    artistStats[ch].downloaded++;
  }
  for (const v of wanted) {
    const ch = v.channel_name || "Unknown";
    if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
    artistStats[ch].wanted++;
  }
  for (const v of ignored) {
    const ch = v.channel_name || "Unknown";
    if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
    artistStats[ch].ignored++;
  }
  let artists = Object.entries(artistStats).sort((a, b) => b[1].downloaded - a[1].downloaded);
  if (q) artists = artists.filter(([name]) => name.toLowerCase().includes(q));

  return (
    <div className="card">
      <div className="card-title">{q ? `Artists matching "${query.trim()}"` : "Artists"}</div>
      {artists.length === 0 ? (
        <div className="empty">{q ? "No matching artists." : "No data yet."}</div>
      ) : (
        <div className="creator-grid">
          {artists.map(([name, stats]) => (
            <ArtistCard
              key={name}
              name={name}
              stats={stats}
              onClick={() => navigate(`/artist/${encodeURIComponent(name)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
