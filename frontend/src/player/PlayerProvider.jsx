import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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
  const [dockEl,      setDockEl]      = useState(null);
  const [miniBodyEl,  setMiniBodyEl]  = useState(null);

  const videoRef = useRef(null);
  const watchRef = useRef(fresh());

  // Stable refs so the context callbacks never change identity (keeps VideoPage effects simple).
  const activeIdRef    = useRef(null);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

  // A detached <div> React always portals into. We move THIS node between the page
  // dock and the mini frame with appendChild — React never reparents the <video>,
  // so playback is never reloaded.
  const hostRef = useRef(null);
  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "cv-player-host";
  }

  const reportProgress = useCallback(async () => {
    const w = watchRef.current;
    const vid = activeIdRef.current;
    if (!vid || w.watched < 1) return;
    if (w.posting && w.sessionId == null) return; // avoid creating a 2nd session in-flight (StrictMode)
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
    if (activeIdRef.current && activeIdRef.current !== id) {
      reportProgress();                 // flush the previous video's session
      watchRef.current = fresh();
    } else if (activeIdRef.current !== id) {
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

  const setDock   = useCallback((el) => setDockEl(el), []);
  const setPosterUrl = useCallback((url) => setPoster(url || null), []);

  // Move the persistent host into whichever container is active.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !activeId) return;
    const target = mode === "inline" ? dockEl : miniBodyEl;
    if (target && host.parentNode !== target) target.appendChild(host);
  }, [activeId, mode, dockEl, miniBodyEl]);

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
  function handleError() { if (mode === "mini") stop(); else setError(true); }

  const ctx = {
    activeId, mode, error, completedId,
    openInline, onLeavePage, close: stop, setDock, setPoster: setPosterUrl,
  };

  return (
    <PlayerCtx.Provider value={ctx}>
      {children}

      {activeId && mode === "mini" && (
        <div className="cv-mini">
          <div className="cv-mini-bar">
            <button className="cv-mini-btn" title="Expand" onClick={() => navigate(`/video/${activeId}`)}>⤢</button>
            <span className="cv-mini-title">{title}</span>
            <button className="cv-mini-btn" title="Close" onClick={stop}>✕</button>
          </div>
          <div className="cv-mini-body" ref={setMiniBodyEl} />
        </div>
      )}

      {activeId && hostRef.current && createPortal(
        <video
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
        />,
        hostRef.current,
      )}
    </PlayerCtx.Provider>
  );
}
