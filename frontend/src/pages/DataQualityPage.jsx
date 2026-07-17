import { useState } from "react";
import { getDuplicates, getMissing, organizePreview, organizeApply, browse } from "../lib/api";
import ImportItem from "../components/ImportItem";

export default function DataQualityPage() {
  const [status,     setStatus]     = useState("idle"); // idle | scanning | done | error
  const [duplicates, setDuplicates] = useState([]);
  const [missing,    setMissing]    = useState([]);
  const [expanded,   setExpanded]   = useState({ dupes: false, missing: false });

  async function runScan() {
    setStatus("scanning");
    setDuplicates([]);
    setMissing([]);
    try {
      const [d, m] = await Promise.all([getDuplicates(), getMissing()]);
      setDuplicates(d.duplicates || []);
      setMissing(m.missing || []);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  function toggle(key) {
    setExpanded(e => ({ ...e, [key]: !e[key] }));
  }

  // --- Organize / Import -------------------------------------------------
  const [orgStatus,  setOrgStatus]  = useState("idle"); // idle | loading | ready | applying | done | error
  const [loose,      setLoose]      = useState([]);
  const [selected,   setSelected]   = useState({});     // file -> bool
  const [results,    setResults]    = useState([]);
  const [source,     setSource]     = useState("");     // empty = loose files in library root
  const [mode,       setMode]       = useState("move"); // move | copy (import only)

  async function pickSource() {
    try {
      const d = await browse();
      if (d.ok && d.directory) setSource(d.directory);
    } catch { /* ignore */ }
  }

  async function findLoose() {
    setOrgStatus("loading");
    setResults([]);
    try {
      const d = await organizePreview(source.trim() || undefined);
      const items = d.items || [];
      setLoose(items);
      // pre-check files safe to file away. "ready" = move + (re)track. "in-place"
      // but untracked = just track. Never auto-check real duplicates.
      const sel = {};
      items.forEach(it => {
        if (it.status === "ready" || (it.status === "in-place" && !it.in_db)) sel[it.file] = true;
      });
      setSelected(sel);
      setOrgStatus("ready");
    } catch {
      setOrgStatus("error");
    }
  }

  async function applyOrganize() {
    const files = loose.filter(it => selected[it.file]).map(it => it.file);
    if (!files.length) return;
    setOrgStatus("applying");
    try {
      const d = await organizeApply({ files, source: source.trim() || undefined, mode });
      setResults(d.results || []);
      setOrgStatus("done");
    } catch {
      setOrgStatus("error");
    }
  }

  function setCheck(file, val) { setSelected(s => ({ ...s, [file]: val })); }
  function selectAll() {
    const sel = {};
    loose.forEach(it => { if (it.status !== "no-artist") sel[it.file] = true; });
    setSelected(sel);
  }
  function unselectAll() { setSelected({}); }

  function onTransferred(file) {
    setLoose(prev => prev.filter(it => it.file !== file));
    setSelected(s => { const n = { ...s }; delete n[file]; return n; });
  }
  function onMetaChanged(file, meta) {
    setLoose(prev => prev.map(it => {
      if (it.file !== file) return it;
      const artist = meta.artist || null;
      const status = !artist ? "no-artist" : (it.status === "no-artist" ? "ready" : it.status);
      return { ...it, artist, video_id: meta.video_id, status };
    }));
  }

  const selectedCount = loose.filter(it => selected[it.file]).length;

  return (
    <>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        Organize / Import
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: "3px 10px", marginLeft: "auto" }}
          onClick={findLoose}
          disabled={orgStatus === "loading" || orgStatus === "applying"}
        >
          {orgStatus === "loading" ? "Scanning…" : (source.trim() ? "Scan Source" : "Find Loose Files")}
        </button>
      </div>

      <div className="folder-row" style={{ marginTop: 4 }}>
        <input
          type="text"
          value={source}
          onChange={e => setSource(e.target.value)}
          placeholder="Import source folder (leave empty = loose files in library)"
        />
        <button className="btn-secondary" onClick={pickSource}>Browse…</button>
      </div>
      {source.trim() && (
        <div className="folder-row" style={{ marginTop: 6, gap: 16 }}>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" name="xfer" checked={mode === "move"} onChange={() => setMode("move")} />
            Move (remove from source)
          </label>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" name="xfer" checked={mode === "copy"} onChange={() => setMode("copy")} />
            Copy (keep source)
          </label>
        </div>
      )}

      {orgStatus === "idle" && (
        <div className="empty" style={{ padding: "20px" }}>
          Leave the source empty to file loose videos already in the library. Or pick a source
          folder to import from — each file is read for its artist tag, transferred into
          {" "}<code>library/&lt;artist&gt;/</code>, verified on disk, then added to the database.
        </div>
      )}
      {orgStatus === "error" && (
        <div className="msg show err">Request failed — is the backend running?</div>
      )}

      {(orgStatus === "ready" || orgStatus === "applying") && (
        loose.length === 0 ? (
          <div className="empty" style={{ padding: "20px" }}>No loose files in the watch folder.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--muted)" }}>
              <span>{loose.length} file{loose.length !== 1 ? "s" : ""} · {selectedCount} selected</span>
              <button className="btn-ghost" style={{ fontSize: 11 }} onClick={selectAll}>Select all</button>
              <button className="btn-ghost" style={{ fontSize: 11 }} onClick={unselectAll}>Unselect all</button>
            </div>
            {loose.map(it => (
              <ImportItem
                key={it.file}
                it={it}
                checked={!!selected[it.file]}
                onCheck={setCheck}
                source={source}
                mode={mode}
                onTransferred={onTransferred}
                onMetaChanged={onMetaChanged}
              />
            ))}
            <button
              className="btn-primary"
              style={{ alignSelf: "flex-start", marginTop: 6, fontSize: 12, padding: "5px 14px" }}
              onClick={applyOrganize}
              disabled={orgStatus === "applying" || selectedCount === 0}
            >
              {orgStatus === "applying"
                ? (mode === "copy" ? "Copying…" : "Moving…")
                : `${mode === "copy" ? "Copy" : "Move"} & Add (${selectedCount})`}
            </button>
          </div>
        )
      )}

      {orgStatus === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {(() => {
            const ok = results.filter(r => r.added).length;
            const fail = results.length - ok;
            return (
              <div style={{ fontSize: 13, fontWeight: 600, color: fail ? "#ffb74d" : "#81c784" }}>
                {ok} transferred &amp; verified{fail ? ` · ${fail} skipped/failed` : ""}
              </div>
            );
          })()}
          {results.map(r => {
            const verb = mode === "copy" ? "copied" : "moved";
            const success = r.added && r.verified;
            return (
              <div key={r.file} style={{
                background: "var(--surface2, #1e2130)", borderRadius: 6, padding: "8px 12px", fontSize: 12,
              }}>
                <div style={{ fontWeight: 600, wordBreak: "break-all" }}>
                  {success ? "✓ " : "✗ "}{r.dest || r.file}
                </div>
                <div style={{ color: success ? "#81c784" : "#ffb74d" }}>
                  {success
                    ? `${r.moved ? verb + " · " : ""}verified at destination · added to DB`
                    : `not added — ${r.status}`}
                </div>
              </div>
            );
          })}
          <button
            className="btn-secondary"
            style={{ alignSelf: "flex-start", marginTop: 6, fontSize: 12, padding: "5px 14px" }}
            onClick={findLoose}
          >
            Rescan
          </button>
        </div>
      )}
    </div>

    <div className="card">
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        Data Quality
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: "3px 10px", marginLeft: "auto" }}
          onClick={runScan}
          disabled={status === "scanning"}
        >
          {status === "scanning" ? "Scanning…" : "Run Scan"}
        </button>
      </div>

      {status === "idle" && (
        <div className="empty" style={{ padding: "20px" }}>Click Run Scan to check for duplicates and missing files.</div>
      )}
      {status === "error" && (
        <div className="msg show err">Scan failed — is the backend running?</div>
      )}

      {status === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>

          <div
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => duplicates.length && toggle("dupes")}
          >
            <span style={{
              display: "inline-block", minWidth: 24, textAlign: "center", fontWeight: 700,
              color: duplicates.length ? "#ef9a9a" : "#81c784", fontSize: 15
            }}>
              {duplicates.length}
            </span>
            <span style={{ fontSize: 13 }}>duplicate video{duplicates.length !== 1 ? "s" : ""}</span>
            {duplicates.length > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                {expanded.dupes ? "▲ hide" : "▼ show"}
              </span>
            )}
          </div>

          {expanded.dupes && duplicates.map(d => (
            <div key={d.video_id} style={{ background: "var(--surface2, #1e2130)", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {d.title || d.video_id}
                {d.channel_name && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — {d.channel_name}</span>}
              </div>
              {d.files.map(f => (
                <div key={f} style={{ color: "var(--muted)", wordBreak: "break-all" }}>{f}</div>
              ))}
            </div>
          ))}

          <div
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => missing.length && toggle("missing")}
          >
            <span style={{
              display: "inline-block", minWidth: 24, textAlign: "center", fontWeight: 700,
              color: missing.length ? "#ffb74d" : "#81c784", fontSize: 15
            }}>
              {missing.length}
            </span>
            <span style={{ fontSize: 13 }}>missing file{missing.length !== 1 ? "s" : ""}</span>
            {missing.length > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                {expanded.missing ? "▲ hide" : "▼ show"}
              </span>
            )}
          </div>

          {expanded.missing && missing.map(m => (
            <div key={m.video_id} style={{ background: "var(--surface2, #1e2130)", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {m.title || m.video_id}
                {m.channel_name && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — {m.channel_name}</span>}
              </div>
              <div style={{ color: "var(--muted)", wordBreak: "break-all" }}>{m.file_path}</div>
            </div>
          ))}

        </div>
      )}
    </div>
    </>
  );
}
