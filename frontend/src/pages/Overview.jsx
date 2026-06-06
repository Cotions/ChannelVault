import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { artistThumbUrl, getDuplicates, getMissing } from "../lib/api";

function ArtistCard({ name, stats, onClick }) {
  const [hasThumb, setHasThumb] = useState(true);
  return (
    <div className="creator-card" onClick={onClick}>
      {hasThumb && (
        <img
          className="creator-avatar"
          src={artistThumbUrl(name)}
          alt=""
          onError={() => setHasThumb(false)}
        />
      )}
      <span className="creator-name" title={name}>{name}</span>
      <div className="creator-counts">
        {stats.downloaded > 0 && <span className="creator-count">{stats.downloaded}</span>}
        {stats.wanted > 0 && <span className="creator-count-wanted">⬇{stats.wanted}</span>}
        {stats.ignored > 0 && <span className="creator-count-ignored">✕{stats.ignored}</span>}
      </div>
    </div>
  );
}

function DataQualityCard() {
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

export default function Overview({ videos, wanted, ignored }) {
  const navigate = useNavigate();

  const artistStats = {};
  for (const v of videos) {
    const ch = v.channel_name || "Unknown";
    if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
    artistStats[ch].downloaded++;
  }
  for (const v of wanted) {
    const ch = v.channel_name || "Unknown";
    if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
    artistStats[ch].wanted++;
  }
  for (const v of ignored) {
    const ch = v.channel_name || "Unknown";
    if (!artistStats[ch]) artistStats[ch] = { downloaded: 0, wanted: 0, ignored: 0 };
    artistStats[ch].ignored++;
  }
  const artists = Object.entries(artistStats).sort((a, b) => b[1].downloaded - a[1].downloaded);

  return (
    <>
      <div className="card">
        <div className="card-title">Library</div>
        <div className="stats-row">
          <div className="stat">
            <div className="stat-num">{videos.length}</div>
            <div className="stat-label">Total</div>
          </div>
          <div className="stat">
            <div className="stat-num">{videos.filter(v => v.view_count != null).length}</div>
            <div className="stat-label">With stats</div>
          </div>
          <div className="stat">
            <div className="stat-num" style={{ color: "#90caf9" }}>{wanted.length}</div>
            <div className="stat-label">Wanted</div>
          </div>
          <div className="stat">
            <div className="stat-num" style={{ color: "#ef9a9a" }}>{ignored.length}</div>
            <div className="stat-label">Ignored</div>
          </div>
        </div>
      </div>

      <DataQualityCard />

      <div className="card">
        <div className="card-title">Artists</div>
        {artists.length === 0 ? (
          <div className="empty">No data yet.</div>
        ) : (
          <div className="creator-grid">
            {artists.map(([name, stats]) => (
              <ArtistCard
                key={name}
                name={name}
                stats={stats}
                onClick={() => navigate(`/artist/${encodeURIComponent(name)}`)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
