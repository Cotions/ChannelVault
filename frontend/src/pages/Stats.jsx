import { useNavigate, Link } from "react-router-dom";
import { exportCsvUrl, exportJsonUrl, thumbUrl } from "../lib/api";
import { fmt, fmtBytes, fmtDuration } from "../lib/fmt";

function fmtHours(secs) {
  if (!secs) return "—";
  const h = secs / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.round(secs / 60)}min`;
}

function RecordCard({ video, label, statText, delay }) {
  if (!video) return null;
  return (
    <Link
      to={`/video/${video.video_id}`}
      className="record-card"
      style={{ animationDelay: `${delay}ms` }}
    >
      <img className="record-card-bg" src={thumbUrl(video.video_id)} alt="" onError={e => { e.target.style.display = "none"; }} />
      <div className="record-card-overlay" />
      <div className="record-card-content">
        <span className="record-card-label">{label}</span>
        <span className="record-card-title">{video.title || video.video_id}</span>
        <span className="record-card-stat">{statText}</span>
      </div>
    </Link>
  );
}

export default function Stats({ videos }) {
  const navigate = useNavigate();

  const withSize   = videos.filter(v => v.file_size_bytes != null);
  const totalBytes = withSize.reduce((sum, v) => sum + v.file_size_bytes, 0);
  const totalSecs  = videos.reduce((sum, v) => sum + (v.duration_secs || 0), 0);

  const channelCounts = {};
  for (const v of videos) {
    const ch = v.channel_name || "Unknown";
    channelCounts[ch] = (channelCounts[ch] || 0) + 1;
  }
  const channels = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = channels.length > 0 ? channels[0][1] : 1;
  const TOP = 15;

  const longest = videos
    .filter(v => v.duration_secs != null)
    .reduce((best, v) => (best == null || v.duration_secs > best.duration_secs ? v : best), null);

  const mostViewed = videos
    .filter(v => v.view_count != null)
    .reduce((best, v) => (best == null || v.view_count > best.view_count ? v : best), null);

  const totalWatches = videos.reduce((sum, v) => sum + (v.watch_count || 0), 0);

  const mostWatched = videos
    .filter(v => v.watch_count > 0)
    .reduce((best, v) => (best == null || v.watch_count > best.watch_count ? v : best), null);

  const heroStats = [
    { num: fmt(videos.length),                                   label: "videos vaulted" },
    { num: withSize.length > 0 ? fmtBytes(totalBytes) : "—",     label: withSize.length < videos.length ? `on disk · ${withSize.length}/${videos.length} known` : "on disk" },
    { num: fmtHours(totalSecs),                                  label: "of footage" },
    { num: fmt(channels.length),                                 label: "channels" },
    { num: fmt(totalWatches),                                    label: "total watches" },
  ];

  return (
    <div className="stats-page">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate("/")}>← Back</button>
        <h2 className="artist-page-title">Stats</h2>
        <a href={exportCsvUrl()} download className="btn-secondary btn-export">Export CSV</a>
        <a href={exportJsonUrl()} download className="btn-secondary btn-export">Export JSON</a>
      </div>

      {videos.length === 0 ? (
        <div className="card"><div className="empty">No data yet.</div></div>
      ) : (
        <>
          <div className="stats-hero">
            {heroStats.map((s, i) => (
              <div key={s.label} className="stats-hero-cell" style={{ animationDelay: `${i * 90}ms` }}>
                <span className="stats-hero-num">{s.num}</span>
                <span className="stats-hero-label">{s.label}</span>
              </div>
            ))}
          </div>

          {(longest || mostViewed || mostWatched) && (
            <div className="record-cards">
              <RecordCard
                video={longest}
                label="Longest video"
                statText={longest ? fmtDuration(longest.duration_secs) : ""}
                delay={350}
              />
              <RecordCard
                video={mostViewed}
                label="Most viewed"
                statText={mostViewed ? `${fmt(mostViewed.view_count)} views` : ""}
                delay={450}
              />
              <RecordCard
                video={mostWatched}
                label="Most watched"
                statText={mostWatched ? `${mostWatched.watch_count}× watched` : ""}
                delay={550}
              />
            </div>
          )}

          <div className="card stats-channels">
            <div className="card-title">Videos per channel</div>
            <div className="channel-bars">
              {channels.slice(0, TOP).map(([name, count], i) => (
                <Link
                  key={name}
                  to={`/artist/${encodeURIComponent(name)}`}
                  className="channel-bar-row"
                  style={{ "--d": `${500 + i * 50}ms`, animationDelay: `var(--d)` }}
                >
                  <span className="channel-bar-name">{name}</span>
                  <span className="channel-bar-track">
                    <span className="channel-bar-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
                  </span>
                  <span className="channel-bar-count">{count}</span>
                </Link>
              ))}
            </div>
            {channels.length > TOP && (
              <div className="channel-bars-more">
                + {channels.length - TOP} more channel{channels.length - TOP !== 1 ? "s" : ""} · {channels.slice(TOP).reduce((s, [, c]) => s + c, 0)} videos
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
