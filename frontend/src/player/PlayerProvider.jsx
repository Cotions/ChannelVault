import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { streamUrl, thumbUrl, postWatchProgress, watchBeacon } from "../lib/api";
import { PlayerCtx } from "./playerContext";
import QueueBar from "./QueueBar";
import Icon from "../components/Icon";

const fresh = () => ({ watched: 0, lastTime: null, sessionId: null, completed: false, reported: 0, posting: false });

export default function PlayerProvider({ onCompleted, children }) {
  const navigate = useNavigate();
  const [activeId,    setActiveId]    = useState(null);
  const [title,       setTitle]       = useState("");
  const [mode,        setMode]        = useState("inline"); // "inline" | "mini"
  const [poster,      setPoster]      = useState(null);
  const [error,       setError]       = useState(false);
  const [completedId, setCompletedId] = useState(null);
  // Segment play mode: { items, idx, orig, meta: {tagId, tagName, color}, shuffle, loop } | null
  const [queue,       setQueue]       = useState(null);

  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const dockRef  = useRef(null);   // the placeholder slot on the video page
  const watchRef = useRef(fresh());

  // Stable mirrors so the rAF loop / context callbacks read latest without re-subscribing.
  const activeIdRef    = useRef(null);
  const modeRef        = useRef("inline");
  const onCompletedRef = useRef(onCompleted);
  const queueRef       = useRef(null);
  const pendingSeekRef = useRef(null);   // seconds to jump to once the next file has metadata
  const advancingRef   = useRef(false);  // one advance per item end
  const queueLoadRef   = useRef(false);  // true while the queue itself switches video
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

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

  const clearQueue = useCallback(() => {
    queueRef.current = null;
    pendingSeekRef.current = null;
    setQueue(null);
  }, []);

  const stop = useCallback(() => {
    reportProgress();
    videoRef.current?.pause();
    clearQueue();
    setActiveId(null);
    setMode("inline");
    watchRef.current = fresh();
  }, [reportProgress, clearQueue]);

  // Swap the file without touching the mode. openInline builds on this.
  const loadVideo = useCallback((id, title) => {
    if (activeIdRef.current !== id) {
      if (activeIdRef.current) reportProgress(); // flush previous video
      watchRef.current = fresh();
    }
    setActiveId(id);
    if (title != null) setTitle(title);
    setError(false);
  }, [reportProgress]);

  const openInline = useCallback((id, meta = {}) => {
    // A page opening some other video by hand ends the segment queue; the queue
    // moving itself, or the page catching up with the queue, does not.
    const q = queueRef.current;
    if (q && !queueLoadRef.current && q.items[q.idx]?.video_id !== id) clearQueue();
    loadVideo(id, meta.title);
    setMode("inline");
  }, [loadVideo, clearQueue]);

  const onLeavePage = useCallback(() => {
    const el = videoRef.current;
    if (el && !el.paused && !el.ended) setMode("mini"); // still playing → minimize
    else stop();                                         // paused/ended → close
  }, [stop]);

  const setDock      = useCallback((el) => { dockRef.current = el; }, []);
  const setPosterUrl = useCallback((url) => setPoster(url || null), []);

  // Transport for the page: jump to a second and (by default) start playing.
  // Consumers that need the live position subscribe to the element themselves
  // via usePlaybackTime, so nothing here rerenders on every tick.
  const seek = useCallback((secs, { play = true } = {}) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, secs || 0);
    if (play) el.play().catch(() => {});
  }, []);
  const play  = useCallback(() => { videoRef.current?.play().catch(() => {}); }, []);
  const pause = useCallback(() => { videoRef.current?.pause(); }, []);

  // ---- segment queue ------------------------------------------------------
  // Items: { segment_id, video_id, video_title, start_secs, end_secs, title }.
  // Playing one means: make sure its file is loaded, jump to start, and when the
  // playhead reaches end move to the next item, switching files as needed.

  const loadItem = useCallback((q, idx) => {
    const item = q.items[idx];
    if (!item) return;
    advancingRef.current = false;
    const next = { ...q, idx };
    queueRef.current = next;
    setQueue(next);
    const el = videoRef.current;
    if (activeIdRef.current === item.video_id && el) {
      el.currentTime = item.start_secs || 0;
      el.play().catch(() => {});
      return;
    }
    pendingSeekRef.current = item.start_secs || 0;
    queueLoadRef.current = true;
    try {
      loadVideo(item.video_id, item.video_title);
      // On the video page, follow the queue so title and segments match the sound.
      if (modeRef.current === "inline") navigate(`/video/${item.video_id}`);
    } finally {
      // The page's own openInline for this id runs after render; keep the flag
      // up until then so it is read as "catching up", not "user picked another".
      setTimeout(() => { queueLoadRef.current = false; }, 0);
    }
  }, [loadVideo, navigate]);

  const shuffled = (items, keepFirst) => {
    const rest = keepFirst ? items.filter(i => i !== keepFirst) : [...items];
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return keepFirst ? [keepFirst, ...rest] : rest;
  };

  const playQueue = useCallback((items, meta = {}, startIdx = 0, { shuffle = false } = {}) => {
    if (!items || items.length === 0) return;
    const orig  = [...items];
    const first = items[Math.min(startIdx, items.length - 1)];
    const list  = shuffle ? shuffled(orig, first) : orig;
    const q = { items: list, idx: shuffle ? 0 : Math.min(startIdx, items.length - 1), orig, meta, shuffle, loop: false };
    loadItem(q, q.idx);
  }, [loadItem]);

  const queueStep = useCallback((dir) => {
    const q = queueRef.current;
    if (!q) return;
    let idx = q.idx + dir;
    if (idx >= q.items.length) {
      if (!q.loop) { clearQueue(); videoRef.current?.pause(); return; }
      idx = 0;
    }
    if (idx < 0) idx = q.loop ? q.items.length - 1 : 0;
    loadItem(q, idx);
  }, [loadItem, clearQueue]);
  const queueNext = useCallback(() => queueStep(1),  [queueStep]);
  const queuePrev = useCallback(() => queueStep(-1), [queueStep]);

  const toggleShuffle = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    const cur = q.items[q.idx];
    const next = q.shuffle
      ? { ...q, shuffle: false, items: q.orig, idx: Math.max(0, q.orig.indexOf(cur)) }
      : { ...q, shuffle: true,  items: shuffled(q.orig, cur), idx: 0 };
    queueRef.current = next;
    setQueue(next);
  }, []);
  const toggleLoop = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    const next = { ...q, loop: !q.loop };
    queueRef.current = next;
    setQueue(next);
  }, []);

  function handleLoadedMetadata(e) {
    if (pendingSeekRef.current == null) return;
    const el = e.target;
    el.currentTime = pendingSeekRef.current;
    pendingSeekRef.current = null;
    el.play().catch(() => {});
  }
  function queueTick(t) {
    const q = queueRef.current;
    if (!q || advancingRef.current) return;
    const item = q.items[q.idx];
    if (item && item.end_secs != null && t >= item.end_secs - 0.25) {
      advancingRef.current = true;
      queueStep(1);
    }
  }
  function handleEnded() {
    reportProgress();
    if (queueRef.current && !advancingRef.current) { advancingRef.current = true; queueStep(1); }
  }

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
    queueTick(t);
  }
  function handleSeeked(e) { watchRef.current.lastTime = e.target.currentTime; }
  function handleError() { if (modeRef.current === "mini") stop(); else setError(true); }

  const ctx = {
    activeId, mode, error, completedId, title,
    openInline, onLeavePage, close: stop, setDock, setPoster: setPosterUrl,
    videoRef, seek, play, pause,
    queue, playQueue, queueNext, queuePrev, toggleShuffle, toggleLoop, clearQueue,
  };

  return (
    <PlayerCtx.Provider value={ctx}>
      {children}

      {activeId && (
        <div ref={shellRef} className={`cv-shell cv-shell-${mode}`}>
          {mode === "mini" && (
            <div className="cv-mini-bar" key="bar">
              <button className="cv-mini-btn" title="Expand" onClick={() => navigate(`/video/${activeId}`)}><Icon name="expand" size={14} /></button>
              <span className="cv-mini-title">{title}</span>
              <button className="cv-mini-btn" title="Close" onClick={stop}><Icon name="close" size={14} /></button>
            </div>
          )}
          {mode === "mini" && queue && <QueueBar compact />}
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
            onLoadedMetadata={handleLoadedMetadata}
            onPause={reportProgress}
            onEnded={handleEnded}
          />
        </div>
      )}
    </PlayerCtx.Provider>
  );
}
