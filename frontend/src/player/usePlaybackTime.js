import { useEffect, useState } from "react";

const TICK_EVENTS  = ["timeupdate", "seeked"];
const STATE_EVENTS = ["loadedmetadata", "durationchange", "play", "pause", "ended"];

/* Current position and duration of the shared <video>. Lives in the consumer,
   not in the provider's context: the provider wraps the whole app, so putting a
   value that changes four times a second into its state would rerender every
   page. Subscribe from the smallest component that needs the position; one
   that only needs the length passes { time: false } and never rerenders on the
   tick, which is what keeps a video left playing for hours from re-rendering a
   whole page four times a second. */
export function usePlaybackTime(videoRef, key, { time: withTime = true } = {}) {
  const [state, setState] = useState({ time: 0, duration: 0, paused: true });

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      const next = {
        time:     withTime ? el.currentTime || 0 : 0,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        paused:   el.paused,
      };
      // Same values, same object: React bails out instead of rerendering.
      setState(s => (s.time === next.time && s.duration === next.duration && s.paused === next.paused ? s : next));
    };
    update();
    const events = withTime ? [...TICK_EVENTS, ...STATE_EVENTS] : STATE_EVENTS;
    events.forEach(ev => el.addEventListener(ev, update));
    return () => events.forEach(ev => el.removeEventListener(ev, update));
  }, [videoRef, key, withTime]);

  return state;
}
