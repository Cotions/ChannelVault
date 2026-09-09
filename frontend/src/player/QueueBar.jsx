import { Link } from "react-router-dom";
import { usePlayer } from "./playerContext";
import { usePlaybackTime } from "./usePlaybackTime";
import { fmtTime } from "../lib/fmt";
import TagChip from "../components/TagChip";
import Icon from "../components/Icon";

/* Transport for segment play mode: where we are in the queue, what is playing,
   how far through this item, and prev / next / shuffle / loop / stop. Rendered
   under the player on the video page and inside the mini player elsewhere. */
export default function QueueBar({ compact = false }) {
  const player = usePlayer();
  const { queue, queueNext, queuePrev, toggleShuffle, toggleLoop, clearQueue } = player;
  const { time } = usePlaybackTime(player.videoRef, player.activeId);
  if (!queue) return null;

  const item  = queue.items[queue.idx];
  const total = queue.items.length;
  const span  = item.end_secs != null ? Math.max(0.1, item.end_secs - item.start_secs) : null;
  const frac  = span ? Math.min(1, Math.max(0, (time - item.start_secs) / span)) : 0;
  const tag   = queue.meta?.tagName ? { id: queue.meta.tagId, name: queue.meta.tagName, color: queue.meta.color } : null;

  return (
    <div className={`queue-bar${compact ? " queue-bar-compact" : ""}`}>
      <div className="queue-bar-progress" style={{ width: `${frac * 100}%` }} />
      <span className="queue-pos" title="Segment in the queue">{queue.idx + 1}<span className="queue-pos-sep">/</span>{total}</span>
      {tag && <TagChip tag={tag} size="sm" link={tag.id != null} />}
      <Link to={`/video/${item.video_id}`} className="queue-title" title={item.video_title || item.video_id}>
        {item.title ? <><span className="queue-seg-title">{item.title}</span><span className="queue-sep">·</span></> : null}
        <span className="queue-video-title">{item.video_title || item.video_id}</span>
      </Link>
      <span className="queue-range">
        {fmtTime(item.start_secs)}<span className="queue-sep">→</span>{item.end_secs != null ? fmtTime(item.end_secs) : "end"}
      </span>
      <span className="queue-controls">
        <button className="cv-mini-btn" onClick={queuePrev} title="Previous segment"><Icon name="skipBack" size={14} /></button>
        <button className="cv-mini-btn" onClick={queueNext} title="Next segment"><Icon name="skipFwd" size={14} /></button>
        <button className={`cv-mini-btn${queue.shuffle ? " is-on" : ""}`} onClick={toggleShuffle} title={queue.shuffle ? "Shuffle on" : "Shuffle off"}><Icon name="shuffle" size={14} /></button>
        <button className={`cv-mini-btn${queue.loop ? " is-on" : ""}`} onClick={toggleLoop} title={queue.loop ? "Loop on" : "Loop off"}><Icon name="repeat" size={14} /></button>
        <button className="cv-mini-btn" onClick={clearQueue} title="Stop segment play (keeps the video playing)"><Icon name="close" size={14} /></button>
      </span>
    </div>
  );
}
