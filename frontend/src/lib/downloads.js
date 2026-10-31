import { useSyncExternalStore } from "react";
import { getDownloads, addDownload, cancelDownload, retryDownload, clearDownloads } from "./api";

/* One shared view of the download queue: the header indicator and every
   Download button read it. It asks the backend every 1.5 s while a job is
   queued or running, else every 30 s (the userscript queues downloads too)
   and when the tab comes back into view. */

let state = { installed: false, jobs: [], loaded: false };
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
    emit({ installed: !!d.installed, jobs: d.jobs || [], loaded: true });
  } catch { /* offline: keep what we had */ }
  clearTimeout(timer);
  timer = listeners.size ? setTimeout(refreshDownloads, state.jobs.some(isActive) ? 1500 : 30000) : null;
}

function onVisible() { if (document.visibilityState === "visible") refreshDownloads(); }

function subscribe(f) {
  listeners.add(f);
  if (listeners.size === 1) {
    refreshDownloads();
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

export async function queueDownload(v) {
  const r = await addDownload({ video_id: v.video_id, title: v.title, channel_name: v.channel_name })
    .catch(() => ({ ok: false, error: "Could not reach the backend" }));
  await refreshDownloads();
  return r;
}

export async function cancelJob(id) { await cancelDownload(id).catch(() => {}); await refreshDownloads(); }
export async function retryJob(id)  { await retryDownload(id).catch(() => {}); await refreshDownloads(); }
export async function clearJobs()   { await clearDownloads().catch(() => {}); await refreshDownloads(); }
