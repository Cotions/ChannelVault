import { useSyncExternalStore } from "react";

// A metadata fetch rewrites the very numbers a sort keys on: under "Oldest fetch"
// the card leaves for the far end of the list the instant it succeeds, taking the
// freshly fetched stats with it. So keep the pre-fetch snapshot of the row around
// for as long as the fetch timer stays up and sort on that instead — the card
// holds its slot while the new numbers are on screen. Display always uses the
// live row; only the comparator looks at the snapshot.
export const PIN_MS = 5000;

let pins = {};            // video_id -> the video row as it was before the fetch
const timers = new Map(); // video_id -> release timer
const subs   = new Set();

function emit() { subs.forEach(fn => fn()); }

// Freeze a card's sort position. Safe to call again while already pinned: the
// first snapshot wins and the pending release is cancelled.
export function pinSortSlot(video) {
  const id = video.video_id;
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (pins[id]) return;
  pins = { ...pins, [id]: video };
  emit();
}

// Let the card drift to its real position, PIN_MS from now.
export function releaseSortSlot(id) {
  if (!pins[id]) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    const rest = { ...pins };
    delete rest[id];
    pins = rest;
    emit();
  }, PIN_MS));
}

function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function snapshot()    { return pins; }

export function useSortPins() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
