import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  getAudioTracks, addAudioTrack, updateAudioTrack, deleteAudioTrack, browseAudioFile,
} from "../lib/api";
import { usePlayer } from "../player/playerContext";
import { fmtDuration } from "../lib/fmt";
import Icon from "./Icon";

const NUDGE = 0.1;   // one tap of the sync buttons, in seconds

/* Alternate soundtracks for one video: a remaster, a quieter mix, a dub living
   in its own file next to the mp4. Picking one mutes the picture and plays that
   file against it.

   Switching between them is the player's job — its Audio menu also works from
   the mini player and from fullscreen, which a row on this page cannot. This is
   the library side of it: one toolbar button carrying the count, and a panel
   that attaches, renames, detaches and nudges the sound against the picture. */
export default function AudioTracks({ videoId, duration, onLibraryChanged }) {
  const { audioTrack, selectAudioTrack, setAudioTracks } = usePlayer();
  const [tracks,   setTracks]   = useState([]);
  const [suggest,  setSuggest]  = useState(null);   // null = not looked yet
  const [panel,    setPanel]    = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [msg,      setMsg]      = useState(null);   // { text, bad }
  const [adding,   setAdding]   = useState(null);   // file_path being attached
  const [confirmId, setConfirmId] = useState(null);
  const saveRef   = useRef(null);
  const btnRef    = useRef(null);
  const panelRef  = useRef(null);
  // Where to hang the panel. It is portalled to <body> because the player shell
  // is fixed and paints above this card, so a panel rendered inside the card
  // would open behind the picture.
  const [anchor,  setAnchor]  = useState(null);
  // Rapid taps on the nudge buttons all read the same render's track object, so
  // the running offset lives in a ref and the state follows it.
  const offsetRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await getAudioTracks(videoId, { suggest: false });
      setTracks(r.tracks || []);
      return r.tracks || [];
    } catch { setTracks([]); return []; }
  }, [videoId]);

  useEffect(() => { setPanel(false); setSuggest(null); setMsg(null); load(); }, [load]);
  // The player chrome offers the same switch from mini and from fullscreen, so
  // it reads the list from context rather than fetching it a second time.
  useEffect(() => { setAudioTracks(videoId, tracks); }, [videoId, tracks, setAudioTracks]);

  // Scanning the library for look-alike files is the expensive half, so it only
  // runs when the panel is actually opened.
  const loadSuggestions = useCallback(async () => {
    setSuggest(null);
    try {
      const r = await getAudioTracks(videoId);
      setTracks(r.tracks || []);
      setSuggest(r.suggestions || []);
    } catch { setSuggest([]); }
  }, [videoId]);

  function openPanel() {
    const next = !panel;
    setPanel(next);
    if (next) {
      const r = btnRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
      if (suggest == null) loadSuggestions();
    }
  }

  // Click away or press Escape to put it back.
  useEffect(() => {
    if (!panel) return;
    const onDown = e => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setPanel(false);
    };
    const onKey = e => { if (e.key === "Escape") setPanel(false); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  // Feedback belongs next to the click, not in the toolbar: a refusal from the
  // backend ("already attached", "file is not inside a media root") is the whole
  // explanation for a button that looks like it did nothing.
  const flash = (text, bad = false) => { setMsg({ text, bad }); setTimeout(() => setMsg(null), 6000); };

  async function attach(filePath, label) {
    setBusy(true);
    setAdding(filePath);
    try {
      const r = await addAudioTrack(videoId, { file_path: filePath, label });
      if (!r.ok) {
        flash(r.error === "already attached" ? "Already attached to this video" : r.error || "Could not add", true);
        // A path the backend will not take is a path the list should stop
        // offering: the index behind it has gone stale.
        if (/media root/.test(r.error || "")) loadSuggestions();
        return;
      }
      await load();
      setSuggest(s => (s || []).filter(x => x.file_path !== filePath));
      selectAudioTrack(r.track);
      // The file was its own library entry; as a soundtrack it no longer is.
      if (r.hidden?.length) {
        onLibraryChanged?.();
        flash(`Added “${r.track.label}” — its own library entry is now hidden`);
      } else {
        flash(`Added “${r.track.label}” — switch to it in the player`);
      }
    } catch { flash("Could not add — the backend did not answer", true); } finally {
      setBusy(false);
      setAdding(null);
    }
  }

  async function browse() {
    setBusy(true);
    try {
      const r = await browseAudioFile();
      if (r.ok && r.file) await attach(r.file);
    } catch { flash("Picker unavailable", true); } finally { setBusy(false); }
  }

  async function detach(track) {
    setConfirmId(null);
    if (audioTrack?.id === track.id) selectAudioTrack(null);
    const r = await deleteAudioTrack(track.id);
    if (r?.restored?.length) onLibraryChanged?.();
    await load();
    setSuggest(null);
  }

  useEffect(() => { offsetRef.current = audioTrack?.offset_secs || 0; }, [audioTrack?.id]);

  // The nudge buttons move the sound against the picture; the player reacts to
  // the new offset at once and the value is written back debounced.
  function nudge(delta) {
    if (!audioTrack) return;
    offsetRef.current = +(offsetRef.current + delta).toFixed(2);
    const next = { ...audioTrack, offset_secs: offsetRef.current };
    selectAudioTrack(next);
    setTracks(ts => ts.map(t => (t.id === next.id ? { ...t, offset_secs: next.offset_secs } : t)));
    clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => { updateAudioTrack(next.id, { offset_secs: next.offset_secs }); }, 500);
  }

  async function rename(track, label) {
    const clean = label.trim();
    if (!clean || clean === track.label) return;
    setTracks(ts => ts.map(t => (t.id === track.id ? { ...t, label: clean } : t)));
    if (audioTrack?.id === track.id) selectAudioTrack({ ...audioTrack, label: clean });
    await updateAudioTrack(track.id, { label: clean });
  }

  useEffect(() => () => clearTimeout(saveRef.current), []);

  const offset = audioTrack?.offset_secs || 0;
  // A file minutes away from the video length is a different recording, not a
  // second mix of this one — worth flagging before it gets played.
  const mismatch = secs => !!(duration && secs && Math.abs(secs - duration) > 5);

  return (
    <div className="audio-tools">
      <button
        ref={btnRef}
        className={`icon-btn${tracks.length ? " icon-btn-wide" : ""}${panel ? " is-on" : ""}`}
        onClick={openPanel}
        title={tracks.length
          ? `${tracks.length} alternate soundtrack${tracks.length > 1 ? "s" : ""} — add, rename or detach (switch in the player)`
          : "Add an alternate soundtrack"}
      >
        <Icon name="volume" size={16} />
        {tracks.length > 0 && <span className="icon-btn-num">{tracks.length}</span>}
      </button>

      {panel && anchor && createPortal(
        <div className="audio-panel" ref={panelRef} style={{ top: anchor.top, right: anchor.right }}>
          {audioTrack && (
            <div className="audio-panel-head">
              <span className="audio-current is-alt">{audioTrack.label}</span>
              <span className="audio-sync">
                <button className="icon-btn" onClick={() => nudge(-NUDGE)} title={`Sound earlier by ${NUDGE}s`}>
                  <Icon name="minus" size={14} />
                </button>
                <span className="audio-offset" title="Sound shifted against the picture">
                  {offset >= 0 ? "+" : "−"}{Math.abs(offset).toFixed(1)}s
                </span>
                <button className="icon-btn" onClick={() => nudge(NUDGE)} title={`Sound later by ${NUDGE}s`}>
                  <Icon name="plus" size={14} />
                </button>
              </span>
            </div>
          )}
          {tracks.length > 0 && (
            <div className="audio-panel-list">
              {tracks.map(t => (
                <div className="audio-panel-row" key={t.id}>
                  <input
                    className="audio-name"
                    defaultValue={t.label}
                    onBlur={e => rename(t, e.target.value)}
                    onKeyDown={e => e.key === "Enter" && e.target.blur()}
                  />
                  <span className="audio-file" title={t.file_path}>{t.file_path.split("/").pop()}</span>
                  <span className={`audio-dur${mismatch(t.duration_secs) ? " is-off" : ""}`}
                        title={mismatch(t.duration_secs) ? "Length differs from the video" : undefined}>
                    {fmtDuration(t.duration_secs) || "—"}
                  </span>
                  {confirmId === t.id ? (
                    <>
                      <button className="btn-danger btn-export" onClick={() => detach(t)}>Remove</button>
                      <button className="icon-btn" onClick={() => setConfirmId(null)} title="Cancel">
                        <Icon name="close" size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="icon-btn icon-btn-danger"
                      onClick={() => setConfirmId(t.id)}
                      title="Detach this track (the file stays on disk)"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {msg && <div className={`audio-msg${msg.bad ? " is-bad" : ""}`}>{msg.text}</div>}

          <div className="audio-panel-head">
            <span>Files that look like this video</span>
            <button className="btn-secondary" onClick={browse} disabled={busy}>Browse…</button>
          </div>
          {suggest == null ? (
            <div className="empty">Looking…</div>
          ) : suggest.length === 0 ? (
            <div className="empty">No matching audio files in the library. Use Browse to pick one.</div>
          ) : (
            <div className="audio-panel-list">
              {suggest.map(s => (
                <div className="audio-panel-row" key={s.file_path}>
                  <span className="audio-suggest-name" title={s.file_path}>{s.name}</span>
                  {s.duration_secs ? (
                    <span className={`audio-dur${mismatch(s.duration_secs) ? " is-off" : ""}`}
                          title={mismatch(s.duration_secs) ? "Length differs from the video" : undefined}>
                      {fmtDuration(s.duration_secs)}
                    </span>
                  ) : null}
                  <button className="btn-secondary" disabled={busy} onClick={() => attach(s.file_path, s.label)}>
                    {adding === s.file_path ? "Adding…" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
