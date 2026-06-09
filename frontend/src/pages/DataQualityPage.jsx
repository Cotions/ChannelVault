import { useState } from "react";
import { getDuplicates, getMissing } from "../lib/api";

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

  return (
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
  );
}
