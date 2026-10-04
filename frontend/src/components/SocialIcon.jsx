/* Platform glyphs for creator links, keyed by describeLink()'s `key`. Drawn in
   the same stroke style as Icon.jsx, tinted with the brand colour. */

const GLYPHS = {
  instagram: <><rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.6" /><circle cx="12" cy="12" r="3.8" /><path d="M16.9 7.1h.01" /></>,
  tiktok:    <><path d="M13.6 3.5v11.4a3.6 3.6 0 1 1-3.6-3.6" /><path d="M13.6 3.5c.4 2.6 2.3 4.5 5 4.7" /></>,
  x:         <><path d="M4.5 4h4.2l10.8 16h-4.2z" /><path d="M19 4l-6.1 6.9" /><path d="M11.1 13.1 5 20" /></>,
  twitch:    <><path d="M5 3.5h15v10.2l-4.3 4.3h-3.6L9 21v-3H5z" /><path d="M11 8v4" /><path d="M15.5 8v4" /></>,
  patreon:   <><circle cx="14.5" cy="9.5" r="5.5" /><path d="M5 3.8v16.4" /></>,
  youtube:   <><rect x="2.8" y="5.5" width="18.4" height="13" rx="4" /><path d="M10 9.2v5.6l4.8-2.8z" /></>,
  discord:   <><path d="M7.5 6.5a14 14 0 0 1 9 0c1.8 2.6 2.8 5.4 3 8.7-1.6 1.3-3.2 2.1-4.8 2.5l-1-1.7" /><path d="M9.3 16l-1 1.7c-1.6-.4-3.2-1.2-4.8-2.5.2-3.3 1.2-6.1 3-8.7" /><path d="M8.2 15.2c2.4 1 5.2 1 7.6 0" /><circle cx="9.5" cy="12" r="1" /><circle cx="14.5" cy="12" r="1" /></>,
  facebook:  <><path d="M14.5 20.5V13h2.6l.4-3h-3V8.3c0-.9.3-1.5 1.6-1.5h1.5V4.1a19 19 0 0 0-2.3-.1c-2.3 0-3.8 1.4-3.8 3.9V10H9v3h2.5v7.5" /></>,
  spotify:   <><circle cx="12" cy="12" r="8.5" /><path d="M7.5 9.6c3-1 6.6-.8 9.3.8" /><path d="M8 12.6c2.5-.8 5.2-.6 7.4.7" /><path d="M8.6 15.4c1.9-.5 3.8-.4 5.4.5" /></>,
  kofi:      <><path d="M4.5 8h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" /><path d="M16.5 9.5h1.3a2.5 2.5 0 0 1 0 5h-1.5" /></>,
  bluesky:   <><path d="M12 11c-1.5-3-4.6-6.2-7-6.5-.8 0-1 1-.5 4 .5 2.6 2.5 3.3 4.5 3-2.5.6-3.3 2.4-1.5 4 2 1.7 3.5-.6 4.5-3 1 2.4 2.5 4.7 4.5 3 1.8-1.6 1-3.4-1.5-4 2 .3 4-.4 4.5-3 .5-3 .3-4-.5-4-2.4.3-5.5 3.5-7 6.5z" /></>,
  telegram:  <><path d="M20.5 4.2 3.5 11l6 2.2L18 7.2l-6.6 7.6 6.1 5z" /><path d="M9.5 13.2V19l2.6-2.7" /></>,
  paypal:    <><path d="M7.5 20.5 10 4h6a4 4 0 0 1 0 8h-4.5l-1.2 8.5z" /><path d="M10.5 16.5h-1" /></>,
  linktree:  <><path d="M12 3.5v6.5" /><path d="M12 13v7.5" /><path d="M5 7l7 4 7-4" /><path d="M5.5 15.5 12 11.5l6.5 4" /></>,
  website:   <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z" /></>,
  email:     <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M3.8 7.2 12 13l8.2-5.8" /></>,
};

export default function SocialIcon({ name, size = 14, color }) {
  const d = GLYPHS[name] || GLYPHS.website;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
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
