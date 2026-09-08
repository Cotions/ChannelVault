import { useEffect, useState } from "react";

/* Current position and duration of the shared <video>. Lives in the consumer,
   not in the provider's context: the provider wraps the whole app, so putting a
   value that changes four times a second into its state would rerender every
   page. Only the video page subscribes to this. */
export function usePlaybackTime(videoRef, key) {
  const [state, setState] = useState({ time: 0, duration: 0, paused: true });

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const update = () => setState({
      time:     el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      paused:   el.paused,
    });
    update();
    const events = ["timeupdate", "loadedmetadata", "durationchange", "seeked", "play", "pause", "ended"];
    events.forEach(ev => el.addEventListener(ev, update));
    return () => events.forEach(ev => el.removeEventListener(ev, update));
  }, [videoRef, key]);

  return state;
}
