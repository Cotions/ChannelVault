import { useEffect, useSyncExternalStore } from "react";
import { searchDescriptions } from "./api";
import { fold } from "./sort";

/* Description matches for the search box. The library list carries no
   descriptions, so the backend answers which ones hold the query: titles,
   channels and tags match in the page at once, description matches join a
   moment later. One shared answer for every page showing the same query. */

const EMPTY = new Set();
const cache = new Map();          // folded query -> Set of video ids
let state = { q: "", ids: EMPTY };
const listeners = new Set();
let timer = null;
let inflight = null;

function emit(next) { state = next; listeners.forEach(f => f()); }
function subscribe(f) { listeners.add(f); return () => listeners.delete(f); }

function want(q) {
  if (q === state.q) return;
  clearTimeout(timer);
  inflight?.abort();
  if (q.length < 2) { emit({ q, ids: EMPTY }); return; }
  if (cache.has(q)) { emit({ q, ids: cache.get(q) }); return; }
  // Typing: ask once the keys pause, not on every one.
  timer = setTimeout(() => {
    const ctl = new AbortController();
    inflight = ctl;
    searchDescriptions(q, ctl.signal).then(r => {
      const ids = new Set(r.ids || []);
      if (cache.size > 50) cache.clear();
      cache.set(q, ids);
      if (inflight === ctl) emit({ q, ids });
    }, () => { /* aborted or offline: titles still match */ });
  }, 180);
}

// A description edited or fetched since: old answers may be wrong now.
export function clearDescriptionHits() { cache.clear(); state = { q: "", ids: EMPTY }; }

export function useDescriptionHits(query) {
  const q = fold(query).trim();
  useEffect(() => { want(q); }, [q]);
  const s = useSyncExternalStore(subscribe, () => state);
  return s.q === q ? s.ids : EMPTY;
}
