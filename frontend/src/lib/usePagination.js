import { useState, useRef, useEffect, useCallback } from "react";

// In-memory page memory per list key — survives navigation within the session,
// so going back to a list returns to the page you were on.
const mem = new Map();

// `key` identifies the list (e.g. "home", "artist:Foo"). `resetDeps` are the
// filter/sort values that, when changed, send you back to page 1.
export function useRememberedPage(key, resetDeps = []) {
  const [page, setPageRaw] = useState(() => mem.get(key) || 1);

  const setPage = useCallback((p) => {
    mem.set(key, p);
    setPageRaw(p);
  }, [key]);

  const sig = useRef(null);
  useEffect(() => {
    if (sig.current === null) {            // first mount → keep the remembered page
      sig.current = { key, deps: resetDeps };
      return;
    }
    const prev = sig.current;
    if (prev.key !== key) {
      setPageRaw(mem.get(key) || 1);       // switched to a different list
    } else if (prev.deps.length !== resetDeps.length || prev.deps.some((d, i) => d !== resetDeps[i])) {
      mem.set(key, 1);                     // filters/sort changed → page 1
      setPageRaw(1);
    }
    sig.current = { key, deps: resetDeps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...resetDeps]);

  return [page, setPage];
}
