import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { streamUrl, thumbUrl, audioTrackUrl, postWatchProgress, watchBeacon } from "../lib/api";
import { PlayerCtx } from "./playerContext";
import * as graph from "./audioGraph";
import QueueBar from "./QueueBar";
import PlayerControls from "./PlayerControls";
import Icon from "../components/Icon";

// Past this much apart, an alternate soundtrack is audibly off the picture.
const AUDIO_DRIFT = 0.25;

const fresh = () => ({ watched: 0, lastTime: null, sessionId: null, completed: false, reported: 0, posting: false });

// Volume outlives the page: a library that plays quiet plays quiet every night.
const readStored = (key, fallback) => {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

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
  // Alternate soundtrack for the current video, or null for the file's own audio.
  const [audioTrack,  setAudioTrack]  = useState(null);
  // What the pages publish for the controls to draw: this video's parts and the
  // soundtracks attached to it. The bar lives above every page, so it cannot go
  // and fetch them itself without duplicating the page's request. Both carry the
  // video they describe, because a page's fetch and the player's own switch land
  // in whichever order the network decides.
  const [segments,    setSegments]    = useState({ id: null, list: [] });
  const [audioTracks, setAudioTracks] = useState({ id: null, list: [] });
  // One loudness for whichever soundtrack is audible. Past 1 it is carried by
  // the WebAudio graph, which is the only way past the element's ceiling.
  const [volume,      setVolumeState]   = useState(() => readStored("cv.volume", 1));
  const [muted,       setMuted]         = useState(false);
  const [levelling,   setLevellingState] = useState(() => localStorage.getItem("cv.levelling") === "1");
  const [rate,        setRateState]   = useState(1);
  const [fullscreen,  setFullscreen]  = useState(false);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
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
  const fsRef          = useRef(false);  // fullscreen, read by the placement loop
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Alternate audio: the video plays silent and a parallel <audio> element
  // carries the sound. Every transport the user touches (play, pause, seek,
  // speed) is mirrored onto it, and drift is pulled back on the tick.
  const trackRef    = useRef(null);   // latest audioTrack, for the handlers
  const lastAudioEl = useRef(null);   // the element the graph is hooked into
  useEffect(() => { trackRef.current = audioTrack; }, [audioTrack]);

  const syncAudio = useCallback((force = false) => {
    const v = videoRef.current, a = audioRef.current, track = trackRef.current;
    if (!v || !a || !track) return;
    const target = Math.max(0, v.currentTime + (track.offset_secs || 0));
    if (force || Math.abs(a.currentTime - target) > AUDIO_DRIFT) a.currentTime = target;
    if (a.playbackRate !== v.playbackRate) a.playbackRate = v.playbackRate;
    if (v.paused || v.ended) { if (!a.paused) a.pause(); }
    else if (a.paused) a.play().catch(() => {});
  }, []);

  const selectAudioTrack = useCallback((track) => setAudioTrack(track || null), []);

  // Building the graph is only safe under a gesture: an AudioContext created
  // cold starts suspended, and a suspended context on the output path is
  // silence, not merely no boost. A stored boost from last night must therefore
  // wait for the first play or the first touch of the volume.
  const gestureRef = useRef(false);
  const setVolume = useCallback((v) => { gestureRef.current = true; setVolumeState(v); }, []);
  const setLevelling = useCallback((on) => { gestureRef.current = true; setLevellingState(on); }, []);

  const publishSegments    = useCallback((id, list) => setSegments({ id, list: list || [] }), []);
  const publishAudioTracks = useCallback((id, list) => setAudioTracks({ id, list: list || [] }), []);

  // ---- loudness -----------------------------------------------------------
  // One place decides how loud everything is. Below 100% with the leveller off
  // the elements do it themselves and no AudioContext is ever created; the
  // moment either is asked for, both elements move into the graph for good.
  const applyAudio = useCallback(() => {
    const v = videoRef.current, a = audioRef.current;
    if (!v) return;
    const wantGraph = (volume > 1 || levelling) && (gestureRef.current || !v.paused);
    if ((wantGraph || graph.live()) && graph.ensure() && graph.attach(v)) {
      // A track's <audio> is keyed by track id, so switching tracks replaces the
      // element; unhook the old one or its branch of the graph outlives it.
      if (lastAudioEl.current && lastAudioEl.current !== a) graph.detach(lastAudioEl.current);
      lastAudioEl.current = a;
      if (a) graph.attach(a);
      graph.resume();
      graph.setLevelling(levelling);
      graph.setVolume(muted ? 0 : volume);
      // Two ways to silence the picture under an alternate track: the element's
      // own mute and its branch of the graph. Which one bites depends on the
      // browser, so both are set.
      graph.elementGain(v, audioTrack ? 0 : 1);
      v.muted  = !!audioTrack;
      v.volume = 1;
      if (a) { graph.elementGain(a, 1); a.muted = false; a.volume = 1; }
    } else {
      v.volume = Math.min(1, volume);
      v.muted  = muted || !!audioTrack;
      if (a) { a.volume = Math.min(1, volume); a.muted = muted; }
    }
  }, [volume, muted, levelling, audioTrack]);

  useEffect(() => { applyAudio(); }, [applyAudio, activeId]);
  useEffect(() => { localStorage.setItem("cv.volume", String(volume)); }, [volume]);
  useEffect(() => { localStorage.setItem("cv.levelling", levelling ? "1" : "0"); }, [levelling]);

  // Hand the sound over (or take it back) whenever the chosen track changes.
  useEffect(() => {
    const a = audioRef.current;
    if (!audioTrack) { a?.pause(); return; }
    if (a) a.playbackRate = videoRef.current?.playbackRate || 1;
    syncAudio(true);
  }, [audioTrack, syncAudio]);

  const setRate = useCallback((r) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
    setRateState(r);
    syncAudio(true);
  }, [syncAudio]);

  const reportProgress = useCallback(async () => {
    const w = watchRef.current;
    const vid = activeIdRef.current;
    if (!vid || w.watched < 1) return;
    if (w.posting && w.sessionId == null) return; // avoid a 2nd session in-flight (StrictMode)
    const el = videoRef.current;
    const sent = w.watched;             // seconds added while this is in flight go out next time
    w.posting = true;
    try {
      const r = await postWatchProgress(vid, {
        session_id:    w.sessionId,
        watched_secs:  sent,
        position_secs: el ? el.currentTime : 0,
        duration_secs: el && el.duration ? el.duration : null,
      });
      if (r.session_id != null) w.sessionId = r.session_id;
      w.reported  = sent;
      if (r.completed && !w.completed) {
        w.completed = true;
        setCompletedId(vid);
        onCompletedRef.current?.();
      }
    } catch {
      w.reported = sent;                // backend down: retry after the next 15 s, not on every tick
    } finally { w.posting = false; }
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

  // A video deleted from the library (App fires "cv:video-deleted") stops
  // playing and leaves the queue; no progress is posted for it.
  useEffect(() => {
    const onDeleted = (e) => {
      const id = e.detail;
      const q  = queueRef.current;
      if (q && q.items.some(i => i.video_id === id)) {
        const cur   = q.items[q.idx];
        const items = q.items.filter(i => i.video_id !== id);
        if (items.length === 0 || cur.video_id === id) clearQueue();
        else {
          const next = { ...q, items, orig: q.orig.filter(i => i.video_id !== id), idx: items.indexOf(cur) };
          queueRef.current = next;
          setQueue(next);
        }
      }
      if (activeIdRef.current === id) {
        watchRef.current = fresh();
        videoRef.current?.pause();
        setActiveId(null);
        setMode("inline");
      }
    };
    window.addEventListener("cv:video-deleted", onDeleted);
    return () => window.removeEventListener("cv:video-deleted", onDeleted);
  }, [clearQueue]);

  // Swap the file without touching the mode. openInline builds on this.
  const loadVideo = useCallback((id, title) => {
    if (activeIdRef.current !== id) {
      if (activeIdRef.current) reportProgress(); // flush previous video
      watchRef.current = fresh();
      setAudioTrack(null);                       // tracks belong to one video
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
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }, []);

  // ---- fullscreen ---------------------------------------------------------
  // The shell goes fullscreen, not the <video>: the controls are ours and sit
  // beside it, and a fullscreen <video> would take the picture and leave them.
  const toggleFullscreen = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement && document.fullscreenElement === shellRef.current;
      fsRef.current = on;
      setFullscreen(on);
      // Inline placement writes left/top/width/height; fullscreen needs them gone.
      if (on && shellRef.current) {
        const s = shellRef.current.style;
        s.left = s.top = s.width = s.height = "";
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

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
    const el = e.target;
    if (el.playbackRate !== rate) el.playbackRate = rate;
    applyAudio();
    if (pendingSeekRef.current == null) return;
    el.currentTime = pendingSeekRef.current;
    pendingSeekRef.current = null;
    el.play().catch(() => {});
    syncAudio(true);
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
    audioRef.current?.pause();
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
      if (shell && !fsRef.current && activeIdRef.current && modeRef.current === "inline" && dock) {
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
      // The first post is still out: a beacon without its session id would start a second session.
      if (activeIdRef.current && w.watched >= 1 && !(w.posting && w.sessionId == null)) {
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
    if (e.target.seeking) return;      // a drag fires timeupdate at each new spot before seeked
    if (w.lastTime != null) {
      const delta = t - w.lastTime;
      if (delta > 0 && delta < 2) w.watched += delta; // big jumps are seeks → ignore
    }
    w.lastTime = t;
    if (w.watched - w.reported >= 15) reportProgress();
    syncAudio();
    queueTick(t);
  }
  function handleSeeking() { watchRef.current.lastTime = null; }
  function handleSeeked(e) { watchRef.current.lastTime = e.target.currentTime; syncAudio(true); }
  function handleError() { if (modeRef.current === "mini") stop(); else setError(true); }

  // The picture stalls on its own buffer; hold the sound until it is back.
  function handleWaiting() { if (trackRef.current) audioRef.current?.pause(); }
  function handlePlaying() { syncAudio(true); }

  // A track that will not play is worse than no track: fall back to the original.
  function handleAudioError() { setAudioTrack(null); }

  const ctx = {
    activeId, mode, error, completedId, title,
    openInline, onLeavePage, close: stop, setDock, setPoster: setPosterUrl,
    videoRef, seek, play, pause, togglePlay,
    queue, playQueue, queueNext, queuePrev, toggleShuffle, toggleLoop, clearQueue,
    audioTrack, selectAudioTrack,
    audioTracks: audioTracks.id === activeId ? audioTracks.list : [],
    setAudioTracks: publishAudioTracks,
    segments: segments.id === activeId ? segments.list : [],
    setSegments: publishSegments,
    volume, setVolume, muted, setMuted, levelling, setLevelling,
    rate, setRate, fullscreen, toggleFullscreen,
  };

  return (
    <PlayerCtx.Provider value={ctx}>
      {children}

      {activeId && (
        <div ref={shellRef} className={`cv-shell cv-shell-${mode}${fullscreen ? " cv-shell-fs" : ""}`}>
          {mode === "mini" && (
            <div className="cv-mini-bar" key="bar">
              <button className="cv-mini-btn" title="Expand" onClick={() => navigate(`/video/${activeId}`)}><Icon name="expand" size={14} /></button>
              <span className="cv-mini-title">{title}</span>
              <button className="cv-mini-btn" title="Close" onClick={stop}><Icon name="close" size={14} /></button>
            </div>
          )}
          {mode === "mini" && queue && <QueueBar compact />}
          <div className="cv-stage" onClick={togglePlay} onDoubleClick={toggleFullscreen}>
            <video
              key="cv-video"
              ref={videoRef}
              className="cv-video"
              playsInline
              preload="metadata"
              poster={poster || thumbUrl(activeId)}
              src={streamUrl(activeId)}
              onError={handleError}
              onPlay={() => { setError(false); gestureRef.current = true; applyAudio(); syncAudio(true); }}
              onTimeUpdate={handleTimeUpdate}
              onSeeking={handleSeeking}
              onSeeked={handleSeeked}
              onLoadedMetadata={handleLoadedMetadata}
              onPause={() => { reportProgress(); audioRef.current?.pause(); }}
              onEnded={handleEnded}
              onWaiting={handleWaiting}
              onPlaying={handlePlaying}
              onRateChange={e => { setRateState(e.target.playbackRate); syncAudio(true); }}
            />
          </div>
          <PlayerControls compact={mode === "mini"} />
          {audioTrack && (
            <audio
              key={`cv-audio-${audioTrack.id}`}
              ref={audioRef}
              preload="auto"
              src={audioTrackUrl(audioTrack.id)}
              onLoadedMetadata={() => { applyAudio(); syncAudio(true); }}
              onError={handleAudioError}
            />
          )}
        </div>
      )}
    </PlayerCtx.Provider>
  );
}
