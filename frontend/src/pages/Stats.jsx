import { useParams, useNavigate, Link } from "react-router-dom";
import { exportCsvUrl, exportJsonUrl, thumbUrl } from "../lib/api";
import { fmt, fmtBytes, fmtDuration } from "../lib/fmt";
import { artistsOf } from "../lib/artists";
import Icon from "../components/Icon";
import { isYouTube } from "../lib/source";

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

export default function Stats({ videos, wanted = [], ignored = [] }) {
  const navigate = useNavigate();
  const { name } = useParams();
  const artist   = name != null ? decodeURIComponent(name) : null;

  const scopeVideos = artist
    ? videos.filter(v => artistsOf(v).includes(artist))
    : videos;

  const withSize   = scopeVideos.filter(v => v.file_size_bytes != null);
  const totalBytes = withSize.reduce((sum, v) => sum + v.file_size_bytes, 0);
  const totalSecs  = scopeVideos.reduce((sum, v) => sum + (v.duration_secs || 0), 0);

  const channelCounts = {};
  for (const v of scopeVideos) {
    for (const ch of artistsOf(v)) {
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
    }
  }
  const channels = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = channels.length > 0 ? channels[0][1] : 1;
  const TOP = 15;

  const longest = scopeVideos
    .filter(v => v.duration_secs != null)
    .reduce((best, v) => (best == null || v.duration_secs > best.duration_secs ? v : best), null);

  const mostViewed = scopeVideos
    .filter(v => v.view_count != null)
    .reduce((best, v) => (best == null || v.view_count > best.view_count ? v : best), null);

  const totalWatches = scopeVideos.reduce((sum, v) => sum + (v.watch_count || 0), 0);

  const mostWatched = scopeVideos
    .filter(v => v.watch_count > 0)
    .reduce((best, v) => (best == null || v.watch_count > best.watch_count ? v : best), null);

  // What is left of the channel on YouTube, as of each video's last fetch.
  // Geo-blocked and age-gated videos are still up for the public, just gated.
  // Unfetched videos (no availability yet) count toward none of these.
  // Only YouTube entries can be up or down there; Twitch VODs and local files sit out.
  const ytVideos   = scopeVideos.filter(isYouTube);
  const availCount = (...states) => ytVideos.filter(v => states.includes(v.availability)).length;
  const publicCount    = availCount("available", "geo", "age");
  const deletedCount   = availCount("deleted", "unavailable");
  const privateCount   = availCount("private");
  const membersCount   = availCount("members");
  const uncheckedCount = ytVideos.filter(v => !v.availability).length;
  const checkedCount = publicCount + deletedCount + privateCount + membersCount;
  const pct = n => (checkedCount ? `${Math.round((n / checkedCount) * 100)}% of checked` : null);
  const availSegments = [
    { key: "public",    n: publicCount,    label: "still public", color: "var(--glow)" },
    { key: "deleted",   n: deletedCount,   label: "deleted",      color: "#ef9a9a" },
    { key: "private",   n: privateCount,   label: "private",      color: "#ffd591" },
    { key: "members",   n: membersCount,   label: "members only", color: "#90caf9" },
  ];

  // Grouped by what the numbers are about rather than one flat grid, so a
  // reader finds "how big is the vault" and "what is left on YouTube" at a glance.
  const libraryStats = [
    { num: fmt(scopeVideos.length),                              label: "videos vaulted" },
    ...(artist ? [] : [{ num: fmt(channels.length),              label: "channels" }]),
    { num: withSize.length > 0 ? fmtBytes(totalBytes) : "—",     label: "on disk", sub: withSize.length < scopeVideos.length ? `${withSize.length}/${scopeVideos.length} sizes known` : null },
    { num: fmtHours(totalSecs),                                  label: "of footage" },
  ];
  const activityStats = [
    { num: fmt(totalWatches),                                    label: "total watches" },
    { num: fmt(scopeVideos.filter(v => v.view_count != null).length), label: "with stats" },
    ...(artist ? [] : [
      { num: fmt(wanted.length),                                 label: "wanted",  color: "#90caf9" },
      { num: fmt(ignored.length),                                label: "ignored", color: "#ef9a9a" },
    ]),
  ];
  const youtubeStats = availSegments
    .map(s => ({ num: fmt(s.n), label: s.label, sub: pct(s.n), color: s.key === "public" ? undefined : s.color }));
  const youtubeGroup = {
    key: "youtube", title: "On YouTube", stats: youtubeStats, bar: true,
    aside: uncheckedCount ? `${fmt(uncheckedCount)} unchecked` : null,
  };

  // An artist has no wanted/ignored tiles, so its two activity numbers join the
  // library row and YouTube takes the full width instead of leaving a lopsided pair.
  const groups = artist ? [
    { key: "library",  title: "Library",  stats: [...libraryStats, ...activityStats], wide: true },
    { ...youtubeGroup, wide: true },
  ] : [
    { key: "library",  title: "Library",  stats: libraryStats, wide: true },
    { key: "activity", title: "Activity", stats: activityStats },
    youtubeGroup,
  ];
  let cellIndex = 0;

  const title    = artist ? `${artist} · Stats` : "Stats";

  return (
    <div className="stats-page">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>
          <Icon name="back" size={15} />Back
        </button>
        <h2 className="artist-page-title">{title}</h2>
        {!artist && (
          <>
            <a href={exportCsvUrl()} download className="btn-secondary btn-export">Export CSV</a>
            <a href={exportJsonUrl()} download className="btn-secondary btn-export">Export JSON</a>
          </>
        )}
      </div>

      {scopeVideos.length === 0 ? (
        <div className="card"><div className="empty">No data yet.</div></div>
      ) : (
        <>
          <div className="stats-groups">
            {groups.map(g => (
              <section key={g.key} className={`stats-group${g.wide ? " is-wide" : ""}`}>
                <div className="stats-group-head">
                  <span className="stats-group-title">{g.title}</span>
                  {g.aside && <span className="stats-group-aside">{g.aside}</span>}
                </div>
                {g.bar && checkedCount > 0 && (
                  <div className="avail-bar" title={availSegments.map(s => `${s.label}: ${s.n}`).join(" · ")}>
                    {availSegments.filter(s => s.n > 0).map(s => (
                      <span key={s.key} className="avail-bar-seg" style={{ flexGrow: s.n, background: s.color }} />
                    ))}
                  </div>
                )}
                <div
                  className={`stats-hero${g.wide ? "" : " is-compact"}`}
                  style={{ gridTemplateColumns: `repeat(${g.wide ? g.stats.length : 2}, 1fr)` }}
                >
                  {g.stats.map(s => (
                    <div key={s.label} className="stats-hero-cell" style={{ animationDelay: `${cellIndex++ * 60}ms` }}>
                      <span className="stats-hero-num" style={s.color ? { color: s.color } : undefined}>{s.num}</span>
                      <span className="stats-hero-label">{s.label}</span>
                      {s.sub && <span className="stats-hero-sub">{s.sub}</span>}
                    </div>
                  ))}
                </div>
              </section>
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

          {!artist && (
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
          )}
        </>
      )}
    </div>
  );
}
