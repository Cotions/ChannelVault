// Where a library entry comes from. Everything is YouTube unless the file was
// tagged with another site's link (Twitch VOD, Facebook clip...) or none at all.
const LABELS = { youtube: "YouTube", twitch: "Twitch", facebook: "Facebook", local: "Local" };

export const isYouTube = v => (v?.source || "youtube") === "youtube";

export function sourceLabel(source) {
  const s = source || "youtube";
  return LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);
}

export function isYouTubeUrl(u) {
  return /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be)\b/i.test(u || "");
}
