// A video's channel_name may carry a collab credit as a comma-separated list
// under each collaborating artist instead of a single combined pseudo-artist.
export function artistsOf(video) {
  const raw = (video?.channel_name || "").trim();
  if (!raw) return ["Unknown"];
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : ["Unknown"];
}
