/* Recognise which site a creator's About-panel link points at, so the profile
   can show an Instagram link as Instagram instead of a bare URL. The colour is
   the brand's, toned to read on the dark surface; SocialIcon draws the glyph. */

const PLATFORMS = [
  { key: "instagram", label: "Instagram", color: "#e1306c", hosts: ["instagram.com", "instagr.am"] },
  { key: "tiktok",    label: "TikTok",    color: "#25f4ee", hosts: ["tiktok.com"] },
  { key: "x",         label: "X",         color: "#e7e9ea", hosts: ["x.com", "twitter.com"] },
  { key: "twitch",    label: "Twitch",    color: "#a970ff", hosts: ["twitch.tv"] },
  { key: "patreon",   label: "Patreon",   color: "#f96854", hosts: ["patreon.com"] },
  { key: "youtube",   label: "YouTube",   color: "#ff4e45", hosts: ["youtube.com", "youtu.be"] },
  { key: "discord",   label: "Discord",   color: "#7d8ff0", hosts: ["discord.gg", "discord.com"], opaque: true },
  { key: "facebook",  label: "Facebook",  color: "#4c8bf5", hosts: ["facebook.com", "fb.com"] },
  { key: "spotify",   label: "Spotify",   color: "#1db954", hosts: ["spotify.com"], opaque: true },
  { key: "kofi",      label: "Ko-fi",     color: "#29abe0", hosts: ["ko-fi.com"] },
  { key: "bluesky",   label: "Bluesky",   color: "#3d9bff", hosts: ["bsky.app"] },
  { key: "telegram",  label: "Telegram",  color: "#2aabee", hosts: ["t.me", "telegram.me"] },
  { key: "paypal",    label: "PayPal",    color: "#4f8fe6", hosts: ["paypal.me", "paypal.com"] },
  { key: "linktree",  label: "Linktree",  color: "#43e660", hosts: ["linktr.ee"] },
];

const WEBSITE = { key: "website", label: "Website", color: null };

/* { key, label, color, detail } for one link. `detail` is the account name for
   a known platform (first path segment, "@" dropped), null where the path holds
   no name, or the bare host for any other site. */
export function describeLink(url) {
  let u;
  try { u = new URL(url); } catch { return { ...WEBSITE, detail: url }; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|open)\./, "");
  const p = PLATFORMS.find(pl => pl.hosts.some(h => host === h || host.endsWith(`.${h}`)));
  if (!p) return { ...WEBSITE, detail: host };
  // Spotify and Discord paths are IDs and invite codes, not names.
  if (p.opaque) return { key: p.key, label: p.label, color: p.color, detail: null };
  const segs = u.pathname.split("/").filter(Boolean);
  // Paths like /c/<name>, /user/<name>, /invite/<code> carry the name second.
  const seg = ["c", "user", "channel", "invite", "profile", "artist", "paypalme"].includes(segs[0]?.toLowerCase()) ? segs[1] : segs[0];
  const detail = seg ? decodeURIComponent(seg).replace(/^@/, "") : host;
  return { key: p.key, label: p.label, color: p.color, detail };
}
