import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Forward navigation (PUSH/REPLACE) starts at the top; Back/Forward (POP)
// restores the scroll position of the entry being returned to — like a browser.
const USER_SCROLL = ["wheel", "touchstart", "keydown", "mousedown"];

export default function ScrollManager() {
  const location = useLocation();
  const navType  = useNavigationType();
  const positions = useRef(new Map());
  const restoring = useRef(false);
  const currentKey = useRef(location.key);

  // Take over scroll handling from the browser so it doesn't fight us.
  useEffect(() => {
    const prev = window.history.scrollRestoration;
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    return () => { if ("scrollRestoration" in window.history) window.history.scrollRestoration = prev; };
  }, []);

  // Remember the scroll offset for the current history entry as the user scrolls.
  // The entry comes from a ref switched before navigation scrolls: the scroll
  // event lands a frame later and must not overwrite the page just left.
  useEffect(() => {
    const onScroll = () => {
      // Scrolls clamped by a still-loading page aren't where the user was.
      if (!restoring.current) positions.current.set(currentKey.current, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Pages that fetch their list after mounting (tag, playlist) are too short
  // at first: keep retrying for up to 3 s until the target fits, unless the
  // user starts scrolling themselves.
  useLayoutEffect(() => {
    currentKey.current = location.key;
    if (navType !== "POP") {
      window.scrollTo(0, 0);
      return;
    }
    const target = positions.current.get(location.key) ?? 0;
    const deadline = performance.now() + 3000;
    let timer = 0;
    const stop = () => {
      restoring.current = false;
      clearTimeout(timer);
      for (const ev of USER_SCROLL) window.removeEventListener(ev, stop);
    };
    const attempt = () => {
      window.scrollTo(0, target);
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room >= target || performance.now() > deadline) stop();
      else timer = setTimeout(attempt, 50);
    };
    restoring.current = true;
    for (const ev of USER_SCROLL) window.addEventListener(ev, stop, { passive: true });
    attempt();
    return stop;
  }, [location.key, navType]);

  return null;
}
