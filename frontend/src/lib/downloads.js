import { useSyncExternalStore } from "react";
import { getDownloads, addDownload, cancelDownload, retryDownload, clearDownloads } from "./api";

/* One shared view of the download queue: the header indicator and every
   Download button read it. It asks the backend once at start, then every
   1.5 s only while a job is queued or running. */

let state = { installed: false, jobs: [], loaded: false };
const listeners = new Set();
const doneListeners = new Set();
let timer = null;

function emit(next) {
  const before = new Map(state.jobs.map(j => [j.id, j.status]));
  state = next;
  listeners.forEach(f => f());
  // A job that just landed in the library: the pages showing videos reload.
  if (next.jobs.some(j => j.status === "done" && before.has(j.id) && before.get(j.id) !== "done")) {
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
  timer = state.jobs.some(isActive) ? setTimeout(refreshDownloads, 1500) : null;
}

function subscribe(f) {
  listeners.add(f);
  if (!state.loaded && listeners.size === 1) refreshDownloads();
  return () => listeners.delete(f);
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
