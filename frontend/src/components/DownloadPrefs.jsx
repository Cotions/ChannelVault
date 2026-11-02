import { useEffect, useRef, useState } from "react";
import { useDownloads, prefFor, savePref, QUALITIES, qualityLabel } from "../lib/downloads";
import Icon from "./Icon";

/* One creator's download settings: the quality their Download buttons use
   (and the userscript's), and whether new uploads download on their own.
   Not shown when yt-dlp isn't installed. */
export default function DownloadPrefs({ artist }) {
  const { installed, prefs } = useDownloads();
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

  if (!installed) return null;
  const pref = prefFor(prefs, artist);
  const custom = pref.quality !== "best" || pref.auto;

  return (
    <div className="tag-select dl-prefs" ref={wrapRef}>
      <button
        className={custom ? "feed-follow-chip dl-prefs-chip" : "artist-link-add"}
        onClick={() => setOpen(v => !v)}
        title="The quality Download uses for this creator, and auto-download of new uploads"
      >
        <Icon name="download" size={12} />
        {custom ? [qualityLabel(pref.quality), pref.auto && "auto"].filter(Boolean).join(" · ") : "Download quality"}
      </button>
      {open && (
        <div className="tag-select-menu dl-menu dl-prefs-menu">
          <div className="dl-menu-head">Download quality</div>
          <div className="tag-select-list">
            {QUALITIES.map(q => (
              <button key={q} type="button" className={`tag-select-option${q === pref.quality ? " is-on" : ""}`}
                      onClick={() => savePref(artist, { ...pref, quality: q })}>
                <span className="tag-select-mark">{q === pref.quality && <Icon name="check" size={12} />}</span>
                <span className="tag-select-name">{qualityLabel(q)}</span>
                {q === "best" && <span className="tag-select-n">usually 1080p</span>}
              </button>
            ))}
          </div>
          <label className="dl-prefs-auto"
                 title="When the Inbox finds a new upload from this creator, download it at this quality. Only for followed channels; Shorts are skipped.">
            <input type="checkbox" checked={pref.auto} onChange={e => savePref(artist, { ...pref, auto: e.target.checked })} />
            Download new uploads automatically
          </label>
        </div>
      )}
    </div>
  );
}
