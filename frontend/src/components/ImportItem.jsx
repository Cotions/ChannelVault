import { useState } from "react";
import { importInspect, importThumbUrl, importFetchMeta, importEnrich, organizeApply } from "../lib/api";

const FIELDS = [
  { key: "title",        label: "Title" },
  { key: "artist",       label: "Artist / Channel" },
  { key: "url",          label: "YouTube URL" },
  { key: "genre",        label: "Genre" },
  { key: "recorded_date",label: "Recorded date" },
  { key: "description",  label: "Description", area: true },
];

const STATUS_LABEL = {
  ready: "ready", "in-place": "already in folder",
  "no-artist": "no artist tag", duplicate: "duplicate on disk",
};

export default function ImportItem({ it, checked, onCheck, source, mode, onTransferred, onMetaChanged }) {
  const [open,    setOpen]    = useState(false);
  const [detail,  setDetail]  = useState(null);
  const [fields,  setFields]  = useState(null);
  const [busy,    setBusy]    = useState("");
  const [msg,     setMsg]     = useState(null);
  const [done,    setDone]    = useState(false);
  const [bust,    setBust]    = useState(0);

  function flash(text, type) { setMsg({ text, type }); }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setBusy("inspect");
      try {
        const d = await importInspect(it.file);
        if (d.ok) {
          setDetail(d);
          setFields({
            title: d.meta.title || "", artist: d.meta.artist || "", url: d.meta.url || "",
            genre: d.meta.genre || "", recorded_date: d.meta.recorded_date || "",
            description: d.meta.description || "",
          });
        } else flash(d.error, "err");
      } catch { flash("Inspect failed", "err"); }
      setBusy("");
    }
  }

  function setField(k, v) { setFields(f => ({ ...f, [k]: v })); }

  function videoIdFromUrl(u) {
    const m = (u || "").match(/[?&]v=([A-Za-z0-9_-]{11})/) || (u || "").match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : undefined;
  }

  async function autoFetch() {
    setBusy("fetch");
    try {
      // use a URL typed into the field even if it isn't written to the file yet
      const d = await importFetchMeta(it.file, videoIdFromUrl(fields?.url));
      if (d.ok) {
        const s = d.suggested;
        // fill only fields the file is missing; don't clobber what you've typed
        setFields(f => ({
          title:        f.title        || s.title || "",
          artist:       f.artist       || s.artist || "",
          url:          f.url          || s.url || "",
          genre:        f.genre        || s.genre || "",
          recorded_date:f.recorded_date|| s.recorded_date || "",
          description:  f.description  || s.description || "",
        }));
        flash("Fetched from YouTube — review, then Write to file", "ok");
      } else {
        flash(d.availability ? `Unavailable: ${d.availability}` : (d.error || "Fetch failed"), "err");
      }
    } catch { flash("Fetch failed", "err"); }
    setBusy("");
  }

  async function writeToFile() {
    setBusy("write");
    try {
      const d = await importEnrich(it.file, fields);
      if (d.ok) {
        setDetail(dd => ({ ...dd, meta: d.meta, has_thumb: dd?.has_thumb }));
        setBust(b => b + 1);
        flash("Written into the file ✓", "ok");
        onMetaChanged && onMetaChanged(it.file, d.meta);
      } else flash(d.error || "Write failed", "err");
    } catch { flash("Write failed", "err"); }
    setBusy("");
  }

  async function transferThis() {
    setBusy("transfer");
    try {
      const d = await organizeApply({ files: [it.file], source: source?.trim() || undefined, mode });
      const r = (d.results || [])[0];
      if (r && r.added && r.verified) {
        setDone(true);
        flash(`${mode === "copy" ? "Copied" : "Moved"} · verified at destination · added to DB`, "ok");
        onTransferred && onTransferred(it.file);
      } else {
        flash(`Not added — ${r ? r.status : "no result"}`, "err");
      }
    } catch { flash("Transfer failed", "err"); }
    setBusy("");
  }

  const meta      = detail?.meta;
  const canImport = meta && meta.artist && meta.video_id;

  return (
    <div style={{ background: "var(--surface2, #1e2130)", borderRadius: 6, opacity: done ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 12 }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={done || it.status === "no-artist"}
          onChange={e => onCheck(it.file, e.target.checked)}
        />
        <div style={{ minWidth: 0, flex: 1, cursor: "pointer" }} onClick={toggle}>
          <div style={{ fontWeight: 600, wordBreak: "break-all" }}>
            {done ? "✓ " : ""}{it.basename}
          </div>
          <div style={{ color: "var(--muted)" }}>
            {it.artist ? `→ ${it.artist}/` : "— no artist tag"}{it.in_db && " · already in DB"}
          </div>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {done ? "done" : (STATUS_LABEL[it.status] || it.status)}
        </span>
        <button className="btn-ghost" style={{ fontSize: 11 }} onClick={toggle}>
          {open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            {detail?.has_thumb ? (
              <img
                src={`${importThumbUrl(it.file)}&_=${bust}`}
                alt="thumbnail"
                style={{ width: 160, borderRadius: 4, display: "block", background: "#000" }}
              />
            ) : (
              <div style={{ width: 160, height: 90, borderRadius: 4, background: "#000",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--muted)", fontSize: 11 }}>no thumbnail</div>
            )}
            {meta && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
                <div>id: {meta.video_id || "—"}</div>
                <div>dest: {fields?.artist ? `${fields.artist}/` : "— need artist"}</div>
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {busy === "inspect" && <div style={{ fontSize: 12, color: "var(--muted)" }}>Reading…</div>}
            {fields && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {FIELDS.map(f => (
                  <label key={f.key} style={{ fontSize: 11, color: "var(--muted)" }}>
                    {f.label}
                    {f.area ? (
                      <textarea
                        value={fields[f.key]}
                        onChange={e => setField(f.key, e.target.value)}
                        rows={2}
                        style={{ width: "100%", fontSize: 12, marginTop: 2, resize: "vertical" }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={fields[f.key]}
                        onChange={e => setField(f.key, e.target.value)}
                        style={{ width: "100%", fontSize: 12, marginTop: 2 }}
                      />
                    )}
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={autoFetch} disabled={!!busy}>
                    {busy === "fetch" ? "Fetching…" : "Auto-fetch from YouTube"}
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={writeToFile} disabled={!!busy}>
                    {busy === "write" ? "Writing…" : "Write to file"}
                  </button>
                  <button className="btn-primary" style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={transferThis} disabled={!!busy || done || !canImport}
                    title={canImport ? "" : "Needs artist + YouTube URL written into the file first"}>
                    {busy === "transfer" ? "Transferring…" : (mode === "copy" ? "Copy & Add" : "Move & Add")}
                  </button>
                </div>
                {msg && <div className={`msg show ${msg.type}`} style={{ marginTop: 4 }}>{msg.text}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
