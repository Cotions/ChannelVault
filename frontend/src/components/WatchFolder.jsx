import { useState, useEffect } from "react";
import { saveConfig, saveDataDir, saveMediaRoots, browse, browseData, scan } from "../lib/api";
import Icon from "./Icon";

export default function WatchFolder({ initialDir, initialDataDir, initialRoots, onScanDone, embedded = false }) {
  const [dir,     setDir]     = useState(initialDir     || "");
  const [dataDir, setDataDir] = useState(initialDataDir || "");
  const [roots,   setRoots]   = useState(initialRoots   || []);

  useEffect(() => { if (initialDir)     setDir(initialDir); },     [initialDir]);
  useEffect(() => { if (initialDataDir) setDataDir(initialDataDir); }, [initialDataDir]);
  useEffect(() => { if (initialRoots)   setRoots(initialRoots); },   [initialRoots]);
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

  function setRoot(i, val) {
    setRoots(prev => prev.map((r, idx) => (idx === i ? val : r)));
  }
  function addRoot()     { setRoots(prev => [...prev, ""]); }
  function removeRoot(i) { setRoots(prev => prev.filter((_, idx) => idx !== i)); }

  async function browseRoot(i) {
    try {
      const data = await browse();
      if (data.ok && data.directory) setRoot(i, data.directory);
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleSaveRoots() {
    try {
      const clean = roots.map(r => r.trim()).filter(Boolean);
      const data  = await saveMediaRoots(clean);
      if (data.ok) { setRoots(clean); flash(`Saved ${clean.length} media root(s)`, "ok"); }
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

      <div className="card-title" style={{ marginTop: "16px" }}>Media Roots</div>
      {roots.map((r, i) => (
        <div className="folder-row" key={i} style={{ marginBottom: "6px" }}>
          <input
            type="text"
            value={r}
            onChange={e => setRoot(i, e.target.value)}
            placeholder="/home/you/Videos  or  D:\\Media\\Videos"
          />
          <button className="btn-secondary" onClick={() => browseRoot(i)}>Browse…</button>
          <button className="btn-ghost" onClick={() => removeRoot(i)} title="Remove"><Icon name="close" size={13} /></button>
        </div>
      ))}
      <div className="folder-row">
        <button className="btn-secondary" onClick={addRoot}>+ Add root</button>
        <button className="btn-primary" onClick={handleSaveRoots}>Save Roots</button>
      </div>
      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
        Folders where your videos live. Files are matched even if moved or stored across
        several drives. Add both Windows and Linux paths — missing ones are ignored, so one
        config works on either machine. The watch folder is always searched too.
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
