import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDownloads, queueDownload, retryJob, prefFor, QUALITIES, qualityLabel, formatSize } from "../lib/downloads";
import { getDownloadFormats } from "../lib/api";
import { artistsOf } from "../lib/artists";
import { fmtDuration } from "../lib/fmt";
import Icon from "./Icon";

/* Download one YouTube video with the yt-dlp on this machine. Not shown when
   yt-dlp isn't installed; once queued it shows the job's state instead.
   The button opens a dialog to pick the quality (the creator's default is
   preselected, and yt-dlp is asked what this video really has); nothing
   starts until the dialog's Download is clicked. A failed job retries as is. */
export default function DownloadButton({ video, className = "btn-ghost" }) {
  const { installed, jobs, prefs } = useDownloads();
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState(null);
  const [open, setOpen] = useState(false);

  if (!installed) return null;

  const job = jobs.find(j => j.video_id === video.video_id);
  // A collab credit ("A, B"): the first of them with a setting of their own.
  const def = prefFor(prefs, [video.channel_name, ...artistsOf(video)].find(n => prefs[n])).quality;

  async function start(quality) {
    setOpen(false);
    setBusy(true);
    setErr(null);
    const r = await queueDownload(video, quality);
    setBusy(false);
    if (!r.ok) setErr(r.error || "Could not queue the download");
  }

  async function retry() {
    setBusy(true);
    setErr(null);
    await retryJob(job.id);
    setBusy(false);
  }

  let label = "Download", icon = "download", off = busy;
  let title = "Pick a quality and download it into the library with yt-dlp";
  if (job?.status === "queued")  { label = "Queued"; off = true; title = `Waiting for the download before it (${qualityLabel(job.quality)})`; }
  if (job?.status === "running") {
    label = !job.progress ? "Starting…" : job.progress.finishing ? "Finishing…" : `${Math.floor(job.progress.percent)}%`;
    off = true; title = `Downloading (${qualityLabel(job.quality)})`;
  }
  if (job?.status === "done")    { label = "Downloaded"; icon = "check"; off = true; title = "In the library"; }
  if (job?.status === "failed")  { label = "Retry"; icon = "warn"; title = `${job.error || "The download failed"} — click to try again (${qualityLabel(job.quality)})`; }
  if (err) { icon = "warn"; title = err; }

  return (
    <>
      <button className={`${className} dl-btn${job?.status === "failed" || err ? " is-failed" : ""}`}
              disabled={off} onClick={() => (job?.status === "failed" ? retry() : setOpen(true))} title={title}>
        <Icon name={icon} size={13} />{label}
      </button>
      {open && createPortal(
        <DownloadDialog video={video} def={def} onStart={start} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}

// What "Best" gives for this video: its biggest picture, 1080p at most when
// the video has more (above that YouTube has no H.264).
function bestNote(heights) {
  const top = Math.max(0, ...(heights || []).map(h => h.height));
  return top ? `${Math.min(top, 1080)}p` : "";
}

function DownloadDialog({ video, def, onStart, onClose }) {
  const [sizes, setSizes] = useState("loading");   // "loading", { heights, audio } or { error }
  const [pick,  setPick]  = useState(def || "best");
  const downOnBackdrop = useRef(false);

  // Ask yt-dlp right away: the sizes are what the choice is about.
  useEffect(() => {
    let live = true;
    getDownloadFormats(video.video_id).then(
      r => { if (live) setSizes(r); },
      e => { if (live) setSizes({ error: e.detail || "Could not ask yt-dlp" }); },
    );
    return () => { live = false; };
  }, [video.video_id]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loaded = sizes && sizes !== "loading" && !sizes.error && (sizes.heights?.length || sizes.audio);
  const options = loaded
    ? [{ q: "best", name: qualityLabel("best"), note: bestNote(sizes.heights) },
       ...sizes.heights.map(h => ({
        q: String(h.height),
        name: `${h.height}p${h.fps && h.fps > 30 ? h.fps : ""}`,
        note: [h.codec, formatSize(h.size)].filter(Boolean).join(" · "),
      })),
      ...(sizes.audio ? [{ q: "audio", name: "Audio only",
                           note: [sizes.audio.abr && `${sizes.audio.abr} kbps`, formatSize(sizes.audio.size)].filter(Boolean).join(" · ") }] : [])]
    : QUALITIES.map(q => ({ q, name: qualityLabel(q), note: q === "best" ? "usually 1080p" : /^\d+$/.test(q) ? `the biggest picture up to ${q}p` : "" }));

  // yt-dlp's answer, else what the userscript saw when it was marked.
  const length = (loaded && sizes.duration) || video.duration_secs || null;

  // The default may not exist for this video (a 1080p cap on a 720p upload).
  const chosen = options.some(o => o.q === pick) ? pick : "best";

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <form className="modal dl-dialog" onSubmit={e => { e.preventDefault(); onStart(chosen); }}>
        <div className="modal-header">
          <span className="modal-title">Download</span>
          <button type="button" className="modal-close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="dl-dialog-video">
          <img src={`https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" />
          <div className="dl-dialog-meta">
            <div className="dl-dialog-title">{video.title || video.video_id}</div>
            {(video.channel_name || length) && (
              <div className="dl-dialog-channel">
                {[video.channel_name, length && fmtDuration(length)].filter(Boolean).join("  ·  ")}
              </div>
            )}
          </div>
        </div>

        <div className="dl-dialog-head">
          Quality
          {sizes === "loading" && <span className="dl-dialog-status">Checking sizes…</span>}
          {sizes?.error && <span className="dl-dialog-status is-bad" title={sizes.error}>Sizes unavailable</span>}
        </div>
        <div className="dl-dialog-options" role="radiogroup">
          {options.map(o => (
            <label key={o.q} className={`dl-option${o.q === chosen ? " is-on" : ""}`}>
              <input type="radio" name="dl-quality" value={o.q} checked={o.q === chosen} onChange={() => setPick(o.q)} />
              <span className="dl-option-name">{o.name}</span>
              {o.q === def && <span className="dl-menu-def">default</span>}
              {o.note && <span className="dl-option-note">{o.note}</span>}
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" autoFocus>
            <Icon name="download" size={13} />Download {qualityLabel(chosen)}
          </button>
        </div>
      </form>
    </div>
  );
}
