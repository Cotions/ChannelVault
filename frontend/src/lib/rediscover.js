// Rediscover: a few videos from the library worth another look, picked at
// random but weighted by watch history. Old favorites (finished more than once,
// not seen in months) and long-forgotten downloads come up most; anything
// finished in the last few weeks stays out. Artists not watched in a while get
// a boost too, and one artist never takes more than one slot.

const DAY = 86400 * 1000;
export const RECENT_DAYS = 21;

// SQLite's CURRENT_TIMESTAMP: UTC, no zone.
function toTime(ts) {
  if (!ts) return null;
  const t = Date.parse(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
  return isNaN(t) ? null : t;
}

function daysSince(ts, now) {
  const t = toTime(ts);
  return t == null ? null : Math.max(0, (now - t) / DAY);
}

function artistKey(v) {
  return (v.channel_name || "").split(",")[0].trim().toLowerCase() || v.video_id;
}

export const MODES = [
  { id: "mix",       label: "Mix" },
  { id: "favorites", label: "Old favorites" },
  { id: "unwatched", label: "Never watched" },
];

function weight(v, mode, now, artistDays) {
  const count = v.watch_count || 0;
  const seen  = daysSince(v.last_watched_at, now);
  if (seen != null && seen < RECENT_DAYS) return 0;
  const artist = 1 + Math.min((artistDays ?? 365) / 60, 3);   // up to 4x for an artist left alone
  if (count > 0) {
    if (mode === "unwatched") return 0;
    return Math.pow(count, 0.7) * Math.min(seen / 30, 12) * artist;
  }
  if (mode === "favorites") return 0;
  // Never finished: the longer it has sat there, the more it is owed a look.
  const age = daysSince(v.downloaded_at, now) ?? 0;
  return (1 + age / 90) * artist * (mode === "mix" ? 0.6 : 1);
}

// Weighted sample without replacement (Efraimidis–Spirakis), one per artist.
export function pickRediscover(videos, mode, n, rand = Math.random) {
  const now = Date.now();
  const artistLast = new Map();
  for (const v of videos) {
    const t = toTime(v.last_watched_at);
    if (t == null) continue;
    const k = artistKey(v);
    if (!(artistLast.get(k) > t)) artistLast.set(k, t);
  }
  const keyed = [];
  for (const v of videos) {
    const last = artistLast.get(artistKey(v));
    const w = weight(v, mode, now, last == null ? null : (now - last) / DAY);
    if (w > 0) keyed.push({ v, k: Math.pow(rand(), 1 / w) });
  }
  keyed.sort((a, b) => b.k - a.k);
  const out = [], artists = new Set();
  for (const { v } of keyed) {
    const a = artistKey(v);
    if (artists.has(a)) continue;
    artists.add(a);
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

function ago(days) {
  if (days < 45)  return `${Math.round(days)} days ago`;
  if (days < 548) return `${Math.round(days / 30.4)} months ago`;
  return `${(days / 365).toFixed(days < 3650 ? 1 : 0).replace(/\.0$/, "")} years ago`;
}

// One line on why it came up.
export function rediscoverReason(v) {
  const now = Date.now();
  if (v.watch_count > 0) {
    const seen = daysSince(v.last_watched_at, now);
    return `Watched ${v.watch_count}× · last ${seen == null ? "a while ago" : ago(seen)}`;
  }
  const age = daysSince(v.downloaded_at, now);
  return age == null ? "Never watched" : `Never watched · saved ${ago(age)}`;
}
