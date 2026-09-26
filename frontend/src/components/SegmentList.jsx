import { useEffect, useState } from "react";
import { fmtTime, parseTime } from "../lib/fmt";
import TagChip from "./TagChip";
import TagPicker from "./TagPicker";
import Icon from "./Icon";

const emptyForm = () => ({ start: "", end: "", title: "", tags: [] });

/* Every segment of one video as editable rows, plus the form for a new one.
   Time fields accept "12:30", "1:02:09" or plain seconds; the "now" buttons
   copy the playhead so a range can be marked while watching. */
export default function SegmentList({
  segments = [], allTags = [], time = 0, duration = 0,
  onSeek, selectedId, onSelect,
  onCreate, onUpdate, onDelete, onAddTag, onRemoveTag, onImportChapters,
  busy = false, hasFile = true,
}) {
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(emptyForm);
  const [formErr,    setFormErr]    = useState(null);
  const [editingId,  setEditingId]  = useState(null);
  const [edit,       setEdit]       = useState(emptyForm);
  const [editErr,    setEditErr]    = useState(null);
  const [confirmId,  setConfirmId]  = useState(null);
  const [taggingId,  setTaggingId]  = useState(null);

  useEffect(() => {
    if (confirmId == null && editingId == null && !showForm) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      setConfirmId(null); setEditingId(null); setEditErr(null); setTaggingId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmId, editingId, showForm]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setEd(k, v) { setEdit(e => ({ ...e, [k]: v })); }

  /* Shared by the new-segment form and the row editor: times have to parse,
     the range has to run forwards and it has to start inside the video. */
  function readTimes(start, end) {
    const a = parseTime(start), b = parseTime(end);
    if (a == null || b == null)    return { error: "Times look like 12:30 or 1:02:09." };
    if (b <= a)                    return { error: "End must come after start." };
    if (duration && a >= duration) return { error: "Start is past the end of the video." };
    return { start: a, end: Math.min(b, duration || b) };
  }

  async function submit(e) {
    e.preventDefault();
    const times = readTimes(form.start, form.end);
    if (times.error) { setFormErr(times.error); return; }
    setFormErr(null);
    const ok = await onCreate?.({ start_secs: times.start, end_secs: times.end, title: form.title.trim() || null, tags: form.tags.map(t => t.name) });
    if (ok !== false) { setForm(emptyForm()); setShowForm(false); }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditErr(null);
    setEdit({ start: fmtTime(s.start_secs), end: fmtTime(s.end_secs), title: s.title || "", tags: [] });
  }
  async function saveEdit(s) {
    const times = readTimes(edit.start, edit.end);
    if (times.error) { setEditErr(times.error); return; }
    const title = edit.title.trim() || null;
    const fields = {};
    if (times.start !== s.start_secs) fields.start_secs = times.start;
    if (times.end   !== s.end_secs)   fields.end_secs   = times.end;
    if (title !== (s.title || null))  fields.title      = title;
    setEditingId(null);
    setEditErr(null);
    if (Object.keys(fields).length) await onUpdate?.(s.id, fields);
  }

  const sorted = [...segments].sort((a, b) => a.start_secs - b.start_secs);

  return (
    <div className="seg-list">
      <div className="seg-list-head">
        <div className="card-title" style={{ margin: 0 }}>
          Segments {segments.length > 0 && <span className="page-count">{segments.length}</span>}
        </div>
        <div className="seg-list-actions">
          {hasFile && (
            <button className="btn-ghost" onClick={onImportChapters} disabled={busy} title="Read the chapters embedded in the file again. Hand-made segments stay.">
              <Icon name="refresh" size={13} /> Re-import chapters
            </button>
          )}
          <button className="btn-secondary btn-export" onClick={() => { setShowForm(v => !v); setFormErr(null); }} disabled={busy}>
            <Icon name={showForm ? "close" : "plus"} size={14} /> {showForm ? "Cancel" : "New segment"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="seg-form" onSubmit={submit}>
          <div className="seg-form-row">
            <label>
              Start
              <span className="seg-time-field">
                <input value={form.start} placeholder="0:00" onChange={e => set("start", e.target.value)} autoFocus />
                <button type="button" className="seg-now" onClick={() => set("start", fmtTime(time))} title="Use the current position">now</button>
              </span>
            </label>
            <label>
              End
              <span className="seg-time-field">
                <input value={form.end} placeholder={duration ? fmtTime(duration) : "0:00"} onChange={e => set("end", e.target.value)} />
                <button type="button" className="seg-now" onClick={() => set("end", fmtTime(time))} title="Use the current position">now</button>
              </span>
            </label>
            <label className="seg-form-title">
              Title <span className="field-hint-inline">optional</span>
              <input value={form.title} placeholder="What happens here" onChange={e => set("title", e.target.value)} />
            </label>
          </div>
          <div className="seg-form-row">
            <label style={{ flex: 1 }}>
              Tags
              <TagPicker
                allTags={allTags}
                selected={form.tags}
                onAdd={name => set("tags", [...form.tags, { name, color: allTags.find(t => t.name.toLowerCase() === name.toLowerCase())?.color }])}
                onRemove={t => set("tags", form.tags.filter(x => x.name !== t.name))}
                placeholder="Type a tag and press Enter"
              />
            </label>
          </div>
          {formErr && <div className="msg show err">{formErr}</div>}
          <div className="modal-actions" style={{ marginTop: 4 }}>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setFormErr(null); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>Save segment</button>
          </div>
        </form>
      )}

      {sorted.length === 0 && !showForm && (
        <div className="empty seg-empty">
          No segments yet. {hasFile ? "Re-import chapters if the file has them, or mark a range while watching." : "Mark a range while watching."}
        </div>
      )}

      {sorted.map(s => {
        const active = time >= s.start_secs && time < s.end_secs;
        const color  = s.tags?.[0]?.color;
        return (
          <div
            key={s.id}
            className={`seg-row${active ? " is-active" : ""}${s.id === selectedId ? " is-selected" : ""}`}
            style={color ? { "--seg-color": color } : undefined}
            onClick={() => onSelect?.(s.id)}
          >
            {editingId === s.id ? (
              <form
                className="seg-edit"
                onClick={e => e.stopPropagation()}
                onSubmit={e => { e.preventDefault(); saveEdit(s); }}
              >
                <div className="seg-edit-fields">
                  <span className="seg-time-field">
                    <input
                      className="seg-edit-time"
                      value={edit.start}
                      autoFocus
                      aria-label="Start"
                      onChange={e => setEd("start", e.target.value)}
                    />
                    <button type="button" className="seg-now" onClick={() => setEd("start", fmtTime(time))} title="Use the current position">now</button>
                  </span>
                  <span className="seg-time-sep">→</span>
                  <span className="seg-time-field">
                    <input
                      className="seg-edit-time"
                      value={edit.end}
                      aria-label="End"
                      onChange={e => setEd("end", e.target.value)}
                    />
                    <button type="button" className="seg-now" onClick={() => setEd("end", fmtTime(time))} title="Use the current position">now</button>
                  </span>
                  <input
                    className="seg-title-input"
                    value={edit.title}
                    placeholder="What happens here"
                    aria-label="Title"
                    onChange={e => setEd("title", e.target.value)}
                  />
                  <button type="submit" className="btn-primary btn-export" disabled={busy}>Save</button>
                  <button type="button" className="icon-btn" onClick={() => { setEditingId(null); setEditErr(null); }} title="Cancel (Esc)">
                    <Icon name="close" size={14} />
                  </button>
                </div>
                {editErr && <div className="msg show err seg-edit-err">{editErr}</div>}
              </form>
            ) : (
              <>
              <button type="button" className="seg-time" onClick={e => { e.stopPropagation(); onSeek?.(s.start_secs); }} title="Play from here">
                <Icon name="play" size={11} />
                <span>{fmtTime(s.start_secs)}</span>
                <span className="seg-time-sep">→</span>
                <span>{fmtTime(s.end_secs)}</span>
              </button>

              <div className="seg-main">
                <div className="seg-title" onDoubleClick={() => startEdit(s)} title="Double-click to edit">
                  {s.title || <span className="seg-untitled">Untitled</span>}
                  {s.source === "chapter" && <span className="seg-source" title="Read from the file's chapters">chapter</span>}
                </div>
                <div className="seg-tags" onClick={e => e.stopPropagation()}>
                {(s.tags || []).map(t => (
                  <TagChip key={t.id} tag={t} size="sm" link onRemove={() => onRemoveTag?.(s.id, t.id)} title={t.source === "rule" ? `${t.name} (from a keyword rule)` : undefined} />
                ))}
                {taggingId === s.id ? (
                  <TagPicker
                    compact autoFocus
                    allTags={allTags}
                    selected={[]}
                    onAdd={async name => { await onAddTag?.(s.id, name); setTaggingId(null); }}
                    placeholder="Tag…"
                  />
                ) : (
                  <button type="button" className="seg-add-tag" onClick={() => setTaggingId(s.id)} title="Add a tag to this segment">
                    <Icon name="plus" size={11} /> tag
                  </button>
                )}
                </div>
              </div>

              <div className="seg-row-actions" onClick={e => e.stopPropagation()}>
                <button className="icon-btn" onClick={() => startEdit(s)} title="Edit times and title"><Icon name="pencil" size={14} /></button>
              {confirmId === s.id ? (
                <>
                  <button className="btn-danger btn-export" autoFocus onClick={async () => { setConfirmId(null); await onDelete?.(s.id); }}>Delete</button>
                  <button className="icon-btn" onClick={() => setConfirmId(null)} title="Cancel (Esc)"><Icon name="close" size={14} /></button>
                </>
              ) : (
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmId(s.id)} title="Delete segment"><Icon name="trash" size={14} /></button>
              )}
              </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
