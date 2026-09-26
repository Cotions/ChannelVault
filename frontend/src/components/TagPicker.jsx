import { useEffect, useMemo, useRef, useState } from "react";
import TagChip from "./TagChip";
import Icon from "./Icon";

const lower = s => (s || "").toLowerCase();

/* Does every letter of the query show up in the name, in order? Cheap stand-in
   for a fuzzy search: it catches the dropped letter ("whispr" → "whisper"),
   which plain substring matching misses and which is how most typos read. */
function subsequence(name, q) {
  let i = 0;
  for (const ch of name) if (ch === q[i] && ++i === q.length) return true;
  return false;
}

/* Damerau-style distance capped at two edits, for the typos a subsequence
   cannot see: a swapped pair or a wrong letter ("wihsper", "whosper"). */
function within2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let prev2 = [], prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row[j] = v;
      best = Math.min(best, v);
    }
    if (best > 2) return false;
    prev2 = prev; prev = row;
  }
  return prev[b.length] <= 2;
}

/* Lower is better; Infinity drops the tag from the list. */
function rank(name, q) {
  if (name.startsWith(q))   return 0;
  if (name.includes(q))     return 1;
  if (subsequence(name, q)) return 2;
  if (within2(name, q))     return 3;
  return Infinity;
}

/* Chips for what is selected plus one input that searches every tag in the
   library. The list is ours rather than a native <datalist> because a datalist
   cannot be walked or filtered on our terms, and in some browsers it eats the
   Enter key before the field sees it. Picking a suggestion is the common path;
   a word that matches nothing existing only becomes a new tag through the
   "create" row, so a typo lands on the tag that was meant instead of quietly
   adding a near-duplicate to the library. */
export default function TagPicker({
  allTags = [], selected = [], onAdd, onRemove,
  placeholder = "Add a tag…", compact = false, autoFocus = false, disabled = false,
}) {
  const [text,   setText]   = useState("");
  const [open,   setOpen]   = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef(null);

  const chosenKey = selected.map(t => lower(t.name)).join("\u0000");
  const q = lower(text.trim());

  const matches = useMemo(() => {
    const chosen = new Set(chosenKey ? chosenKey.split("\u0000") : []);
    const pool = allTags.filter(t => !chosen.has(lower(t.name)));
    if (!q) return pool.slice(0, 50);
    return pool
      .map(t => ({ t, r: rank(lower(t.name), q) }))
      .filter(x => x.r < Infinity)
      .sort((a, b) => a.r - b.r || a.t.name.length - b.t.name.length || a.t.name.localeCompare(b.t.name))
      .slice(0, 50)
      .map(x => x.t);
  }, [allTags, q, chosenKey]);

  const known   = q ? allTags.some(t => lower(t.name) === q) : false;
  const already = q ? chosenKey.split("\u0000").includes(q) : false;
  // The create row sits last, so Enter on a typo reaches the closest real tag
  // first and only a deliberate walk down the list invents a new word.
  const canCreate = !!q && !known && !already;
  const rowCount  = matches.length + (canCreate ? 1 : 0);
  const at        = Math.min(cursor, Math.max(0, rowCount - 1));

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function add(name) {
    setText("");
    setCursor(0);
    setOpen(false);
    onAdd?.(name);
  }

  function pick(index) {
    if (index < matches.length) { add(matches[index].name); return; }
    if (canCreate) add(text.trim());
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!rowCount) return;
      setCursor(c => (Math.min(c, rowCount - 1) + (e.key === "ArrowDown" ? 1 : rowCount - 1)) % rowCount);
      return;
    }
    if (e.key === "Enter") {
      // Always ours: this input often lives inside a form, and an Enter that
      // escaped would submit it with the tag still unadded.
      e.preventDefault();
      if (already) { setText(""); setOpen(false); return; }
      if (known)   { add(allTags.find(t => lower(t.name) === q).name); return; }
      if (rowCount) pick(at);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (open) setOpen(false); else setText("");
    }
  }

  return (
    <div className={`tag-picker${compact ? " tag-picker-compact" : ""}`} ref={wrapRef}>
      {selected.map(t => (
        <TagChip key={t.id ?? t.name} tag={t} size={compact ? "sm" : "md"} onRemove={onRemove ? () => onRemove(t) : undefined} />
      ))}
      <span className="tag-picker-input-wrap">
        <Icon name="tag" size={12} className="tag-picker-icon" />
        <input
          className="tag-picker-input"
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={e => { setText(e.target.value); setCursor(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div className="tag-picker-menu">
            {matches.map((t, i) => (
              <button
                type="button"
                key={t.id ?? t.name}
                className={`tag-picker-option${i === at ? " is-on" : ""}`}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(i)}
              >
                <span className="tag-chip-dot" style={{ background: t.color || "#4ade80" }} />
                <span className="tag-picker-option-name">{t.name}</span>
                {t.video_count != null && <span className="tag-picker-option-count">{t.video_count}</span>}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                className={`tag-picker-option tag-picker-create${at === matches.length ? " is-on" : ""}`}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setCursor(matches.length)}
                onClick={() => pick(matches.length)}
              >
                <Icon name="plus" size={11} />
                <span className="tag-picker-option-name">Create “{text.trim()}”</span>
              </button>
            )}
            {!rowCount && <div className="tag-picker-empty">{q ? "Already on this one." : "No tags yet."}</div>}
          </div>
        )}
      </span>
    </div>
  );
}
