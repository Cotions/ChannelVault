import { useState } from "react";
import { useDownloads, queueDownload, retryJob } from "../lib/downloads";
import Icon from "./Icon";

/* Download one YouTube video with the yt-dlp on this machine. Not shown when
   yt-dlp isn't installed; once queued it shows the job's state instead. */
export default function DownloadButton({ video, className = "btn-ghost" }) {
  const { installed, jobs } = useDownloads();
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState(null);
  if (!installed) return null;

  const job = jobs.find(j => j.video_id === video.video_id);

  async function start() {
    setBusy(true);
    setErr(null);
    const r = job?.status === "failed" || job?.status === "canceled"
      ? (await retryJob(job.id), { ok: true })
      : await queueDownload(video);
    setBusy(false);
    if (!r.ok) setErr(r.error || "Could not queue the download");
  }

  let label = "Download", icon = "download", title = "Download it into the library with yt-dlp", off = busy;
  if (job?.status === "queued")  { label = "Queued"; off = true; title = "Waiting for the download before it"; }
  if (job?.status === "running") {
    label = !job.progress ? "Starting…" : job.progress.finishing ? "Finishing…" : `${Math.floor(job.progress.percent)}%`;
    off = true; title = "Downloading";
  }
  if (job?.status === "done")    { label = "Downloaded"; icon = "check"; off = true; title = "In the library"; }
  if (job?.status === "failed")  { label = "Retry"; icon = "warn"; title = job.error || "The download failed"; }
  if (err) { icon = "warn"; title = err; }

  return (
    <button className={`${className} dl-btn${job?.status === "failed" || err ? " is-failed" : ""}`}
            disabled={off} onClick={start} title={title}>
      <Icon name={icon} size={13} />{label}
    </button>
  );
}
