import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { artistThumbUrl, getCreators, getChannelStatuses } from "../lib/api";
import { CHANNEL_STATUS } from "../lib/channelStatus";
import { artistsOf } from "../lib/artists";
import Icon from "../components/Icon";

function ArtistCard({ name, stats, status }) {
  const [hasThumb, setHasThumb] = useState(true);
  return (
    <Link
      to={`/artist/${encodeURIComponent(name)}`}
      className={`creator-card${CHANNEL_STATUS[status]?.gone ? " is-gone" : ""}`}
    >
      {hasThumb && (
        <img
          className="creator-avatar"
          src={artistThumbUrl(name)}
          alt=""
          onError={() => setHasThumb(false)}
        />
      )}
      <span className="creator-name" title={name}>{name}</span>
      {CHANNEL_STATUS[status] && (
        <span className={`channel-status-badge is-${status}`}>{CHANNEL_STATUS[status].label}</span>
      )}
      <div className="creator-counts">
        {stats.downloaded > 0 && <span className="creator-count">{stats.downloaded}</span>}
        {stats.wanted > 0 && (
          <span className="creator-count-wanted" title={`${stats.wanted} wanted`}>
            <Icon name="download" size={11} />{stats.wanted}
          </span>
        )}
        {stats.ignored > 0 && (
          <span className="creator-count-ignored" title={`${stats.ignored} ignored`}>
            <Icon name="close" size={11} />{stats.ignored}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function ArtistsPage({ videos, wanted, ignored, query }) {
  const q = (query || "").trim().toLowerCase();
  const [creators, setCreators] = useState([]);
  const [statuses, setStatuses] = useState({});

  useEffect(() => {
    let alive = true;
    getCreators().then(c => { if (alive) setCreators(c || []); }).catch(() => {});
    getChannelStatuses().then(m => { if (alive) setStatuses(m || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const artistStats = Object.create(null);   // an artist called "constructor" is still an artist
  const bump = (v, key) => {
    for (const ch of artistsOf(v)) {
      if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
      artistStats[ch][key]++;
    }
  };
  for (const v of videos)  bump(v, "downloaded");
  for (const v of wanted)  bump(v, "wanted");
  for (const v of ignored) bump(v, "ignored");
  // Channels saved from YouTube's About panel show up even with nothing in the vault yet.
  for (const c of creators) {
    if (!artistStats[c.channel_name]) artistStats[c.channel_name] = { downloaded: 0, wanted: 0, ignored: 0 };
  }
  let artists = Object.entries(artistStats).sort((a, b) => b[1].downloaded - a[1].downloaded);
  if (q) artists = artists.filter(([name]) => name.toLowerCase().includes(q));

  return (
    <div className="card">
      <div className="page-head">
        <h2 className="page-title">Artists</h2>
        <span className="page-count">
          {q ? `${artists.length.toLocaleString()} for “${query.trim()}”` : artists.length.toLocaleString()}
        </span>
      </div>
      {artists.length === 0 ? (
        <div className="empty">{q ? "No matching artists." : "No data yet."}</div>
      ) : (
        <div className="creator-grid">
          {artists.map(([name, stats]) => (
            <ArtistCard
              key={name}
              name={name}
              stats={stats}
              status={statuses[name]?.status}
            />
          ))}
        </div>
      )}
    </div>
  );
}
