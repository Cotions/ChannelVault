import { useEffect, useRef, useState } from "react";
import { useDownloads, isActive, cancelJob, retryJob, clearJobs, qualityLabel } from "../lib/downloads";
import Icon from "./Icon";

function statusLine(j, paused) {
  const line = j.status === "queued" && paused ? "Paused" : status(j);
  // What it asked for, while that still matters; "auto": the feed queued it.
  return isActive(j) ? [line, qualityLabel(j.quality || "best"), j.auto && "auto"].filter(Boolean).join("  ·  ") : line;
}

function status(j) {
  if (j.status === "running") {
    const p = j.progress;
    if (!p) return "Starting…";
    if (p.finishing) return "Finishing…";
    return [`${p.percent.toFixed(1)}%`, p.speed, p.eta && `${p.eta} left`].filter(Boolean).join("  ");
  }
  if (j.status === "queued")   return "Queued";
  if (j.status === "done")     return j.error || "In the library";
  if (j.status === "canceled") return "Canceled";
  return j.error || "Failed";
}

/* Header indicator for the download queue. Only there while something is
   queued, running or failed (or the list is open): an idle queue shows nothing. */
export default function DownloadQueue() {
  const { jobs, paused } = useDownloads();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e)  { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const active  = jobs.filter(isActive);
  const failed  = jobs.filter(j => j.status === "failed");
  const running = jobs.find(j => j.status === "running");
  if (!active.length && !failed.length && !open) return null;

  const label = running?.progress ? `${Math.floor(running.progress.percent)}%` : active.length ? String(active.length) : String(failed.length);
  const finished = jobs.some(j => !isActive(j));

  return (
    <div className="tag-select dl-queue" ref={wrapRef}>
      <button
        type="button"
        className={`tag-select-btn${open ? " is-open" : ""}${!active.length && failed.length ? " is-failed" : ""}`}
        onClick={() => setOpen(v => !v)}
        title={active.length ? `${active.length} download${active.length !== 1 ? "s" : ""} in progress` : `${failed.length} download${failed.length !== 1 ? "s" : ""} failed`}
      >
        <Icon name={!active.length && failed.length ? "warn" : "download"} size={13} />
        <span className="dl-queue-num">{label}</span>
      </button>

      {open && (
        <div className="tag-select-menu dl-queue-menu">
          {jobs.length === 0 ? <div className="dl-queue-empty">No downloads.</div> : (
            <div className="dl-queue-list">
              {jobs.map(j => (
                <div key={j.id} className={`dl-job is-${j.status}${j.status === "done" && j.error ? " has-warning" : ""}`}>
                  <div className="dl-job-main">
                    <a className="dl-job-title" href={`https://www.youtube.com/watch?v=${j.video_id}`} target="_blank" rel="noreferrer">
                      {j.title || j.video_id}
                    </a>
                    <div className="dl-job-status" title={statusLine(j, paused)}>{statusLine(j, paused)}</div>
                    {j.status === "running" && (
                      <div className="dl-job-bar"><span style={{ width: `${j.progress?.percent || 0}%` }} /></div>
                    )}
                  </div>
                  {isActive(j) && (
                    <button className="del-btn" title="Cancel" onClick={() => cancelJob(j.id)}><Icon name="close" /></button>
                  )}
                  {(j.status === "failed" || j.status === "canceled") && (
                    <button className="del-btn" title="Retry" onClick={() => retryJob(j.id)}><Icon name="refresh" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
          {finished && (
            <button type="button" className="btn-ghost dl-queue-clear" onClick={clearJobs}
                    title="Forget finished, canceled and failed downloads">
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}
