import { Link } from "react-router-dom";
import { artistsOf } from "../lib/artists";
import { fmtDuration, safeUrl } from "../lib/fmt";
import { isYouTube } from "../lib/source";
import Icon from "./Icon";

// One wanted or skipped video: its thumbnail and title (to YouTube), its
// actions, and the button that drops the mark. `showChannel` adds the
// artist link(s) under the title, for lists that mix channels.
export default function MarkRow({ video: v, onRemoveMark, showChannel = false, children }) {
  const href = isYouTube(v) ? `https://www.youtube.com/watch?v=${v.video_id}` : safeUrl(v.url);
  return (
    <div className="mark-row">
      <a className="mark-thumb" href={href} target="_blank" rel="noreferrer" tabIndex={-1}>
        {isYouTube(v) && (
          <img src={`https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
        )}
        {v.duration_secs > 0 && <span className="dur-badge">{fmtDuration(v.duration_secs)}</span>}
      </a>
      <div className="mark-main">
        <a className="mark-title" href={href} target="_blank" rel="noreferrer">{v.title || v.video_id}</a>
        {(showChannel || v.duration_secs > 0) && (
          <div className="mark-sub">
            {showChannel && artistsOf(v).map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                <Link className="mark-channel" to={`/artist/${encodeURIComponent(a)}?tab=${v.status === "ignored" ? "skipped" : "wanted"}`}>{a}</Link>
              </span>
            ))}
            {v.duration_secs > 0 && <span className="mark-length">{fmtDuration(v.duration_secs)}</span>}
          </div>
        )}
      </div>
      <div className="mark-actions">
        {children}
        <button className="btn-ghost mark-remove" title="Remove the mark" onClick={() => onRemoveMark(v.video_id)}>
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  );
}
