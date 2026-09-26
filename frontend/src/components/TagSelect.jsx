import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

/* The library's tag filter, next to the search field. Tags used to sit as a
   chip row above the grid, which grew with the library and pushed the videos
   down the page; here the whole vocabulary lives behind one button and only
   the count of what is on shows through. Several tags narrow together (AND),
   the same as the chip row did. */
export default function TagSelect({ tags = [], selected = [], onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const [q,    setQ]    = useState("");
  const wrapRef = useRef(null);

  const used = useMemo(
    () => tags.filter(t => t.video_count > 0)
              .sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name)),
    [tags],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? used.filter(t => t.name.toLowerCase().includes(needle)) : used;
  }, [used, q]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e)  { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (used.length === 0) return null;

  return (
    <div className="tag-select" ref={wrapRef}>
      <button
        type="button"
        className={`tag-select-btn${selected.length ? " is-on" : ""}${open ? " is-open" : ""}`}
        onClick={() => { setOpen(v => !v); setQ(""); }}
        title="Filter the library by tag"
      >
        <Icon name="tag" size={13} />
        <span className="tag-select-label">Tags</span>
        {selected.length > 0 && <span className="tag-select-count">{selected.length}</span>}
        <span className="tag-select-caret" />
      </button>

      {open && (
        <div className="tag-select-menu">
          <div className="tag-select-search">
            <Icon name="search" size={12} />
            <input
              autoFocus
              value={q}
              placeholder="Find a tag…"
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <div className="tag-select-list">
            {shown.map(t => {
              const on = selected.includes(t.id);
              return (
                <button
                  type="button"
                  key={t.id}
                  className={`tag-select-option${on ? " is-on" : ""}`}
                  onClick={() => onToggle?.(t.id)}
                >
                  <span className="tag-select-mark">{on && <Icon name="check" size={11} />}</span>
                  <span className="tag-chip-dot" style={{ background: t.color }} />
                  <span className="tag-select-name">{t.name}</span>
                  <span className="tag-select-n">{t.video_count}</span>
                </button>
              );
            })}
            {shown.length === 0 && <div className="tag-select-empty">No tag matches “{q.trim()}”.</div>}
          </div>
          {selected.length > 0 && (
            <button type="button" className="tag-select-clear" onClick={() => onClear?.()}>
              <Icon name="close" size={12} /> Clear {selected.length} filter{selected.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
