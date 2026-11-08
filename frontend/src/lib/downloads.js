import { useSyncExternalStore } from "react";
import { getDownloads, addDownload, cancelDownload, retryDownload, clearDownloads, pauseDownloads,
         getDownloadPrefs, setDownloadPref } from "./api";

/* One shared view of the download queue: the header indicator and every
   Download button read it. It asks the backend every 1.5 s while a job is
   queued or running, else every 30 s (the userscript queues downloads too)
   and when the tab comes back into view; not at all while the tab is hidden. */

let state = { installed: false, jobs: [], loaded: false, prefs: {}, paused: false };
const listeners = new Set();
const doneListeners = new Set();
let timer = null;

function emit(next) {
  const before = new Map(state.jobs.map(j => [j.id, j.status]));
  const wasLoaded = state.loaded;
  state = next;
  listeners.forEach(f => f());
  // A job that just landed in the library: the pages showing videos reload.
  // One first seen already done was queued elsewhere (the userscript) and
  // finished between two idle polls.
  if (next.jobs.some(j => j.status === "done" && (before.has(j.id) ? before.get(j.id) !== "done" : wasLoaded))) {
    doneListeners.forEach(f => f());
  }
}

export const isActive = j => j.status === "queued" || j.status === "running";

export async function refreshDownloads() {
  try {
    const d = await getDownloads();
    emit({ ...state, installed: !!d.installed, jobs: d.jobs || [], paused: !!d.paused, loaded: true });
  } catch { /* offline: keep what we had */ }
  clearTimeout(timer);
  // A hidden tab does not poll: coming back into view asks right away.
  timer = listeners.size && document.visibilityState !== "hidden"
    ? setTimeout(refreshDownloads, state.jobs.some(isActive) ? 1500 : 30000) : null;
}

function onVisible() { if (document.visibilityState === "visible") refreshDownloads(); }

function subscribe(f) {
  listeners.add(f);
  if (listeners.size === 1) {
    refreshDownloads();
    loadPrefs();
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(f);
    if (!listeners.size) {
      clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

export function useDownloads() {
  return useSyncExternalStore(subscribe, () => state);
}

export function onDownloadDone(f) {
  doneListeners.add(f);
  return () => doneListeners.delete(f);
}

/* quality: "best", "audio" or a height cap like "1080"; left out, the
   backend uses the creator's default. */
export async function queueDownload(v, quality) {
  const r = await addDownload({ video_id: v.video_id, title: v.title, channel_name: v.channel_name, quality })
    .catch(() => ({ ok: false, error: "Could not reach the backend" }));
  await refreshDownloads();
  return r;
}

export async function cancelJob(id) { await cancelDownload(id).catch(() => {}); await refreshDownloads(); }
export async function retryJob(id)  { await retryDownload(id).catch(() => {}); await refreshDownloads(); }
export async function clearJobs()   { await clearDownloads().catch(() => {}); await refreshDownloads(); }

/* Hold the queue: now = stop the running download midway too (it resumes
   from where it got to); now = false lets it finish first. */
export async function pauseQueue(now = true) {
  emit({ ...state, paused: true });
  await pauseDownloads(true, now).catch(() => {});
  await refreshDownloads();
}
export async function resumeQueue() {
  emit({ ...state, paused: false });
  await pauseDownloads(false).catch(() => {});
  await refreshDownloads();
}

/* Per creator: the quality a Download uses, and auto-download of new uploads. */
let prefsSeq = 0;      // a reload started before the latest change doesn't undo it

async function loadPrefs() {
  const seq = ++prefsSeq;
  try {
    const d = await getDownloadPrefs();
    if (seq === prefsSeq) emit({ ...state, prefs: d.prefs || {} });
  } catch { /* keep what we had */ }
}

export const prefFor = (prefs, name) => prefs[name] || { quality: "best", auto: false };

export async function savePref(channel_name, pref) {
  emit({ ...state, prefs: { ...state.prefs, [channel_name]: pref } });   // shown now, confirmed by the reload
  ++prefsSeq;
  const r = await setDownloadPref({ channel_name, ...pref }).catch(() => ({ ok: false }));
  await loadPrefs();
  return r;
}

export const QUALITIES = ["best", "2160", "1440", "1080", "720", "480", "audio"];

export function qualityLabel(q) {
  if (q === "best")  return "Best H.264";
  if (q === "audio") return "Audio only";
  if (q === "2160")  return "4K";
  if (q === "1440")  return "1440p (2K)";
  return `${q}p`;
}

export function formatSize(bytes) {
  if (!bytes) return "";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
