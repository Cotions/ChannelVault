import { useState, useEffect } from "react";
import { saveConfig, saveDataDir, browse, browseData, scan } from "../lib/api";

export default function WatchFolder({ initialDir, initialDataDir, onScanDone, embedded = false }) {
  const [dir,     setDir]     = useState(initialDir     || "");
  const [dataDir, setDataDir] = useState(initialDataDir || "");

  useEffect(() => { if (initialDir)     setDir(initialDir); },     [initialDir]);
  useEffect(() => { if (initialDataDir) setDataDir(initialDataDir); }, [initialDataDir]);
  const [msg,     setMsg]     = useState(null);
  const [scanLog, setScanLog] = useState([]);
  const [scanning, setScanning] = useState(false);

  function flash(text, type) {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  async function handleBrowse() {
    try {
      const data = await browse();
      if (data.ok && data.directory) {
        setDir(data.directory);
        const saved = await saveConfig(data.directory);
        if (saved.ok) flash(`Watching: ${saved.watch_directory}`, "ok");
        else flash(saved.error, "err");
      }
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleSave() {
    try {
      const data = await saveConfig(dir);
      if (data.ok) flash(`Watching: ${data.watch_directory}`, "ok");
      else flash(data.error, "err");
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleBrowseData() {
    try {
      const data = await browseData();
      if (data.ok && data.directory) {
        setDataDir(data.directory);
        const saved = await saveDataDir(data.directory);
        if (saved.ok) flash(`Data directory: ${saved.data_directory}`, "ok");
        else flash(saved.error, "err");
      }
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleSaveData() {
    try {
      const data = await saveDataDir(dataDir);
      if (data.ok) flash(`Data directory: ${data.data_directory}`, "ok");
      else flash(data.error, "err");
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleScan() {
    setScanning(true);
    setScanLog([]);
    try {
      await scan((evt) => {
        if (evt.type === "start") {
          setScanLog([{ cls: "ok", text: `Found ${evt.total} file(s) — scanning…` }]);
        } else if (evt.type === "progress") {
          const pct = Math.round((evt.done / evt.total) * 100);
          setScanLog(prev => {
            const next = prev.filter(l => l.id !== "progress");
            return [...next, {
              id: "progress", cls: "ok",
              text: `  [${evt.done}/${evt.total}] ${pct}% — tracked: ${evt.tracked}  skipped: ${evt.skipped}  errors: ${evt.errors}`,
            }];
          });
        } else if (evt.type === "done") {
          setScanLog(prev => [
            ...prev.filter(l => l.id !== "progress"),
            { cls: "ok", text: `Done — ${evt.total} file(s): ${evt.tracked} tracked, ${evt.skipped} skipped, ${evt.errors} errors` },
          ]);
          onScanDone();
        }
      });
    } catch {
      setScanLog(prev => [...prev, { cls: "err", text: "Request failed — is the backend running?" }]);
    }
    setScanning(false);
  }

  return (
    <div className={embedded ? "watch-folder-body" : "card"}>
      <div className="card-title">Watch Folder</div>
      <div className="folder-row">
        <input
          type="text"
          value={dir}
          onChange={e => setDir(e.target.value)}
          placeholder="/home/user/Downloads"
        />
        <button className="btn-secondary" onClick={handleBrowse}>Browse…</button>
        <button className="btn-secondary" onClick={handleSave}>Save</button>
        <button className="btn-primary" onClick={handleScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan Now"}
        </button>
      </div>

      <div className="card-title" style={{ marginTop: "16px" }}>Data Directory</div>
      <div className="folder-row">
        <input
          type="text"
          value={dataDir}
          onChange={e => setDataDir(e.target.value)}
          placeholder="~/.local/share/channelvault"
        />
        <button className="btn-secondary" onClick={handleBrowseData}>Browse…</button>
        <button className="btn-secondary" onClick={handleSaveData}>Save</button>
      </div>
      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
        Stores the database and thumbnail copies. Changing this migrates the existing DB.
      </div>

      {msg && <div className={`msg show ${msg.type}`}>{msg.text}</div>}
      {scanLog.length > 0 && (
        <div className="scan-log show">
          {scanLog.map((l, i) => <span key={i} className={l.cls}>{l.text}{"\n"}</span>)}
        </div>
      )}
    </div>
  );
}
