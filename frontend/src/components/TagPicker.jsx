import { useId, useState } from "react";
import TagChip from "./TagChip";
import Icon from "./Icon";

/* Chips for what is selected plus one input that completes against every tag
   in the library. Enter adds; a name that does not exist yet is created by the
   backend on save, so typing a new word is all it takes. */
export default function TagPicker({
  allTags = [], selected = [], onAdd, onRemove,
  placeholder = "Add a tag…", compact = false, autoFocus = false, disabled = false,
}) {
  const [text, setText] = useState("");
  const listId = useId();
  const chosen = new Set(selected.map(t => (t.name || "").toLowerCase()));
  const options = allTags.filter(t => !chosen.has((t.name || "").toLowerCase()));

  function commit(value) {
    const name = (value ?? text).trim();
    if (!name || chosen.has(name.toLowerCase())) { setText(""); return; }
    onAdd?.(name);
    setText("");
  }

  return (
    <div className={`tag-picker${compact ? " tag-picker-compact" : ""}`}>
      {selected.map(t => (
        <TagChip key={t.id ?? t.name} tag={t} size={compact ? "sm" : "md"} onRemove={onRemove ? () => onRemove(t) : undefined} />
      ))}
      <span className="tag-picker-input-wrap">
        <Icon name="tag" size={12} className="tag-picker-icon" />
        <input
          className="tag-picker-input"
          list={listId}
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") setText("");
          }}
          onBlur={() => { if (text.trim()) commit(); }}
        />
        <datalist id={listId}>
          {options.map(t => <option key={t.id} value={t.name} />)}
        </datalist>
      </span>
    </div>
  );
}
