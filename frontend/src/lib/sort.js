export const SORT_OPTIONS = [
  { value: "date",      label: "Newest" },
  { value: "date-asc",  label: "Oldest" },
  { value: "duration",  label: "Longest" },
  { value: "views",     label: "Most viewed" },
  { value: "size",      label: "Largest" },
  { value: "watched",   label: "Most watched" },
  { value: "title",     label: "Title A–Z" },
];

// nulls sort last for numeric keys
function num(v) {
  return v == null ? -Infinity : v;
}

export function sortVideos(videos, key) {
  const arr = [...videos];
  switch (key) {
    case "date":
      return arr.sort((a, b) => (b.downloaded_at || "").localeCompare(a.downloaded_at || ""));
    case "date-asc":
      return arr.sort((a, b) => (a.downloaded_at || "").localeCompare(b.downloaded_at || ""));
    case "duration":
      return arr.sort((a, b) => num(b.duration_secs) - num(a.duration_secs));
    case "views":
      return arr.sort((a, b) => num(b.view_count) - num(a.view_count));
    case "size":
      return arr.sort((a, b) => num(b.file_size_bytes) - num(a.file_size_bytes));
    case "watched":
      return arr.sort((a, b) => (b.watch_count || 0) - (a.watch_count || 0));
    case "title":
      return arr.sort((a, b) => (a.title || a.video_id).localeCompare(b.title || b.video_id, undefined, { sensitivity: "base" }));
    default:
      return arr;
  }
}
