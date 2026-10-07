export const SORT_OPTIONS = [
  { value: "upload",   label: "Upload date" },
  { value: "date",     label: "Date added" },
  { value: "stale",    label: "Oldest fetch" },
  { value: "views",    label: "Views" },
  { value: "watched",  label: "My views" },
  { value: "likes",    label: "Likes" },
  { value: "duration", label: "Duration" },
  { value: "size",     label: "File size" },
  { value: "title",    label: "Title" },
];

// Case-insensitive match across title, channel, description and tag names.
// Empty/blank query matches everything.
// Accents don't count: "beyonce" finds "Beyoncé".
const fold = (s) => (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function videoMatches(v, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return (
    fold(v.title).includes(q) ||
    fold(v.channel_name).includes(q) ||
    fold(v.description).includes(q) ||
    (v.tags || []).some(t => fold(t.name).includes(q))
  );
}

// True when the video carries every one of the selected tag ids.
export function hasAllTags(v, tagIds) {
  if (!tagIds || tagIds.length === 0) return true;
  const mine = new Set((v.tags || []).map(t => t.id));
  return tagIds.every(id => mine.has(id));
}

// nulls sort last for numeric keys. Compared, not subtracted: two nulls give
// -Infinity - -Infinity = NaN, which breaks the sort's ordering.
function num(v) {
  return v == null ? -Infinity : v;
}
function byNum(a, b) {
  const x = num(a), y = num(b);
  return x === y ? 0 : x > y ? 1 : -1;
}

// recorded_date comes in mixed formats: yt-dlp "20260426", site fetch "2026-05-26".
// Strip non-digits so both become "20260426" for correct lexical ordering.
// A year-only date ("2024") counts as the end of that year.
function recDate(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 8);
  if (d.length === 8 && /^\d{4}-?\d{2}-?\d{2}/.test((v || "").trim())) return d;
  if (d.length === 4 && /^\d{4}$/.test((v || "").trim())) return d + "9999";
  // Typed-in dates ("Aug 25, 2025"): the digits alone would sort as year 2520.
  const t = Date.parse(v || "");
  if (Number.isNaN(t)) return "";
  const x = new Date(t);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
}

// A video we can't refetch (private/deleted/etc, or not on YouTube at all).
// NULL or "available" = fetchable.
function isDead(v) {
  return (!!v.availability && v.availability !== "available") || (v.source || "youtube") !== "youtube";
}

// Descending comparator per key (newest / most / largest / Z–A first).
function cmpDesc(key, a, b) {
  switch (key) {
    case "upload":   return (recDate(b.recorded_date) || "0").localeCompare(recDate(a.recorded_date) || "0");
    case "date":     return (b.downloaded_at || "").localeCompare(a.downloaded_at || "");
    // "stale" default (desc) order: never-fetched first, then oldest fetch, dead videos last.
    case "stale": {
      const da = isDead(a), db = isDead(b);
      if (da !== db) return da ? 1 : -1;
      return (a.stats_updated_at || "").localeCompare(b.stats_updated_at || "");
    }
    case "duration": return byNum(b.duration_secs, a.duration_secs);
    case "views":    return byNum(b.view_count, a.view_count);
    case "likes":    return byNum(b.like_count, a.like_count);
    case "size":     return byNum(b.file_size_bytes, a.file_size_bytes);
    case "watched":  return (b.watch_count || 0) - (a.watch_count || 0);
    case "title":    return (b.title || b.video_id).localeCompare(a.title || a.video_id, undefined, { sensitivity: "base" });
    default:         return 0;
  }
}

// `pins` (see lib/sortPins.js) maps video_id -> a pre-fetch snapshot of the row.
// A pinned video is compared on its snapshot, so a just-fetched card keeps its
// slot for a few seconds instead of jumping the moment its stats change.
export function sortVideos(videos, key, dir = "desc", pins = null) {
  const arr = [...videos];
  const row = pins ? (v => pins[v.video_id] || v) : (v => v);
  arr.sort((a, b) => cmpDesc(key, row(a), row(b)));
  if (dir === "asc") arr.reverse();
  return arr;
}
