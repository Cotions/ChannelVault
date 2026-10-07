import { useEffect, useRef, useState, useCallback } from "react";
import { usePlayer } from "./playerContext";
import { fmtTime } from "../lib/fmt";
import Icon from "../components/Icon";

/* The player's own chrome, replacing the browser's.

   Native controls could not be made to tell the truth here. With an alternate
   soundtrack the picture is held muted, so the native speaker claims silence
   over sound that is plainly playing; the volume slider cannot go past 100% on
   a library full of quiet rips; and nothing in it knows what a segment is.
   This bar owns all three: one volume for whichever soundtrack is audible, the
   tagged parts of the video drawn straight into the scrub bar, and a track
   picker that also works from the mini player and from fullscreen.

   The playhead is written to the DOM from a rAF loop, not through state. The
   shell wraps every page, so re-rendering it sixty times a second to move one
   div would be paid for by the whole app. */

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const VOL_MAX = 3;      // 300%: the point of the graph is headroom past 100%
const HIDE_MS = 2200;   // idle pointer time before the bar fades while playing

const pct = (v, total) => `${Math.min(100, Math.max(0, total ? (v / total) * 100 : 0))}%`;

export default function PlayerControls({ compact = false }) {
  const player = usePlayer();
  const {
    videoRef, activeId, queue, segments, audioTracks, audioTrack, selectAudioTrack,
    volume, setVolume, muted, setMuted, levelling, setLevelling,
    rate, setRate, fullscreen, toggleFullscreen, seek, queueNext, queuePrev,
  } = player;

  const ctlRef   = useRef(null);
  const wakeRef  = useRef(null);
  const trackRef = useRef(null);
  const fillRef  = useRef(null);
  const bufRef   = useRef(null);
  const headRef  = useRef(null);
  const tipRef   = useRef(null);
  const timeRef  = useRef(null);
  const scrubRef = useRef(false);

  const [duration, setDuration] = useState(0);
  const [paused,   setPaused]   = useState(true);
  const [menu,     setMenu]     = useState(null);   // "speed" | "audio" | null
  const [idle,     setIdle]     = useState(false);
  const idleRef  = useRef(null);   // the one timer that hides the bar
  const menuRef  = useRef(null);
  useEffect(() => { menuRef.current = menu; }, [menu]);

  // Duration and paused move rarely enough to live in state; position does not.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const read = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setPaused(el.paused);
      if (el.paused) { clearTimeout(idleRef.current); setIdle(false); }  // a paused bar never hides
      else wakeRef.current?.();                                          // playing again: start the countdown
    };
    read();
    const events = ["loadedmetadata", "durationchange", "play", "pause", "ended", "emptied"];
    events.forEach(e => el.addEventListener(e, read));
    return () => events.forEach(e => el.removeEventListener(e, read));
  }, [videoRef, activeId]);

  // Playhead, buffer and the clock, painted straight onto the nodes.
  useEffect(() => {
    let raf, lastSec = -1;
    const paint = () => {
      const el = videoRef.current;
      const total = el && Number.isFinite(el.duration) ? el.duration : 0;
      if (el && total) {
        const p = pct(el.currentTime, total);
        if (fillRef.current) fillRef.current.style.width = p;
        if (headRef.current) headRef.current.style.left  = p;
        const sec = Math.floor(el.currentTime);
        if (sec !== lastSec && timeRef.current) {
          lastSec = sec;
          timeRef.current.textContent = fmtTime(el.currentTime);
        }
        if (bufRef.current && el.buffered.length) {
          bufRef.current.style.width = pct(el.buffered.end(el.buffered.length - 1), total);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  // Fade the bar out of the way while the video plays and the pointer rests.
  // One timer only: two of them racing means the bar hides while the pointer is
  // still moving, which reads as the hover doing nothing.
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      if (!videoRef.current?.paused && !menuRef.current) setIdle(true);
    }, HIDE_MS);
  }, [videoRef]);
  useEffect(() => { wakeRef.current = wake; }, [wake]);
  useEffect(() => () => clearTimeout(idleRef.current), []);

  // The bar stops taking the pointer once it has faded, so it cannot be the one
  // listening for the move that brings it back. The shell around it is: any
  // pointer over the picture wakes the chrome, leaving it is what hides it.
  useEffect(() => {
    const shell = ctlRef.current?.parentElement;
    if (!shell) return;
    const onMove  = () => wake();
    const onLeave = () => { if (!videoRef.current?.paused) setIdle(true); };
    shell.addEventListener("pointermove", onMove);
    shell.addEventListener("pointerleave", onLeave);
    return () => {
      shell.removeEventListener("pointermove", onMove);
      shell.removeEventListener("pointerleave", onLeave);
    };
  }, [wake, videoRef]);

  useEffect(() => { if (!menu) wakeRef.current?.(); }, [menu]);

  // Click away or Escape closes a menu. It used to close on pointerleave, which
  // ate the click: the pointer crossing the gap between the button and the item
  // left the menu, so the item was gone by the time the click landed.
  useEffect(() => {
    if (!menu) return;
    const onDown = e => { if (!e.target.closest?.(".cv-menu-wrap")) setMenu(null); };
    const onKey  = e => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }, [videoRef]);

  const nudge = useCallback((secs) => {
    const el = videoRef.current;
    if (el) seek(el.currentTime + secs, { play: !el.paused });
  }, [videoRef, seek]);

  // ---- scrubbing ----------------------------------------------------------
  const fracAt = (e) => {
    const r = trackRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  function scrubTo(e) {
    const el = videoRef.current;
    if (!el || !duration) return;
    el.currentTime = fracAt(e) * duration;
  }
  function onScrubDown(e) {
    if (!duration) return;
    scrubRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e);
  }
  function onScrubMove(e) {
    if (scrubRef.current) scrubTo(e);
    const tip = tipRef.current;
    if (!tip || !duration) return;
    const f = fracAt(e);
    const at = f * duration;
    // Shortest match wins, the same one that paints on top at that spot.
    const seg = (segments || [])
      .filter(s => at >= s.start_secs && at <= s.end_secs)
      .sort((a, b) => (a.end_secs - a.start_secs) - (b.end_secs - b.start_secs))[0];
    tip.textContent = seg ? `${fmtTime(at)} · ${seg.title || seg.tags?.[0]?.name || "segment"}` : fmtTime(at);
    tip.style.left = `${f * 100}%`;
    tip.style.opacity = 1;
  }
  function onScrubUp()   { scrubRef.current = false; }
  function onScrubLeave() { if (tipRef.current) tipRef.current.style.opacity = 0; }

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    function onKey(e) {
      if (!activeId || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      // Space/Enter on a focused button or link presses it; taking the key
      // would toggle play and swallow the press.
      if ((e.key === " " || e.key === "Enter") && t?.closest?.("button, a[href], [role=button], [role=link], [role=menuitem]")) return;
      // In the miniplayer the page around it is what's being read: arrows
      // up/down scroll it rather than change the volume.
      if (compact && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
      const el = videoRef.current;
      if (!el) return;
      const step = v => setVolume(Math.min(VOL_MAX, Math.max(0, +(volume + v).toFixed(2))));
      switch (e.key) {
        case " ": case "k": togglePlay(); break;
        case "ArrowLeft":  nudge(-5);  break;
        case "ArrowRight": nudge(5);   break;
        case "j": nudge(-10); break;
        case "l": nudge(10);  break;
        case "ArrowUp":   step(0.05);  setMuted(false); break;
        case "ArrowDown": step(-0.05); break;
        case "m": setMuted(!muted); break;
        case "f": toggleFullscreen(); break;
        case "n": if (queue) queueNext(); break;
        case "p": if (queue) queuePrev(); break;
        case "[": setRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)] || 0.5); break;
        case "]": setRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)] || 2); break;
        default:
          if (/^[0-9]$/.test(e.key) && el.duration) seek((+e.key / 10) * el.duration, { play: !el.paused });
          else return;
      }
      e.preventDefault();
      wake();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, videoRef, volume, muted, rate, queue, togglePlay, nudge, seek,
      setVolume, setMuted, setRate, toggleFullscreen, queueNext, queuePrev, wake, compact]);

  const total    = duration || 0;
  const volPct   = Math.round((muted ? 0 : volume) * 100);
  const boosted  = !muted && volume > 1.01;
  const tracks   = audioTracks || [];

  return (
    <div
      ref={ctlRef}
      className={`cv-ctl${compact ? " cv-ctl-compact" : ""}${idle && !paused && !menu ? " is-idle" : ""}`}
    >
      <div
        className="cv-scrub"
        ref={trackRef}
        onPointerDown={onScrubDown}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubUp}
        onPointerCancel={onScrubUp}
        onPointerLeave={onScrubLeave}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        tabIndex={-1}
      >
        <div className="cv-scrub-buf"  ref={bufRef} />
        <div className="cv-scrub-fill" ref={fillRef} />
        {/* The tagged parts of the video, on the bar itself rather than only in
            the timeline below, so they are reachable from mini and fullscreen.
            Drawn over the fill and half transparent, so progress still shows
            through the parts that have been played. */}
        {total > 0 && [...(segments || [])]
          .sort((a, b) => (b.end_secs - b.start_secs) - (a.end_secs - a.start_secs))
          .map(s => (
          <div
            key={s.id}
            className="cv-scrub-seg"
            style={{
              left:  pct(s.start_secs, total),
              width: pct(Math.max(1, s.end_secs - s.start_secs), total),
              background: s.tags?.[0]?.color || "var(--muted)",
            }}
          />
        ))}
        <div className="cv-scrub-head" ref={headRef} />
        <div className="cv-scrub-tip"  ref={tipRef} />
      </div>

      <div className="cv-ctl-row">
        <button className="cv-btn" onClick={togglePlay} title={paused ? "Play (space)" : "Pause (space)"}>
          <Icon name={paused ? "play" : "pause"} size={16} className={paused ? "icon-fill" : ""} />
        </button>
        {!compact && (
          <>
            <button className="cv-btn" onClick={() => nudge(-10)} title="Back 10s (J)">
              <Icon name="skipBack" size={15} />
            </button>
            <button className="cv-btn" onClick={() => nudge(10)} title="Forward 10s (L)">
              <Icon name="skipFwd" size={15} />
            </button>
          </>
        )}
        <span className="cv-time">
          <b ref={timeRef}>0:00</b>
          <span className="cv-time-sep">/</span>
          {fmtTime(total)}
        </span>

        <span className="cv-ctl-gap" />

        <span className={`cv-vol${boosted ? " is-boosted" : ""}`}>
          <button
            className="cv-btn"
            onClick={() => setMuted(!muted)}
            title={muted ? "Unmute (M)" : "Mute (M)"}
          >
            <Icon name={muted || volume === 0 ? "volumeOff" : "volume"} size={16} />
          </button>
          <input
            type="range" min="0" max={VOL_MAX} step="0.01"
            value={muted ? 0 : volume}
            style={{ "--vol": (muted ? 0 : volume) / VOL_MAX }}
            // 100% is where the file's own level sits; make it easy to land on.
            onChange={e => {
              const v = +e.target.value;
              setVolume(Math.abs(v - 1) < 0.06 ? 1 : v);
              setMuted(false);
            }}
            aria-label="Volume"
            title="Volume. Past 100% the sound runs through a gain stage — turn the leveller on if it distorts."
          />
          <span className="cv-vol-num">{volPct}%</span>
        </span>

        <button
          className={`cv-btn cv-btn-text${levelling ? " is-on" : ""}`}
          onClick={() => setLevelling(!levelling)}
          title="Leveller: lift quiet passages and hold the peaks down. Worth it on quiet rips and on anything boosted past 100%."
        >
          LVL
        </button>

        {tracks.length > 0 && (
          <span className="cv-menu-wrap">
            <button
              className={`cv-btn cv-btn-text${audioTrack ? " is-on" : ""}${menu === "audio" ? " is-open" : ""}`}
              onClick={() => setMenu(m => (m === "audio" ? null : "audio"))}
              title="Soundtrack"
            >
              {audioTrack ? audioTrack.label : "Audio"}
            </button>
            {menu === "audio" && (
              <div className="cv-menu">
                <button
                  className={`cv-menu-item${audioTrack ? "" : " is-on"}`}
                  onClick={() => { selectAudioTrack(null); setMenu(null); }}
                >
                  {audioTrack ? null : <Icon name="check" size={13} />} Original
                </button>
                {tracks.map(t => (
                  <button
                    key={t.id}
                    className={`cv-menu-item${audioTrack?.id === t.id ? " is-on" : ""}`}
                    disabled={t.missing}
                    onClick={() => { selectAudioTrack(t); setMenu(null); }}
                  >
                    {audioTrack?.id === t.id ? <Icon name="check" size={13} /> : null} {t.label}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}

        <span className="cv-menu-wrap">
          <button
            className={`cv-btn cv-btn-text${rate !== 1 ? " is-on" : ""}${menu === "speed" ? " is-open" : ""}`}
            onClick={() => setMenu(m => (m === "speed" ? null : "speed"))}
            title="Playback speed ([ and ])"
          >
            {rate}×
          </button>
          {menu === "speed" && (
            <div className="cv-menu">
              {SPEEDS.map(s => (
                <button
                  key={s}
                  className={`cv-menu-item${s === rate ? " is-on" : ""}`}
                  onClick={() => { setRate(s); setMenu(null); }}
                >
                  {s === rate ? <Icon name="check" size={13} /> : null} {s}×
                </button>
              ))}
            </div>
          )}
        </span>

        <button className="cv-btn" onClick={toggleFullscreen} title={fullscreen ? "Leave fullscreen (F)" : "Fullscreen (F)"}>
          <Icon name="expand" size={16} />
        </button>
      </div>
    </div>
  );
}
