import { useNavigate } from "react-router-dom";
import { exportCsvUrl, exportJsonUrl } from "../lib/api";
import { fmt, fmtBytes, fmtDuration } from "../lib/fmt";

export default function Stats({ videos }) {
  const navigate = useNavigate();

  const withSize = videos.filter(v => v.file_size_bytes != null);
  const totalBytes = withSize.reduce((sum, v) => sum + v.file_size_bytes, 0);

  const channelCounts = {};
  for (const v of videos) {
    const ch = v.channel_name || "Unknown";
    channelCounts[ch] = (channelCounts[ch] || 0) + 1;
  }
  const channels = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]);

  const longest = videos
    .filter(v => v.duration_secs != null)
    .reduce((best, v) => (best == null || v.duration_secs > best.duration_secs ? v : best), null);

  const mostViewed = videos
    .filter(v => v.view_count != null)
    .reduce((best, v) => (best == null || v.view_count > best.view_count ? v : best), null);

  const ytLink = v => (
    <a
      href={`https://www.youtube.com/watch?v=${v.video_id}`}
      target="_blank"
      rel="noreferrer"
      className="record-link"
    >
      {v.title || v.video_id}
    </a>
  );

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate("/")}>← Back</button>
        <h2 className="artist-page-title">Stats</h2>
        <a href={exportCsvUrl()} download className="btn-secondary btn-export">Export CSV</a>
        <a href={exportJsonUrl()} download className="btn-secondary btn-export">Export JSON</a>
      </div>

      {videos.length === 0 ? (
        <div className="empty">No data yet.</div>
      ) : (
        <>
          <div className="stats-row">
            <div className="stat">
              <div className="stat-num">{videos.length}</div>
              <div className="stat-label">Videos</div>
            </div>
            <div className="stat">
              <div className="stat-num">{withSize.length > 0 ? fmtBytes(totalBytes) : "—"}</div>
              <div className="stat-label">
                Disk size{withSize.length < videos.length ? ` (${withSize.length} of ${videos.length} known)` : ""}
              </div>
            </div>
            <div className="stat">
              <div className="stat-num">{channels.length}</div>
              <div className="stat-label">Channels</div>
            </div>
          </div>

          <div className="card-title" style={{ marginTop: 20 }}>Records</div>
          <div className="records-list">
            <div className="record-row">
              <span className="record-label">Longest video</span>
              {longest ? (
                <span className="record-value">
                  {ytLink(longest)} <span className="record-num">{fmtDuration(longest.duration_secs)}</span>
                </span>
              ) : <span className="record-value">—</span>}
            </div>
            <div className="record-row">
              <span className="record-label">Most viewed</span>
              {mostViewed ? (
                <span className="record-value">
                  {ytLink(mostViewed)} <span className="record-num">{fmt(mostViewed.view_count)} views</span>
                </span>
              ) : <span className="record-value">—</span>}
            </div>
          </div>

          <div className="card-title" style={{ marginTop: 20 }}>Videos per channel</div>
          <div className="stats-table">
            {channels.map(([name, count]) => (
              <div key={name} className="stats-table-row">
                <span className="stats-table-name">{name}</span>
                <span className="stats-table-count">{count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
