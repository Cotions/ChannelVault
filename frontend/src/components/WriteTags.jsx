import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeTags } from "../lib/api";
import { usePlayer } from "../player/playerContext";
import Icon from "./Icon";

function short(v) {
  if (v == null || v === "") return "—";
  const s = typeof v === "number" ? v.toLocaleString() : String(v).replace(/\s+/g, " ");
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;     // CSS shows three lines of it
}

/* Copy the library's title, artist, date, genre and description into the
   video file's own tags, so another player or a fresh database reads the
   same thing. Never automatic: the button shows what would change first, and
   only "Write" touches the file. */
export default function WriteTags({ videoId }) {
  const { reloadSource } = usePlayer();
  const [open,   setOpen]   = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [plan,   setPlan]   = useState(null);      // dry-run answer
  const [busy,   setBusy]   = useState(false);
  const [msg,    setMsg]    = useState(null);      // { text, bad }
  const btnRef   = useRef(null);
  const panelRef = useRef(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    setAnchor({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
    setOpen(true);
    setPlan(null);
    setMsg(null);
    try {
      const p = await writeTags(videoId, { dry_run: true });
      if (p?.ok === false) setMsg({ text: p.error || "Could not read the file", bad: true });
      else setPlan(p);
    } catch (e) {
      setMsg({ text: e.detail || "Could not read the file — is the backend running?", bad: true });
    }
  }

  async function write() {
    setBusy(true);
    try {
      const r = await writeTags(videoId, {});
      if (r?.ok === false) { setMsg({ text: r.error || "Write failed", bad: true }); return; }
      setPlan(p => ({ ...p, changes: [] }));
      reloadSource(videoId);
      setMsg({
        text: `Wrote ${r.written} tag${r.written === 1 ? "" : "s"} into ${r.file}.` +
          (r.not_kept?.length ? ` The file's format didn't keep: ${r.not_kept.join(", ")}.` : ""),
        bad: false,
      });
    } catch (e) {
      setMsg({ text: e.detail || "Write failed — the file was left as it was.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (busy || panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = e => { if (e.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  const changes = plan?.changes || [];

  return (
    <>
      <button
        ref={btnRef}
        className={`icon-btn${open ? " is-on" : ""}`}
        onClick={toggle}
        title="Write the library's details into the file's tags"
      >
        <Icon name="tag" size={16} />
      </button>
      {open && anchor && createPortal(
        <div className="audio-panel write-tags" ref={panelRef} style={{ top: anchor.top, right: anchor.right }}>
          <div className="audio-panel-head">
            Write to file tags
            {changes.length > 0 && (
              <button className="btn-secondary" onClick={write} disabled={busy}>
                {busy ? "Writing…" : `Write ${changes.length} tag${changes.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          {!plan && !msg && <div className="audio-msg">Reading the file…</div>}
          {plan && changes.length === 0 && !msg && (
            <div className="audio-msg">The file's tags already match the library.</div>
          )}
          {changes.length > 0 && (
            <>
              <div className="write-tags-list">
                {changes.map(c => (
                  <div className="write-tags-row" key={c.tag}>
                    <span className="write-tags-field">{c.field}</span>
                    <span className="write-tags-old" title={c.file == null ? "" : String(c.file)}>{short(c.file)}</span>
                    <Icon name="arrowRight" size={12} />
                    <span className="write-tags-new" title={String(c.library)}>{short(c.library)}</span>
                  </div>
                ))}
              </div>
              <div className="write-tags-note">
                Rewrites <b>{plan.file}</b> in place (no re-encode; checked before it replaces the original).
                The link tag the library tracks it by stays as it is.
                {!plan.stats_in_file && " Views and likes stay in the library: MP4 files can't hold them."}
              </div>
            </>
          )}
          {msg && <div className={`audio-msg${msg.bad ? " is-bad" : ""}`}>{msg.text}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
