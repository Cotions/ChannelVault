import { useDownloads, cancelJob, pauseQueue, resumeQueue, qualityLabel } from "../lib/downloads";
import Icon from "./Icon";

const UP_NEXT = 4;     // queued downloads listed by name; the rest are counted

// The sidebar is narrow: "Best" rather than "Best H.264".
const shortQuality = q => (!q || q === "best" ? "Best" : qualityLabel(q).replace(/ \(2K\)$/, ""));

/* The download queue at the foot of the sidebar: the running download with
   its bar, size, speed and time left, then what's queued after it. Only
   there while something is queued or running.

   Pause stops the running download midway (it resumes from where it got
   to) and starts nothing after it; "Pause after this one" lets it finish
   first. Paused while one is still running means exactly that. */
export default function SideDownloads() {
  const { jobs, paused } = useDownloads();
  const running = jobs.find(j => j.status === "running");
  // The worker takes the oldest queued job first.
  const queued = jobs.filter(j => j.status === "queued")
    .sort((a, b) => (a.added_at || "").localeCompare(b.added_at || "") || a.id - b.id);
  if (!running && !queued.length) return null;

  const p = running?.progress;
  const pct = p ? Math.min(100, Math.max(0, p.percent)) : 0;
  const total = queued.length + (running ? 1 : 0);

  return (
    <div className="side-dl">
      <div className="side-dl-head">
        <Icon name="download" size={12} />Downloads
        <span className="side-dl-count">{total}</span>
        {paused ? (
          <button className="side-dl-x side-dl-toggle" title="Resume downloads" onClick={resumeQueue}>
            <Icon name="play" size={11} />
          </button>
        ) : (
          <button className="side-dl-x side-dl-toggle" title="Pause downloads: stops this one midway (it picks up where it left off) and holds the rest"
                  onClick={() => pauseQueue(true)}>
            <Icon name="pause" size={11} />
          </button>
        )}
      </div>

      {running && (
        <div className="side-dl-now">
          <div className="side-dl-top">
            <a className="side-dl-title" href={`https://www.youtube.com/watch?v=${running.video_id}`}
               target="_blank" rel="noreferrer" title={running.title || running.video_id}>
              {running.title || running.video_id}
            </a>
            <button className="side-dl-x" title="Cancel this download" onClick={() => cancelJob(running.id)}>
              <Icon name="close" size={11} />
            </button>
          </div>
          <div className={`side-dl-bar${!p || p.finishing ? " is-busy" : ""}`}>
            <span style={{ width: `${p && !p.finishing ? pct : 100}%` }} />
          </div>
          <div className="side-dl-stats">
            {!p ? <span>Starting…</span> : p.finishing ? <span>Finishing…</span> : (
              <>
                <span className="side-dl-pct">{pct.toFixed(1)}%</span>
                {p.speed && <span>{p.speed}</span>}
                {p.eta && <span>{p.eta} left</span>}
              </>
            )}
          </div>
          {p && !p.finishing && (p.downloaded || p.total || p.stream) && (
            <div className="side-dl-stats side-dl-size">
              {(p.downloaded || p.total) && <span>{[p.downloaded, p.total].filter(Boolean).join(" / ")}</span>}
              {p.stream && <span>{p.stream === "audio" ? "sound" : "picture"}</span>}
              <span>{shortQuality(running.quality)}</span>
            </div>
          )}
          {paused ? (
            <div className="side-dl-hold">
              Queue stops after this one
              <button className="side-dl-link" onClick={() => pauseQueue(true)} title="Stop it now too; it picks up where it left off">Pause now</button>
            </div>
          ) : queued.length > 0 && (
            <div className="side-dl-hold">
              <button className="side-dl-link" onClick={() => pauseQueue(false)} title="Let this one finish, then start nothing else">
                Pause after this one
              </button>
            </div>
          )}
        </div>
      )}

      {queued.length > 0 && (
        <div className="side-dl-next">
          <div className="side-dl-label">{paused && !running ? "Paused" : "Up next"}</div>
          {queued.slice(0, UP_NEXT).map(j => (
            <div key={j.id} className="side-dl-item">
              <span className="side-dl-item-title" title={j.title || j.video_id}>{j.title || j.video_id}</span>
              <span className="side-dl-q">{shortQuality(j.quality)}</span>
              <button className="side-dl-x" title="Remove from the queue" onClick={() => cancelJob(j.id)}>
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
          {queued.length > UP_NEXT && <div className="side-dl-more">+{queued.length - UP_NEXT} more</div>}
        </div>
      )}
    </div>
  );
}
