// Profile effect preferences: decorative overlays on the creator profile panel.
// Stored per browser like the theme. One site-wide switch, a default effect,
// and an optional pick per artist that overrides the default.
//
// Per-artist value: missing = follow the default, "none" = off for that
// artist, anything else = an effect id from components/effects.
import { useSyncExternalStore } from "react";

const KEY = "cv:profile-effects";
const EVENT = "cv:profile-effects";

export const DEFAULT_EFFECT = "celestial";

const EMPTY = { enabled: true, fallback: DEFAULT_EFFECT, artists: {} };
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    cache = { ...EMPTY, ...raw, artists: { ...(raw.artists || {}) } };
  } catch { cache = EMPTY; }
  return cache;
}

function write(next) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(fn) {
  const onStorage = e => { if (e.key === KEY) { cache = null; fn(); } };
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useEffectPrefs() {
  return useSyncExternalStore(subscribe, read);
}

export function setEffectsEnabled(enabled) { write({ ...read(), enabled }); }
export function setFallbackEffect(id) { write({ ...read(), fallback: id }); }

export function setArtistEffect(artist, id) {
  const artists = { ...read().artists };
  if (id == null) delete artists[artist];
  else artists[artist] = id;
  write({ ...read(), artists });
}

// The effect id to draw for an artist, or null for nothing.
export function resolveEffect(prefs, artist) {
  if (!prefs.enabled) return null;
  const id = prefs.artists[artist] ?? prefs.fallback;
  return id === "none" ? null : id;
}
