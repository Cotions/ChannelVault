import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { EFFECTS, effectById } from "./effects";
import { setArtistEffect } from "../lib/profileEffects";

/* Corner button on the creator profile for picking this artist's effect.
   Same list styling as the channel status menu. */
export default function ProfileEffectMenu({ artist, prefs }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = prefs.artists[artist] ?? null;    // null = follow the default
  const fallbackName = effectById(prefs.fallback)?.name || "None";
  const options = [
    { value: null, label: "Default", hint: `Follow Settings (${fallbackName})` },
    ...EFFECTS.map(e => ({ value: e.id, label: e.name, hint: e.hint })),
    { value: "none", label: "None", hint: "No effect for this artist" },
  ];

  function pick(value) {
    setOpen(false);
    setArtistEffect(artist, value);
  }

  return (
    <div className="pfx-menu" ref={wrapRef}>
      <button
        className={`pfx-toggle${open ? " active" : ""}`}
        onClick={() => setOpen(o => !o)}
        title="Profile effect for this artist"
      >
        <Icon name="sparkle" size={14} />
      </button>
      {open && (
        <div className="tag-picker-menu channel-status-menu">
          {options.map(o => (
            <button
              key={o.value || "default"}
              className={`tag-picker-option${o.value === current ? " is-on" : ""}`}
              onClick={() => pick(o.value)}
            >
              <span className="channel-status-check">{o.value === current && <Icon name="check" size={12} />}</span>
              <span className="channel-status-option">
                <span>{o.label}</span>
                <span className="channel-status-hint">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
