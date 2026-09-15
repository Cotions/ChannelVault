import { useState, useEffect } from "react";
import { getYtdlpStatus, saveYtdlp } from "../lib/api";

// Browsers yt-dlp can read a cookie jar out of.
const BROWSERS = ["", "firefox", "chrome", "chromium", "brave", "edge", "opera", "vivaldi", "safari", "whale"];

export default function YtdlpSettings() {
  const [status,  setStatus]  = useState(null);
  const [browser, setBrowser] = useState("");
  const [runtime, setRuntime] = useState("");
  const [msg,     setMsg]     = useState(null);

  async function reload() {
    try {
      const s = await getYtdlpStatus();
      setStatus(s);
      setBrowser(s.cookies_from || "");
      setRuntime(s.js_runtime || "");
    } catch {
      setStatus({ ok: false });
    }
  }

  useEffect(() => { reload(); }, []);

  function flash(text, type) {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  async function save() {
    try {
      const r = await saveYtdlp({
        ytdlp_cookies_from_browser: browser,
        ytdlp_js_runtime: runtime.trim(),
      });
      if (r.ok === false) { flash(r.error || "Save failed", "err"); return; }
      await reload();
      flash(browser ? `Using ${browser} cookies` : "Saved — no cookie jar", "ok");
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  // Auto-detected runtimes only count when none is typed in.
  const detected = Object.keys(status?.js_available || {});
  const hasJs    = runtime.trim() || detected.length > 0;

  return (
    <>
      <div className="card-title" style={{ marginTop: "16px" }}>YouTube Fetching</div>

      <div className="folder-row">
        <select value={browser} onChange={e => setBrowser(e.target.value)}>
          {BROWSERS.map(b => <option key={b} value={b}>{b || "No cookies"}</option>)}
        </select>
        <input
          type="text"
          value={runtime}
          onChange={e => setRuntime(e.target.value)}
          placeholder={detected.length ? `auto: ${detected.join(", ")}` : "node:/path/to/node"}
        />
        <button className="btn-primary" onClick={save}>Save</button>
      </div>

      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
        Age-restricted videos fail with <em>Sign in to confirm your age</em> unless yt-dlp can
        read a signed-in cookie jar from your browser. No player client gets around it. Videos
        parked as <strong>Age-gated</strong> go back in the queue as soon as you pick a browser
        here. Chromium-based browsers must be fully closed while the cookies are read.
        <br />
        The second field is a JavaScript runtime, needed to solve YouTube's <code>n</code> challenge.
        Without it a fetch that clears the age gate still dies with <em>The page needs to be
        reloaded</em>. Leave it blank to use whatever is on PATH.
      </div>

      {status && (
        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "8px", fontFamily: "var(--mono)" }}>
          yt-dlp {status.installed ? status.version : "not found"}
          {" · cookies: "}{status.cookies_from || "none"}
          {" · js: "}{hasJs ? (runtime.trim() || detected.join(", ")) : "none"}
        </div>
      )}

      {msg && <div className={`msg show ${msg.type}`}>{msg.text}</div>}
    </>
  );
}
