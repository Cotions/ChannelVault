import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { artistThumbUrl, getCreators, getChannelStatuses, getArtistRatings } from "../lib/api";
import { ratingStyle, ratingsOn } from "../lib/rating";
import { CHANNEL_STATUS } from "../lib/channelStatus";
import { artistsOf } from "../lib/artists";
import { recDate } from "../lib/sort";
import { isYouTube } from "../lib/source";
import { fmt, fmtBytes, fmtRecordedDate } from "../lib/fmt";
import { useRememberedState } from "../lib/usePagination";
import Icon from "../components/Icon";
import AvatarPicker from "../components/AvatarPicker";

// Runtime as "12h 40m" / "38m": a sum of videos reads better in words than as a clock.
function fmtSpan(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// SQLite timestamps are UTC "YYYY-MM-DD HH:MM:SS".
function ago(ts) {
  if (!ts) return null;
  const t = Date.parse(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1)   return "today";
  if (days < 2)   return "yesterday";
  if (days < 31)  return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30.4)} mo ago`;
  const y = days / 365.25;
  return `${y < 10 ? y.toFixed(1).replace(/\.0$/, "") : Math.floor(y)} yr ago`;
}

const STATUS_RANK = { abandoned: 1, deleted: 2, banned: 3 };

// Each sort: the number it orders by (null = no value, always last) and the
// line the card shows while it is active.
const SORTS = [
  { group: "Your library" },
  { value: "videos",   label: "Videos",          key: s => s.downloaded },
  { value: "name",     label: "Name", dir: "asc" },
  { value: "runtime",  label: "Total runtime",   key: s => s.runtime || null,  line: s => s.runtime && `${fmtSpan(s.runtime)} total` },
  { value: "avglen",   label: "Average length",  key: s => s.lenCount ? s.runtime / s.lenCount : null,
                                                 line: s => s.lenCount && `${fmtSpan(s.runtime / s.lenCount)} avg` },
  { value: "size",     label: "Library size",    key: s => s.size || null,     line: s => s.size && fmtBytes(s.size) },
  { value: "wanted",   label: "Wanted",          key: s => s.wanted || null,   line: s => s.wanted && `${s.wanted} wanted` },
  { value: "skipped",  label: "Skipped",         key: s => s.ignored || null,  line: s => s.ignored && `${s.ignored} skipped` },
  { value: "archived", label: "% of channel archived",
    key: s => s.creator?.video_count ? Math.min(1, s.onChannel / s.creator.video_count) : null,
    line: s => s.creator?.video_count && `${Math.round(100 * Math.min(1, s.onChannel / s.creator.video_count))}% of ${fmt(s.creator.video_count)}` },
  { group: "Activity" },
  { value: "added",    label: "Recently added",  key: s => s.lastAdded,  line: s => s.lastAdded && `added ${ago(s.lastAdded)}` },
  { value: "upload",   label: "Latest upload",   key: s => s.lastUpload, line: s => s.lastUploadRaw && `uploaded ${fmtRecordedDate(s.lastUploadRaw)}` },
  { value: "first",    label: "Earliest upload", dir: "asc", key: s => s.firstUpload, line: s => s.firstUploadRaw && `since ${fmtRecordedDate(s.firstUploadRaw)}` },
  { value: "watched",  label: "Recently watched", key: s => s.lastWatched, line: s => s.lastWatched && `watched ${ago(s.lastWatched)}` },
  { value: "plays",    label: "Most watched",    key: s => s.plays || null, line: s => s.plays && `${s.plays} play${s.plays !== 1 ? "s" : ""}` },
  { group: "On YouTube" },
  { value: "views",    label: "Views of your videos", key: s => s.views || null, line: s => s.views && `${fmt(s.views)} views` },
  { value: "likes",    label: "Likes of your videos", key: s => s.likes || null, line: s => s.likes && `${fmt(s.likes)} likes` },
  { value: "subs",     label: "Subscribers",     key: s => s.creator?.subscriber_count ?? null,
                                                 line: s => s.creator?.subscriber_count != null && `${fmt(s.creator.subscriber_count)} subscribers` },
  { value: "chviews",  label: "Channel views",   key: s => s.creator?.total_views ?? null,
                                                 line: s => s.creator?.total_views != null && `${fmt(s.creator.total_views)} channel views` },
  { value: "chvideos", label: "Channel videos",  key: s => s.creator?.video_count ?? null,
                                                 line: s => s.creator?.video_count != null && `${fmt(s.creator.video_count)} on channel` },
  { value: "rating",   label: "Rating",          key: s => s.rating || null, rated: true },
  { value: "status",   label: "Channel status",  key: s => STATUS_RANK[s.status] || 0,
                                                 line: s => s.status ? CHANNEL_STATUS[s.status]?.label : "Active" },
  { group: "Other" },
  { value: "shuffle",  label: "Shuffle" },
];
const SORT_BY = Object.fromEntries(SORTS.filter(s => s.value).map(s => [s.value, s]));

// The line a card shows when the sort has none of its own.
function defaultLine(s) {
  if (s.runtime) return `${fmtSpan(s.runtime)} total`;
  if (s.creator?.subscriber_count != null) return `${fmt(s.creator.subscriber_count)} subscribers`;
  return null;
}

// Stable per-seed order for Shuffle: a string hash, not Math.random in the comparator.
function shuffleKey(name, seed) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

function ArtistCard({ name, stats, line, index, onPickPicture, rating }) {
  const thumb = artistThumbUrl(name);
  const [failed, setFailed] = useState(null);   // the URL that 404'd; a new picture gets a new chance
  const hasThumb = failed !== thumb;
  const gone = CHANNEL_STATUS[stats.status]?.gone;
  // Their rating's color on the border (Settings → Appearance): the card's only sign of it.
  const rated = ratingStyle(stats.rating, rating);
  return (
    <div
      className={`creator-card${gone ? " is-gone" : ""}${rated.className}`}
      style={{ ...rated.style, animationDelay: `${Math.min(index, 24) * 22}ms` }}
    >
      <Link to={`/artist/${encodeURIComponent(name)}`} className="creator-card-link">
        <span className="creator-avatar-wrap">
          {hasThumb ? (
            <img className="creator-avatar" src={thumb} alt="" loading="lazy" onError={() => setFailed(thumb)} />
          ) : (
            <span className="creator-avatar is-blank">{[...name.trim()][0]?.toUpperCase() || "?"}</span>
          )}
        </span>
        <span className="creator-name" title={name}>{name}</span>
        {CHANNEL_STATUS[stats.status] && (
          <span className={`channel-status-badge is-${stats.status}`}>{CHANNEL_STATUS[stats.status].label}</span>
        )}
        <span className="creator-counts">
          {stats.downloaded > 0 && (
            <span className="creator-count-main">
              <span className="creator-count">{stats.downloaded}</span>
              <span className="creator-count-label">video{stats.downloaded !== 1 ? "s" : ""}</span>
            </span>
          )}
          {stats.wanted > 0 && (
            <span className="creator-count-wanted" title={`${stats.wanted} wanted: not downloaded yet`}>
              <Icon name="download" size={11} />{stats.wanted}<span className="creator-count-tag">wanted</span>
            </span>
          )}
          {stats.ignored > 0 && (
            <span className="creator-count-ignored" title={`${stats.ignored} skipped`}>
              <Icon name="close" size={11} />{stats.ignored}
            </span>
          )}
        </span>
        <span className="creator-metric">{line || " "}</span>
      </Link>
      <button
        type="button"
        className="creator-avatar-edit"
        title="Choose this artist's picture"
        onClick={() => onPickPicture(name)}
      >
        <Icon name="image" size={13} />
      </button>
    </div>
  );
}

export default function ArtistsPage({ videos, wanted, ignored, query, rating }) {
  const q = (query || "").trim().toLowerCase();
  const [creators, setCreators] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [ratings, setRatings] = useState({});
  const showRatings = ratingsOn(rating);
  const [sort, setSort] = useRememberedState("artists:sort", "videos");
  const [dir, setDir] = useRememberedState("artists:dir", "desc");
  const [seed, setSeed] = useRememberedState("artists:seed", 1);
  const [picking, setPicking] = useState(null);    // artist whose picture is being chosen
  const [, setPictureTick] = useState(0);          // re-render the grid after a picture changes

  useEffect(() => {
    let alive = true;
    getCreators().then(c => { if (alive) setCreators(c || []); }).catch(() => {});
    getChannelStatuses().then(m => { if (alive) setStatuses(m || {}); }).catch(() => {});
    getArtistRatings().then(m => { if (alive) setRatings(m || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const allStats = useMemo(() => {
    // "% of channel archived" compares with the video count from the last
    // About-panel capture. Only what that count can include goes against it:
    // YouTube videos still up, uploaded by the capture day. Twitch VODs, local
    // files and deleted or private videos are in the vault but not in it.
    const capturedOn = Object.create(null);
    for (const c of creators) capturedOn[c.channel_name] = recDate(c.captured_at);
    const countedByChannel = (v, name, up) => {
      if (!isYouTube(v) || (v.availability && v.availability !== "available")) return false;
      const cap = capturedOn[name];
      if (!cap || !up) return true;                       // can't tell: give it the benefit
      return up.endsWith("9999") ? up.slice(0, 4) <= cap.slice(0, 4) : up <= cap;   // year-only dates
    };
    const out = Object.create(null);   // an artist called "constructor" is still an artist
    const of = name => (out[name] ||= {
      downloaded: 0, onChannel: 0, wanted: 0, ignored: 0, runtime: 0, lenCount: 0, size: 0, views: 0, likes: 0, plays: 0,
      lastAdded: null, lastWatched: null, lastUpload: null, lastUploadRaw: null, firstUpload: null, firstUploadRaw: null,
    });
    for (const v of videos) {
      const up = recDate(v.recorded_date);
      for (const name of artistsOf(v)) {
        const s = of(name);
        s.downloaded++;
        if (countedByChannel(v, name, up)) s.onChannel++;
        if (v.duration_secs > 0) { s.runtime += v.duration_secs; s.lenCount++; }
        s.size  += v.file_size_bytes || 0;
        s.views += v.view_count || 0;
        s.likes += v.like_count || 0;
        s.plays += v.watch_count || 0;
        if (v.downloaded_at && (!s.lastAdded || v.downloaded_at > s.lastAdded)) s.lastAdded = v.downloaded_at;
        if (v.last_watched_at && (!s.lastWatched || v.last_watched_at > s.lastWatched)) s.lastWatched = v.last_watched_at;
        if (up && (!s.lastUpload || up > s.lastUpload)) { s.lastUpload = up; s.lastUploadRaw = v.recorded_date; }
        if (up && (!s.firstUpload || up < s.firstUpload)) { s.firstUpload = up; s.firstUploadRaw = v.recorded_date; }
      }
    }
    for (const v of wanted)  for (const name of artistsOf(v)) of(name).wanted++;
    for (const v of ignored) for (const name of artistsOf(v)) of(name).ignored++;
    // Channels saved from YouTube's About panel show up even with nothing in the vault yet.
    for (const c of creators) of(c.channel_name).creator = c;
    for (const name in out) {
      out[name].status = statuses[name]?.status || null;
      out[name].rating = ratings[name] || null;
    }
    return out;
  }, [videos, wanted, ignored, creators, statuses, ratings]);

  // Ratings switched off: no Rating sort either (a remembered one falls back).
  const sorts = useMemo(() => SORTS.filter(o => showRatings || !o.rated), [showRatings]);
  const spec = (SORT_BY[sort]?.rated && !showRatings ? null : SORT_BY[sort]) || SORT_BY.videos;
  const artists = useMemo(() => {
    let list = Object.entries(allStats);
    if (q) list = list.filter(([name]) => name.toLowerCase().includes(q));
    const byName = (a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" });
    if (spec.value === "shuffle") {
      return list.sort((a, b) => shuffleKey(a[0], seed) - shuffleKey(b[0], seed));
    }
    if (spec.value === "name") {
      list.sort(byName);
      return dir === "desc" ? list.reverse() : list;
    }
    const sign = dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x = spec.key(a[1]), y = spec.key(b[1]);
      // An artist with no value for this sort sinks in both directions.
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      if (x != null && x !== y) return (x > y ? 1 : -1) * sign;
      // Ties: more videos first, then by name.
      return (b[1].downloaded - a[1].downloaded) || byName(a, b);
    });
  }, [allStats, q, spec, dir, seed]);

  function chooseSort(next) {
    setSort(next);
    // Name reads A–Z and earliest upload oldest-first; the rest biggest/newest first.
    setDir(SORT_BY[next]?.dir || "desc");
  }

  return (
    <div className="card">
      <div className="page-head">
        <h2 className="page-title">Artists</h2>
        <span className="page-count">
          {q ? `${artists.length.toLocaleString()} for “${query.trim()}”` : artists.length.toLocaleString()}
        </span>
        <span className="page-head-spacer" />
        <div className="sort-controls">
          <select className="sort-select" value={spec.value} onChange={e => chooseSort(e.target.value)} title="Sort artists">
            {sorts.reduce((acc, o) => {
              if (o.group) acc.push({ label: o.group, items: [] });
              else acc[acc.length - 1].items.push(o);
              return acc;
            }, []).map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
          {spec.value === "shuffle" ? (
            <button className="sort-dir" onClick={() => setSeed((seed % 1_000_000) + 1)} title="Shuffle again">
              <Icon name="shuffle" size={15} />
            </button>
          ) : (
            <button
              className="sort-dir"
              onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
              title={dir === "desc" ? "Descending — click for ascending" : "Ascending — click for descending"}
            >
              <Icon name={dir === "desc" ? "arrowDown" : "arrowUp"} size={15} />
            </button>
          )}
        </div>
      </div>
      {artists.length === 0 ? (
        <div className="empty">{q ? "No matching artists." : "No data yet."}</div>
      ) : (
        <div className="creator-grid">
          {artists.map(([name, stats], i) => (
            <ArtistCard
              key={name}
              name={name}
              stats={stats}
              index={i}
              line={(spec.line ? spec.line(stats) : null) || defaultLine(stats)}
              onPickPicture={setPicking}
              rating={rating}
            />
          ))}
        </div>
      )}
      {picking && (
        <AvatarPicker
          artist={picking}
          videos={videos}
          onClose={() => setPicking(null)}
          onSaved={() => setPictureTick(t => t + 1)}
        />
      )}
    </div>
  );
}
