import { useMemo } from "react";
import { fmtTime } from "../lib/fmt";

/* Overlapping ranges go on separate lanes so nothing hides behind anything.
   Greedy interval partitioning: sorted by start, each range takes the first
   lane whose last range ended before this one begins. */
function assignLanes(segments) {
  const sorted = [...segments].sort((a, b) => a.start_secs - b.start_secs || a.end_secs - b.end_secs);
  const laneEnds = [];
  const placed = sorted.map(s => {
    let lane = laneEnds.findIndex(end => end <= s.start_secs);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = s.end_secs;
    return { ...s, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

export default function SegmentTimeline({ segments = [], duration = 0, time = 0, onSeek, selectedId, onSelect }) {
  const { placed, lanes } = useMemo(() => assignLanes(segments), [segments]);
  const total = duration > 0 ? duration : Math.max(0, ...segments.map(s => s.end_secs));
  if (!total) return null;
  const pct = v => `${Math.min(100, Math.max(0, (v / total) * 100))}%`;

  function seekFromTrack(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek?.(Math.max(0, Math.min(total, frac * total)));
  }

  return (
    <div className="seg-timeline" style={{ "--lanes": lanes }}>
      <div className="seg-track" onClick={seekFromTrack} role="presentation">
        {placed.map(s => {
          const color = s.tags?.[0]?.color;
          const label = [fmtTime(s.start_secs) + " → " + fmtTime(s.end_secs), s.title, s.tags?.map(t => t.name).join(", ")]
            .filter(Boolean).join("\n");
          return (
            <button
              key={s.id}
              type="button"
              className={`seg-block${s.id === selectedId ? " is-selected" : ""}${color ? "" : " is-untagged"}`}
              style={{
                left: pct(s.start_secs),
                width: `calc(${pct(s.end_secs - s.start_secs)} - 2px)`,
                top: `calc(${s.lane} * var(--lane-h))`,
                ...(color ? { background: `${color}55`, borderColor: `${color}aa` } : {}),
              }}
              title={label}
              onClick={e => { e.stopPropagation(); onSelect?.(s.id); onSeek?.(s.start_secs); }}
            >
              <span className="seg-block-title">{s.title || (s.tags?.[0]?.name ?? "")}</span>
            </button>
          );
        })}
        <div className="seg-playhead" style={{ left: pct(time) }} />
      </div>
      <div className="seg-scale">
        <span>{fmtTime(0)}</span>
        <span className="seg-scale-now">{fmtTime(time)}</span>
        <span>{fmtTime(total)}</span>
      </div>
    </div>
  );
}
