import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { streamUrl, thumbUrl, postWatchProgress, watchBeacon } from "../lib/api";
import { PlayerCtx } from "./playerContext";

const fresh = () => ({ watched: 0, lastTime: null, sessionId: null, completed: false, reported: 0, posting: false });

export default function PlayerProvider({ onCompleted, children }) {
  const navigate = useNavigate();
  const [activeId,    setActiveId]    = useState(null);
  const [title,       setTitle]       = useState("");
  const [mode,        setMode]        = useState("inline"); // "inline" | "mini"
  const [poster,      setPoster]      = useState(null);
  const [error,       setError]       = useState(false);
  const [completedId, setCompletedId] = useState(null);

  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const dockRef  = useRef(null);   // the placeholder slot on the video page
  const watchRef = useRef(fresh());

  // Stable mirrors so the rAF loop / context callbacks read latest without re-subscribing.
  const activeIdRef    = useRef(null);
  const modeRef        = useRef("inline");
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

  const reportProgress = useCallback(async () => {
    const w = watchRef.current;
    const vid = activeIdRef.current;
    if (!vid || w.watched < 1) return;
    if (w.posting && w.sessionId == null) return; // avoid a 2nd session in-flight (StrictMode)
    const el = videoRef.current;
    w.posting = true;
    try {
      const r = await postWatchProgress(vid, {
        session_id:    w.sessionId,
        watched_secs:  w.watched,
        position_secs: el ? el.currentTime : 0,
        duration_secs: el && el.duration ? el.duration : null,
      });
      w.sessionId = r.session_id;
      w.reported  = w.watched;
      if (r.completed && !w.completed) {
        w.completed = true;
        setCompletedId(vid);
        onCompletedRef.current?.();
      }
    } catch { /* ignore */ } finally { w.posting = false; }
  }, []);

  const stop = useCallback(() => {
    reportProgress();
    videoRef.current?.pause();
    setActiveId(null);
    setMode("inline");
    watchRef.current = fresh();
  }, [reportProgress]);

  const openInline = useCallback((id, meta = {}) => {
    if (activeIdRef.current !== id) {
      if (activeIdRef.current) reportProgress(); // flush previous video
      watchRef.current = fresh();
    }
    setActiveId(id);
    if (meta.title != null) setTitle(meta.title);
    setError(false);
    setMode("inline");
  }, [reportProgress]);

  const onLeavePage = useCallback(() => {
    const el = videoRef.current;
    if (el && !el.paused && !el.ended) setMode("mini"); // still playing → minimize
    else stop();                                         // paused/ended → close
  }, [stop]);

  const setDock      = useCallback((el) => { dockRef.current = el; }, []);
  const setPosterUrl = useCallback((url) => setPoster(url || null), []);

  // Clear inline positioning when leaving inline so the .cv-shell-mini CSS takes over.
  useEffect(() => {
    if (mode !== "inline" && shellRef.current) {
      const s = shellRef.current.style;
      s.left = s.top = s.width = s.height = "";
    }
  }, [mode]);

  // Keep the never-unmounted shell overlaying the page dock while inline.
  // The <video> stays in the shell the whole time, so it never pauses on navigation.
  useEffect(() => {
    let raf;
    const place = () => {
      const shell = shellRef.current;
      const dock  = dockRef.current;
      if (shell && activeIdRef.current && modeRef.current === "inline" && dock) {
        const r = dock.getBoundingClientRect();
        shell.style.left   = `${r.left}px`;
        shell.style.top    = `${r.top}px`;
        shell.style.width  = `${r.width}px`;
        shell.style.height = `${r.height}px`;
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Best-effort flush if the tab/window closes (fetch wouldn't finish).
  useEffect(() => {
    const onHide = () => {
      const w = watchRef.current;
      const el = videoRef.current;
      if (activeIdRef.current && w.watched >= 1) {
        watchBeacon(activeIdRef.current, {
          session_id:    w.sessionId,
          watched_secs:  w.watched,
          position_secs: el ? el.currentTime : 0,
          duration_secs: el && el.duration ? el.duration : null,
        });
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  function handleTimeUpdate(e) {
    const w = watchRef.current;
    const t = e.target.currentTime;
    if (w.lastTime != null) {
      const delta = t - w.lastTime;
      if (delta > 0 && delta < 2) w.watched += delta; // big jumps are seeks → ignore
    }
    w.lastTime = t;
    if (w.watched - w.reported >= 15) reportProgress();
  }
  function handleSeeked(e) { watchRef.current.lastTime = e.target.currentTime; }
  function handleError() { if (modeRef.current === "mini") stop(); else setError(true); }

  const ctx = {
    activeId, mode, error, completedId,
    openInline, onLeavePage, close: stop, setDock, setPoster: setPosterUrl,
  };

  return (
    <PlayerCtx.Provider value={ctx}>
      {children}

      {activeId && (
        <div ref={shellRef} className={`cv-shell cv-shell-${mode}`}>
          {mode === "mini" && (
            <div className="cv-mini-bar" key="bar">
              <button className="cv-mini-btn" title="Expand" onClick={() => navigate(`/video/${activeId}`)}>⤢</button>
              <span className="cv-mini-title">{title}</span>
              <button className="cv-mini-btn" title="Close" onClick={stop}>✕</button>
            </div>
          )}
          <video
            key="cv-video"
            ref={videoRef}
            className="cv-video"
            controls
            preload="metadata"
            poster={poster || thumbUrl(activeId)}
            src={streamUrl(activeId)}
            onError={handleError}
            onPlay={() => setError(false)}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleSeeked}
            onPause={reportProgress}
            onEnded={reportProgress}
          />
        </div>
      )}
    </PlayerCtx.Provider>
  );
}
