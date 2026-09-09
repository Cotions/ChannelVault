import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTag, updateTag, deleteTag, addTagRule, deleteTagRule, applyTagRules, backfillSegments, getTagSegments } from "../lib/api";
import Icon from "../components/Icon";
import { usePlayer } from "../player/playerContext";

/* One row per tag: colour, name, counts, keyword rules, delete. Plus the two
   library-wide actions: run every rule, and read chapters out of files that
   have no segments yet. */
export default function TagsPage({ tags = [], query, onChanged }) {
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [name,      setName]      = useState("");
  const [busy,      setBusy]      = useState(false);
  const [openId,    setOpenId]    = useState(null);
  const [editId,    setEditId]    = useState(null);
  const [editName,  setEditName]  = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [ruleText,  setRuleText]  = useState("");
  const [toast,     setToast]     = useState(null);
  const [backfill,  setBackfill]  = useState(null); // null | {done,total,with_chapters,segments}

  const q = (query || "").trim().toLowerCase();
  const shown = q
    ? tags.filter(t => t.name.toLowerCase().includes(q) || t.rules.some(r => r.keyword.toLowerCase().includes(q)))
    : tags;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (confirmId == null && editId == null) return;
    function onKey(e) { if (e.key === "Escape") { setConfirmId(null); setEditId(null); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmId, editId]);

  async function run(fn) {
    setBusy(true);
    try { const r = await fn(); await onChanged?.(); return r; }
    finally { setBusy(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    await run(() => createTag(n));
    setName("");
  }

  async function saveName(tag) {
    const n = editName.trim();
    setEditId(null);
    if (!n || n === tag.name) return;
    const r = await run(() => updateTag(tag.id, { name: n }));
    if (r && r.ok === false) setToast(r.error || "Rename failed");
  }

  async function addRule(tag) {
    const kw = ruleText.trim();
    if (!kw) return;
    setRuleText("");
    await run(() => addTagRule(tag.id, kw));
  }

  async function handleApplyRules() {
    const r = await run(applyTagRules);
    if (r?.ok) setToast(`Rules applied: ${r.segments} segment${r.segments === 1 ? "" : "s"}, ${r.videos} video${r.videos === 1 ? "" : "s"} newly tagged.`);
    else setToast("Applying rules failed.");
  }

  async function handleBackfill() {
    setBackfill({ done: 0, total: 0, with_chapters: 0, segments: 0 });
    try {
      await backfillSegments(ev => {
        if (ev.type === "start") setBackfill(b => ({ ...b, total: ev.total }));
        else setBackfill(b => ({ ...b, ...ev }));
        if (ev.type === "done") {
          setToast(`Chapters imported from ${ev.with_chapters} video${ev.with_chapters === 1 ? "" : "s"}: ${ev.segments} segment${ev.segments === 1 ? "" : "s"}.`);
        }
      });
      await onChanged?.();
    } catch {
      setToast("Import failed. Is the backend running?");
    } finally {
      setBackfill(null);
    }
  }

  async function playTag(t) {
    const r = await getTagSegments(t.id);
    if (!r.ok || !r.items?.length) { setToast(`Nothing tagged ${t.name} to play yet.`); return; }
    playQueue(r.items, { tagId: t.id, tagName: t.name, color: t.color });
  }

  const totalRules = tags.reduce((n, t) => n + t.rules.length, 0);

  return (
    <div className="card">
      <div className="page-head">
        <h2 className="page-title">Tags</h2>
        <span className="page-count">{shown.length.toLocaleString()}</span>
        <div className="page-head-spacer" />
        {toast && <span className="fetch-timer">{toast}</span>}
        <button className="btn-secondary btn-export" onClick={handleApplyRules} disabled={busy || totalRules === 0} title="Run every keyword rule over the whole library. Only adds tags.">
          <Icon name="refresh" size={14} className={busy ? "spin" : ""} /> Apply rules
        </button>
        <button className="btn-secondary btn-export" onClick={handleBackfill} disabled={busy || backfill != null} title="Read embedded chapters from every file that has no segments yet">
          <Icon name="scissors" size={14} /> {backfill ? `Importing ${backfill.done}/${backfill.total || "…"}` : "Import chapters"}
        </button>
      </div>

      <form className="folder-row" onSubmit={handleCreate}>
        <input type="text" placeholder="New tag name…" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn-secondary" type="submit" disabled={busy || !name.trim()}>Create</button>
      </form>

      {shown.length === 0 ? (
        <div className="empty" style={{ marginTop: 14 }}>
          {q ? "No matching tags." : "No tags yet. Create one here, or type a tag on any video or segment."}
        </div>
      ) : (
        <div className="tag-list">
          {shown.map(t => {
            const open = openId === t.id;
            return (
              <div key={t.id} className={`tag-row${open ? " is-open" : ""}`}>
                <div className="tag-row-main">
                  <label className="tag-swatch" title="Colour" style={{ background: t.color }}>
                    <input type="color" value={t.color || "#4ade80"} onChange={e => run(() => updateTag(t.id, { color: e.target.value }))} />
                  </label>

                  {editId === t.id ? (
                    <input
                      className="tag-name-input"
                      value={editName}
                      autoFocus
                      onChange={e => setEditName(e.target.value)}
                      onBlur={() => saveName(t)}
                      onKeyDown={e => { if (e.key === "Enter") saveName(t); }}
                    />
                  ) : (
                    <button className="tag-name" onClick={() => navigate(`/tag/${t.id}`)} title="Open this tag">
                      {t.name}
                    </button>
                  )}

                  <span className="tag-counts">
                    <span title="Videos carrying this tag">{t.video_count} video{t.video_count === 1 ? "" : "s"}</span>
                    <span title="Segments carrying this tag">{t.segment_count} segment{t.segment_count === 1 ? "" : "s"}</span>
                  </span>

                  <button className="icon-btn" onClick={() => playTag(t)} disabled={t.video_count === 0} title={`Play every part tagged ${t.name}`}>
                    <Icon name="play" size={14} className="icon-fill" />
                  </button>
                  <button className={`btn-ghost tag-rules-toggle${t.rules.length ? " has-rules" : ""}`} onClick={() => { setOpenId(open ? null : t.id); setRuleText(""); }} title="Keyword rules">
                    <Icon name="search" size={13} /> {t.rules.length ? `${t.rules.length} rule${t.rules.length === 1 ? "" : "s"}` : "rules"}
                  </button>
                  <button className="icon-btn" onClick={() => { setEditId(t.id); setEditName(t.name); }} title="Rename"><Icon name="pencil" size={14} /></button>
                  {confirmId === t.id ? (
                    <>
                      <span className="del-confirm-label">Delete tag?</span>
                      <button className="btn-danger btn-export" autoFocus disabled={busy} onClick={async () => { setConfirmId(null); await run(() => deleteTag(t.id)); }}>Delete</button>
                      <button className="icon-btn" onClick={() => setConfirmId(null)} title="Cancel (Esc)"><Icon name="close" size={14} /></button>
                    </>
                  ) : (
                    <button className="icon-btn icon-btn-danger" onClick={() => setConfirmId(t.id)} title="Delete tag (segments stay, just untagged)"><Icon name="trash" size={14} /></button>
                  )}
                </div>

                {open && (
                  <div className="tag-rules">
                    <div className="field-hint">
                      Any chapter title or video title containing one of these words gets this tag, when a file is
                      imported and whenever you press <b>Apply rules</b>. Rules only add; a tag you removed by hand
                      stays removed until the next apply.
                    </div>
                    <div className="tag-rules-list">
                      {t.rules.map(r => (
                        <span key={r.id} className="tag-rule">
                          <span>{r.keyword}</span>
                          <button className="tag-chip-x" title="Remove keyword" onClick={() => run(() => deleteTagRule(t.id, r.id))}><Icon name="close" size={10} /></button>
                        </span>
                      ))}
                      <input
                        className="tag-rule-input"
                        placeholder="Add a keyword and press Enter"
                        value={ruleText}
                        onChange={e => setRuleText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRule(t); } }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
