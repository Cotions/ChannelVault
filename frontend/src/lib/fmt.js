export function fmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function fmtBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-CA");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Upload dates reach us in whatever shape the source used — yt-dlp writes
   "20260723", the API writes "2026-07-17", hand-entered rows look like
   "Aug 25, 2025". Rendering them raw put three different formats in one grid,
   so everything funnels through here. Current-year dates drop the year. */
export function fmtRecordedDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let y, m, d;

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  const dashed  = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (compact || dashed) {
    [, y, m, d] = compact || dashed;
    y = +y; m = +m; d = +d;
  } else {
    const parsed = new Date(s);
    if (isNaN(parsed)) return s;          // unrecognised — show it rather than lose it
    y = parsed.getFullYear();
    m = parsed.getMonth() + 1;
    d = parsed.getDate();
  }

  if (m < 1 || m > 12 || d < 1 || d > 31) return s;
  const label = `${MONTHS[m - 1]} ${d}`;
  return y === new Date().getFullYear() ? label : `${label}, ${y}`;
}

export function fmtDuration(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* Hrefs scraped from a channel's About panel are attacker-controlled. React
   renders a javascript: href as-is, so only web and mail schemes get through. */
export function safeUrl(url, schemes = ["http:", "https:"]) {
  if (!url) return undefined;
  try {
    const u = new URL(String(url));
    return schemes.includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
