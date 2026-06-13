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

// Case-insensitive match across title, channel, description.
// Empty/blank query matches everything.
export function videoMatches(v, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return (
    (v.title || "").toLowerCase().includes(q) ||
    (v.channel_name || "").toLowerCase().includes(q) ||
    (v.description || "").toLowerCase().includes(q)
  );
}

// nulls sort last for numeric keys
function num(v) {
  return v == null ? -Infinity : v;
}

// recorded_date comes in mixed formats: yt-dlp "20260426", site fetch "2026-05-26".
// Strip non-digits so both become "20260426" for correct lexical ordering.
function recDate(v) {
  return (v || "").replace(/\D/g, "");
}

// A video we can't refetch (private/deleted/etc). NULL or "available" = fetchable.
function isDead(v) {
  return !!v.availability && v.availability !== "available";
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
    case "duration": return num(b.duration_secs) - num(a.duration_secs);
    case "views":    return num(b.view_count) - num(a.view_count);
    case "likes":    return num(b.like_count) - num(a.like_count);
    case "size":     return num(b.file_size_bytes) - num(a.file_size_bytes);
    case "watched":  return (b.watch_count || 0) - (a.watch_count || 0);
    case "title":    return (b.title || b.video_id).localeCompare(a.title || a.video_id, undefined, { sensitivity: "base" });
    default:         return 0;
  }
}

export function sortVideos(videos, key, dir = "desc") {
  const arr = [...videos];
  arr.sort((a, b) => cmpDesc(key, a, b));
  if (dir === "asc") arr.reverse();
  return arr;
}
