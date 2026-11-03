import { useMemo, useState } from "react";
import { MODES, RECENT_DAYS, pickRediscover, rediscoverReason, eligible } from "../lib/rediscover";
import { usePlayer } from "../player/playerContext";
import VideoCard from "./VideoCard";
import Icon from "./Icon";

const COUNT = 5;

// Picks survive navigation within the session, so coming back to the tab shows
// the same ones until the user asks for others.
const mem = { mode: "mix", roll: 0, ids: null };

/* A few library videos worth another look, on its own Rediscover tab. */
export default function Rediscover({ videos, cardProps }) {
  const { playQueue } = usePlayer();
  const [mode, setMode] = useState(mem.mode);
  const [roll, setRoll] = useState(mem.roll);

  const picks = useMemo(() => {
    const byId = new Map(videos.map(v => [v.video_id, v]));
    const kept = mem.ids?.map(id => byId.get(id)).filter(v => v && eligible(v, mode));
    // The remembered set stays until a reroll, a mode change, or one of its
    // videos leaving the library or being watched since.
    if (kept?.length && kept.length === mem.ids.length && mem.roll === roll && mem.mode === mode) return kept;
    const out = pickRediscover(videos, mode, COUNT);
    Object.assign(mem, { mode, roll, ids: out.map(v => v.video_id) });
    return out;
  }, [videos, mode, roll]);

  function playAll() {
    playQueue(
      picks.map(v => ({ video_id: v.video_id, video_title: v.title, start_secs: 0, end_secs: null, title: null })),
      { tagName: "Rediscover" },
    );
  }

  if (!videos.length) return null;

  return (
    <div className="card rediscover">
      <div className="page-head">
        <h2 className="page-title"><Icon name="sparkle" size={16} />Rediscover</h2>
        <div className="rediscover-modes" role="tablist">
          {MODES.map(m => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`rediscover-mode${mode === m.id ? " is-on" : ""}`}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="page-head-spacer" />
        <button className="btn-ghost" onClick={() => setRoll(r => r + 1)} title="Pick others">
          <Icon name="refresh" size={13} />Others
        </button>
        <button className="btn-secondary" onClick={playAll} disabled={!picks.length} title="Play these one after another">
          <Icon name="play" size={13} />Play all
        </button>
      </div>
      {picks.length === 0 ? (
        <div className="empty">
          {mode === "favorites" ? `No favorites left alone for more than ${RECENT_DAYS} days yet.`
            : mode === "unwatched" ? "You have watched everything. Impressive."
            : "Nothing to rediscover yet."}
        </div>
      ) : (
        <div className="video-grid rediscover-grid">
          {picks.map((v, i) => (
            <div key={v.video_id} className="rediscover-item" style={{ animationDelay: `${i * 60}ms` }}>
              <VideoCard video={v} {...cardProps} />
              <div className="rediscover-why">{rediscoverReason(v)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
