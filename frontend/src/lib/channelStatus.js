// Marks the user can put on a channel that stopped being active. Only the
// `gone` ones are off YouTube; an abandoned channel is still up.
export const CHANNEL_STATUS = {
  abandoned: { label: "Abandoned", hint: "Still up, but the creator stopped uploading", gone: false },
  deleted: { label: "Deleted", hint: "The creator took the channel down", gone: true },
  banned:  { label: "Banned",  hint: "YouTube terminated the channel", gone: true },
};

// marked_at is SQLite's CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) from the
// server, or an ISO string set locally right after marking.
export function markedOn(markedAt) {
  if (!markedAt) return null;
  const d = new Date(markedAt.includes("T") ? markedAt : `${markedAt.replace(" ", "T")}Z`);
  return isNaN(d) ? null : d.toLocaleDateString();
}
