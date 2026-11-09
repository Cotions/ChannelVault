import { useState, useEffect } from "react";
import { getYtdlpStatus, saveYtdlp } from "../lib/api";

// Browsers yt-dlp can read a cookie jar out of.
const BROWSERS = ["", "firefox", "chrome", "chromium", "brave", "edge", "opera", "vivaldi", "safari", "whale"];

export default function YtdlpSettings() {
  const [status,  setStatus]  = useState(null);
  const [browser, setBrowser] = useState("");
  const [profile, setProfile] = useState("");   // Firefox profile folder; blank = last used
  const [runtime, setRuntime] = useState("");
  const [msg,     setMsg]     = useState(null);

  async function reload() {
    try {
      const s = await getYtdlpStatus();
      setStatus(s);
      // Stored as "firefox:/path/to/profile"; the two halves get their own pickers.
      const [b, ...rest] = (s.cookies_from || "").split(":");
      setBrowser(b);
      setProfile(rest.join(":"));
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
        ytdlp_cookies_from_browser: browser && profile && isFirefox ? `${browser}:${profile}` : browser,
        ytdlp_js_runtime: runtime.trim(),
      });
      if (r.ok === false) { flash(r.error || "Save failed", "err"); return; }
      await reload();
      flash(browser ? `Using ${chosen ? `the ${chosen.name} profile's` : browser} cookies` : "Saved — no cookie jar", "ok");
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  const isFirefox = browser === "firefox";
  // Signed-in profiles first: those are the ones that get past age gates.
  const profiles  = [...(status?.firefox_profiles || [])].sort((a, b) => b.signed_in - a.signed_in);
  const signedIn  = profiles.filter(p => p.signed_in);
  const chosen    = isFirefox ? profiles.find(p => p.path === profile) : null;
  // Which jar is in use, by its profile name rather than a folder path.
  const savedJar  = (() => {
    const [b, ...rest] = (status?.cookies_from || "").split(":");
    const p = profiles.find(x => x.path === rest.join(":"));
    return p ? `${b} (${p.name})` : b;
  })();

  // Auto-detected runtimes only count when none is typed in.
  const detected = Object.keys(status?.js_available || {});
  const hasJs    = runtime.trim() || detected.length > 0;

  return (
    <>
      <div className="card-title">YouTube</div>

      <div className="folder-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field-label">
          Signed-in browser
          <select value={browser} onChange={e => setBrowser(e.target.value)}>
            {BROWSERS.map(b => <option key={b} value={b}>{b || "None"}</option>)}
          </select>
        </label>
        {isFirefox && profiles.length > 0 && (
          <label className="field-label">
            Profile
            <select value={profile} onChange={e => setProfile(e.target.value)}>
              <option value="">Last used</option>
              {profiles.map(p => (
                <option key={p.path} value={p.path}>
                  {p.name}{p.opens_by_default ? " (opens by default)" : ""}{p.signed_in ? " · signed in" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field-label" style={{ flex: 1 }}>
          <span>JavaScript runtime <span className="field-hint-inline">optional</span></span>
          <input
            type="text"
            value={runtime}
            onChange={e => setRuntime(e.target.value)}
            placeholder={detected.length ? `Found: ${detected.join(", ")}` : "node:/path/to/node"}
          />
        </label>
        <button className="btn-primary" onClick={save}>Save</button>
      </div>

      {isFirefox && profiles.length > 1 && (!chosen || !chosen.signed_in) && (
        <div className="msg show warn" style={{ marginTop: "8px" }}>
          {chosen
            ? `${chosen.name} isn't signed in to YouTube, so age-restricted videos will still fail.`
            : "With more than one profile, Last used can pick one that isn't signed in."}
          {signedIn.length > 0 && ` Pick ${signedIn.map(p => p.name).join(" or ")}: ${signedIn.length > 1 ? "they're" : "it's"} signed in.`}
        </div>
      )}

      <div className="field-hint" style={{ marginTop: "8px" }}>
        Age-restricted videos only download with the cookies of a browser where you're signed in to
        YouTube. Close Chrome-type browsers first so they can be read.
        Leave the runtime blank unless downloads fail with <em>The page needs to be reloaded</em>.
      </div>

      {status && (
        <div className="field-hint" style={{ marginTop: "8px" }}>
          yt-dlp {status.installed ? status.version : "not found"}
          {" · cookies: "}{savedJar || "none"}
          {" · js: "}{hasJs ? (runtime.trim() || detected.join(", ")) : "none"}
        </div>
      )}
      {status?.ffmpeg_missing?.length > 0 && (
        <div className="msg show err" style={{ marginTop: "8px" }}>
          {status.ffmpeg_missing.join(" and ")} not found. Install ffmpeg: without it webm/mkv
          files can't be read, and chapters, frame grabs and writing tags don't work.
        </div>
      )}

      {msg && <div className={`msg show ${msg.type}`}>{msg.text}</div>}
    </>
  );
}
