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
  const { installed, jobs, prefs, paused } = useDownloads();
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
  if (job?.status === "queued")  {
    label = paused ? "Paused" : "Queued"; off = true;
    title = paused ? `Downloads are paused: resume them from the sidebar (${qualityLabel(job.quality)})`
                   : `Waiting for the download before it (${qualityLabel(job.quality)})`;
  }
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

// 0.4s under ten seconds, 12s after: tenths stop mattering once it's slow.
function fmtSecs(ms) {
  if (ms == null) return "";
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

function DownloadDialog({ video, def, onStart, onClose }) {
  const [sizes, setSizes] = useState("loading");   // "loading", { heights, audio } or { error }
  const [pick,  setPick]  = useState(def || "best");
  const [elapsed, setElapsed] = useState(0);          // ms since yt-dlp was asked
  const [took,    setTook]    = useState(null);       // ms it took to answer
  const downOnBackdrop = useRef(false);

  // Ask yt-dlp right away: the sizes are what the choice is about. A ticking
  // timer shows while it thinks, and how long it took once it answers.
  useEffect(() => {
    let live = true;
    const t0 = performance.now();
    setSizes("loading"); setElapsed(0); setTook(null);
    const tick = setInterval(() => { if (live) setElapsed(performance.now() - t0); }, 100);
    const done = r => { if (!live) return; clearInterval(tick); setTook(performance.now() - t0); setSizes(r); };
    getDownloadFormats(video.video_id).then(
      done,
      e => done({ error: e.detail || "Could not ask yt-dlp" }),
    );
    return () => { live = false; clearInterval(tick); };
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
          {sizes === "loading" && (
            <span className="dl-dialog-status is-loading">
              <span className="dl-dialog-spinner" />Checking sizes
              <span className="dl-dialog-timer">{fmtSecs(elapsed)}</span>
            </span>
          )}
          {sizes?.error && (
            <span className="dl-dialog-status is-bad" title={sizes.error}>
              Sizes unavailable <span className="dl-dialog-timer">{fmtSecs(took)}</span>
            </span>
          )}
          {sizes !== "loading" && !sizes?.error && !loaded && (
            <span className="dl-dialog-status" title="yt-dlp answered but listed no downloadable formats">
              No sizes listed <span className="dl-dialog-timer">{fmtSecs(took)}</span>
            </span>
          )}
          {loaded && took != null && (sizes.cached ? (
            <span className="dl-dialog-status is-done is-cached" title="Asked yt-dlp in the last 10 minutes; this is that answer">
              <Icon name="check" size={11} />Cached{sizes.took != null && <> · took <span className="dl-dialog-timer">{fmtSecs(sizes.took * 1000)}</span></>}
            </span>
          ) : (
            <span className="dl-dialog-status is-done" title="How long yt-dlp took to list this video's formats">
              <Icon name="check" size={11} />Sizes in <span className="dl-dialog-timer">{fmtSecs(took)}</span>
            </span>
          ))}
        </div>
        <div className={`dl-dialog-sweep${sizes === "loading" ? " is-on" : ""}`} />
        <div className={`dl-dialog-options${loaded ? " is-loaded" : ""}`} role="radiogroup">
          {options.map((o, i) => (
            <label key={o.q} className={`dl-option${o.q === chosen ? " is-on" : ""}`}>
              <input type="radio" name="dl-quality" value={o.q} checked={o.q === chosen} onChange={() => setPick(o.q)} />
              <span className="dl-option-name">{o.name}</span>
              {o.q === def && <span className="dl-menu-def">default</span>}
              {o.note && (
                <span key={loaded ? "real" : "guess"} className="dl-option-note" style={loaded ? { animationDelay: `${i * 35}ms` } : undefined}>
                  {o.note}
                </span>
              )}
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
