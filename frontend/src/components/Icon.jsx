/* Inline stroke icons. One <svg> per name, sized by the `size` prop and coloured
   by `currentColor` so they inherit whatever the surrounding button/link uses.
   Replaces the emoji glyphs that used to stand in for icons — emoji render with
   the platform's own colour and baseline, which fought the phosphor palette. */

const PATHS = {
  home:      <><path d="M3 10.2 12 3l9 7.2" /><path d="M5.5 9.2V20h13V9.2" /><path d="M9.8 20v-5.4h4.4V20" /></>,
  playlist:  <><path d="M3 6h11" /><path d="M3 12h11" /><path d="M3 18h7" /><circle cx="17.5" cy="17" r="3" /><path d="M20.5 17V8.4l2.5.9" /></>,
  users:     <><circle cx="9.5" cy="8" r="3.4" /><path d="M3.5 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6" /><path d="M16.4 5.2a3.4 3.4 0 0 1 0 6.4" /><path d="M18 14.9c2.1.7 3.5 2.5 3.5 5.1" /></>,
  pulse:     <><path d="M3 12h3.6l2.2-6 3.4 12.4L14.8 12H21" /></>,
  chart:     <><path d="M3.5 20.5h17" /><path d="M6.5 20.5V11" /><path d="M11.5 20.5V4.5" /><path d="M16.5 20.5v-6.6" /></>,
  plus:      <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus:     <><path d="M5 12h14" /></>,
  settings:  <><circle cx="12" cy="12" r="3.1" /><path d="M19.6 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.6-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.5h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1.1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.5 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.5h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9z" /></>,
  refresh:   <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" /><path d="M20.8 4.2v5h-5" /></>,
  pencil:    <><path d="M4 20h4.2L19.4 8.8a2.1 2.1 0 0 0-3-3L5.2 17z" /><path d="M14.9 5.4 18.6 9" /></>,
  trash:     <><path d="M4.5 6.6h15" /><path d="M9.5 6.6V4.4h5v2.2" /><path d="M6.6 6.6 7.5 20h9l.9-13.4" /><path d="M10.4 10.4v5.8" /><path d="M13.6 10.4v5.8" /></>,
  close:     <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  check:     <><path d="M4.5 12.6 9.5 17.5 19.5 6.9" /></>,
  play:      <><path d="M8 5.2 19 12 8 18.8z" /></>,
  search:    <><circle cx="10.8" cy="10.8" r="6.3" /><path d="M15.4 15.4 20.5 20.5" /></>,
  back:      <><path d="M20 12H4.5" /><path d="M10.6 5.6 4.2 12l6.4 6.4" /></>,
  arrowDown: <><path d="M12 4.5v15" /><path d="M5.8 13.4 12 19.6l6.2-6.2" /></>,
  arrowUp:   <><path d="M12 19.5v-15" /><path d="M5.8 10.6 12 4.4l6.2 6.2" /></>,
  download:  <><path d="M12 3.8v10.8" /><path d="M7.4 10.4 12 15l4.6-4.6" /><path d="M4.5 18.6h15" /></>,
  cycle:     <><path d="M4.2 9.6A8 8 0 0 1 18.4 7" /><path d="M19.8 12.9A8 8 0 0 1 5.6 16" /><path d="M18.7 3.4v3.9h-3.9" /><path d="M5.3 20.6v-3.9h3.9" /></>,
  warn:      <><path d="M12 4.4 21 19.6H3z" /><path d="M12 10v4.2" /><path d="M12 17.1h.01" /></>,
  grid:      <><rect x="4" y="4" width="7" height="7" rx="1.4" /><rect x="13" y="4" width="7" height="7" rx="1.4" /><rect x="4" y="13" width="7" height="7" rx="1.4" /><rect x="13" y="13" width="7" height="7" rx="1.4" /></>,
  list:      <><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4.2 6h.01" /><path d="M4.2 12h.01" /><path d="M4.2 18h.01" /></>,
  expand:    <><path d="M14.4 3.6h6v6" /><path d="M20.4 3.6 13.2 10.8" /><path d="M9.6 20.4h-6v-6" /><path d="M3.6 20.4 10.8 13.2" /></>,
  arrowRight:<><path d="M4 12h15.5" /><path d="M13.4 5.6 19.8 12l-6.4 6.4" /></>,
  vault:     <><rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.4" /><circle cx="10.6" cy="12" r="3.6" /><path d="M10.6 8.4v7.2" /><path d="M7 12h7.2" /><path d="M17 9.4v5.2" /></>,
};

export default function Icon({ name, size = 16, className = "", style }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d}
    </svg>
  );
}
