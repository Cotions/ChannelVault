import { useEffect, useRef, useState } from "react";
import { useDownloads, queueDownload, retryJob, prefFor, QUALITIES, qualityLabel, formatSize } from "../lib/downloads";
import { getDownloadFormats } from "../lib/api";
import { artistsOf } from "../lib/artists";
import Icon from "./Icon";

/* Download one YouTube video with the yt-dlp on this machine. Not shown when
   yt-dlp isn't installed; once queued it shows the job's state instead.
   The button uses the creator's default quality; the arrow beside it picks
   another one, and "Check sizes" asks yt-dlp what this video really has. */
export default function DownloadButton({ video, className = "btn-ghost" }) {
  const { installed, jobs, prefs } = useDownloads();
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState(null);
  const [open, setOpen] = useState(false);
  const [sizes, setSizes] = useState(null);       // null, "loading", { heights, audio } or { error }
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e)  { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!installed) return null;

  const job = jobs.find(j => j.video_id === video.video_id);
  // A collab credit ("A, B"): the first of them with a setting of their own.
  const def = prefFor(prefs, [video.channel_name, ...artistsOf(video)].find(n => prefs[n])).quality;

  async function start(quality) {
    setOpen(false);
    setBusy(true);
    setErr(null);
    const r = !quality && (job?.status === "failed" || job?.status === "canceled")
      ? (await retryJob(job.id), { ok: true })
      : await queueDownload(video, quality);
    setBusy(false);
    if (!r.ok) setErr(r.error || "Could not queue the download");
  }

  async function checkSizes() {
    setSizes("loading");
    try {
      setSizes(await getDownloadFormats(video.video_id));
    } catch (e) {
      setSizes({ error: e.detail || "Could not ask yt-dlp" });
    }
  }

  let label = "Download", icon = "download", off = busy;
  let title = `Download it into the library with yt-dlp (${qualityLabel(job?.quality || def)})`;
  if (job?.status === "queued")  { label = "Queued"; off = true; title = `Waiting for the download before it (${qualityLabel(job.quality)})`; }
  if (job?.status === "running") {
    label = !job.progress ? "Starting…" : job.progress.finishing ? "Finishing…" : `${Math.floor(job.progress.percent)}%`;
    off = true; title = `Downloading (${qualityLabel(job.quality)})`;
  }
  if (job?.status === "done")    { label = "Downloaded"; icon = "check"; off = true; title = "In the library"; }
  if (job?.status === "failed")  { label = "Retry"; icon = "warn"; title = job.error || "The download failed"; }
  if (err) { icon = "warn"; title = err; }

  const loaded = sizes && sizes !== "loading" && !sizes.error && (sizes.heights?.length || sizes.audio);
  const options = loaded
    ? [{ q: "best", name: qualityLabel("best"), note: "" },
       ...sizes.heights.map(h => ({
        q: String(h.height),
        name: `${h.height}p${h.fps && h.fps > 30 ? h.fps : ""}`,
        note: [h.codec, formatSize(h.size)].filter(Boolean).join(" · "),
      })),
      ...(sizes.audio ? [{ q: "audio", name: "Audio only",
                           note: [sizes.audio.abr && `${sizes.audio.abr} kbps`, formatSize(sizes.audio.size)].filter(Boolean).join(" · ") }] : [])]
    : QUALITIES.map(q => ({ q, name: qualityLabel(q), note: q === "best" ? "usually 1080p" : "" }));

  return (
    <span className={`dl-split${off ? "" : " can-pick"}`} ref={wrapRef}>
      <button className={`${className} dl-btn${job?.status === "failed" || err ? " is-failed" : ""}`}
              disabled={off} onClick={() => start()} title={title}>
        <Icon name={icon} size={13} />{label}
      </button>
      {!off && (
        <button className={`${className} dl-pick${open ? " is-open" : ""}`} onClick={() => setOpen(v => !v)}
                title="Pick the quality">
          <span className="dl-caret" />
        </button>
      )}
      {open && !off && (
        <div className="tag-select-menu dl-menu">
          <div className="tag-select-list">
            {options.map(o => (
              <button key={o.q} type="button" className={`tag-select-option${o.q === def ? " is-on" : ""}`}
                      onClick={() => start(o.q)}
                      title={/^\d+$/.test(o.q) && !loaded ? `The biggest picture up to ${o.q}p` : undefined}>
                <span className="tag-select-name">{o.name}</span>
                {o.q === def && <span className="dl-menu-def">default</span>}
                {o.note && <span className="tag-select-n">{o.note}</span>}
              </button>
            ))}
          </div>
          {sizes?.error && <div className="dl-menu-err">{sizes.error}</div>}
          {!loaded && (
            <button type="button" className="tag-select-clear" disabled={sizes === "loading"} onClick={checkSizes}
                    title="Ask yt-dlp which qualities this video has and how big each is">
              {sizes === "loading" ? "Checking…" : "Check sizes"}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
