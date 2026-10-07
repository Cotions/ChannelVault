import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

/* Search box over every artist name in the library, for marking another
   channel as the same person. Only existing names can be picked: a link to a
   name nothing in the vault uses would point at an empty page. Styled with the
   tag picker's classes so both inputs read as the same control. */
export default function ChannelLinker({ names, exclude, onPick, onClose }) {
  const [text,   setText]   = useState("");
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef(null);
  const q = text.trim().toLowerCase();

  const matches = useMemo(() => {
    const pool = names.filter(n => !exclude.has(n));
    if (!q) return pool.slice(0, 50);
    return pool
      .map(n => ({ n, i: n.toLowerCase().indexOf(q) }))
      .filter(x => x.i >= 0)
      .sort((a, b) => (a.i !== 0) - (b.i !== 0) || a.n.length - b.n.length || a.n.localeCompare(b.n))
      .slice(0, 50)
      .map(x => x.n);
  }, [names, exclude, q]);

  useEffect(() => {
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && matches[cursor]) { e.preventDefault(); onPick(matches[cursor]); }
    else if (e.key === "Escape") onClose();
  }

  return (
    <div className="tag-picker-input-wrap" ref={wrapRef}>
      <Icon name="search" size={12} className="tag-picker-icon" />
      <input
        className="tag-picker-input"
        value={text}
        onChange={e => { setText(e.target.value); setCursor(0); }}
        onKeyDown={onKey}
        placeholder="Find a channel…"
        autoFocus
      />
      <div className="tag-picker-menu">
        {matches.length === 0 ? (
          <div className="tag-picker-empty">No matching channel.</div>
        ) : matches.map((n, i) => (
          <div
            key={n}
            className={`tag-picker-option${i === cursor ? " is-on" : ""}`}
            onMouseEnter={() => setCursor(i)}
            onMouseDown={e => { e.preventDefault(); onPick(n); }}
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}
