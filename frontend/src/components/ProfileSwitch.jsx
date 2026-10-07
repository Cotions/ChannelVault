import { useEffect, useRef, useState } from "react";
import { activateProfile } from "../lib/api";
import Icon from "./Icon";

/* Every page holds data from the old library (videos, tags, the player), so a
   switch reloads the whole app from the home page rather than patching state. */
export async function switchProfile(id) {
  const r = await activateProfile(id);
  if (!r.ok) throw new Error(r.error || "switch failed");
  window.location.assign("/");
}

/* Header menu for jumping between profiles. Hidden while there is only one,
   so a single-library setup looks exactly as it did before profiles. */
export default function ProfileSwitch({ profiles = [], onManage }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err,  setErr]  = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e)  { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (profiles.length < 2) return null;
  const active = profiles.find(p => p.active) || profiles[0];

  async function pick(p) {
    if (p.active) { setOpen(false); return; }
    setBusy(p.id);
    setErr(null);
    try {
      await switchProfile(p.id);
    } catch (e) {
      setErr(e.message);
      setBusy(null);
    }
  }

  return (
    <div className="tag-select profile-switch" ref={wrapRef}>
      <button
        type="button"
        className={`tag-select-btn${open ? " is-open" : ""}`}
        onClick={() => setOpen(v => !v)}
        title="Switch profile"
      >
        <Icon name="users" size={13} />
        <span className="profile-switch-name">{active.name}</span>
        <span className="tag-select-caret" />
      </button>

      {open && (
        <div className="tag-select-menu">
          <div className="tag-select-list">
            {profiles.map(p => (
              <button
                type="button"
                key={p.id}
                className={`tag-select-option${p.active ? " is-on" : ""}`}
                onClick={() => pick(p)}
                disabled={busy != null}
              >
                <span className="tag-select-mark">{p.active && <Icon name="check" size={11} />}</span>
                <span className="tag-select-name">{busy === p.id ? "Switching…" : p.name}</span>
                <span className="tag-select-n">{p.video_count ?? "?"}</span>
              </button>
            ))}
          </div>
          {err && <div className="tag-select-empty">{err}</div>}
          <button type="button" className="tag-select-clear" onClick={() => { setOpen(false); onManage?.(); }}>
            <Icon name="settings" size={12} /> Manage profiles
          </button>
        </div>
      )}
    </div>
  );
}
