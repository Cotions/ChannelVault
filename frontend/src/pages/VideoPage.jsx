import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { streamUrl, thumbUrl, artistThumbUrl, postWatchProgress, getThumbnails, fetchThumbnail, thumbnailVersionUrl } from "../lib/api";
import { fmt, fmtBytes, fmtDuration } from "../lib/fmt";

export default function VideoPage({ videos, onEdit, onFetchMeta, onDelete, onWatched }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [playErr,    setPlayErr]    = useState(false);
  const [fetching,   setFetching]   = useState(false);
  const [elapsed,    setElapsed]    = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [justWatched, setJustWatched] = useState(false);
  const [thumbs,     setThumbs]     = useState([]);
  const [thumbIdx,   setThumbIdx]   = useState(0);
  const [thumbBusy,  setThumbBusy]  = useState(false);
  const [thumbMsg,   setThumbMsg]   = useState(null);
  const [dupPrompt,  setDupPrompt]  = useState(null);

  const loadThumbs = useCallback(async () => {
    try {
      const r = await getThumbnails(id);
      const list = (r.thumbnails || []).map(t =>
        t.kind === "original" ? thumbUrl(id) : thumbnailVersionUrl(id, t.file)
      );
      setThumbs(list);
      return list;
    } catch { setThumbs([]); return []; }
  }, [id]);

  useEffect(() => {
    setThumbIdx(0);
    setThumbMsg(null);
    loadThumbs();
  }, [id, loadThumbs]);

  async function handleFetchThumbnail() {
    setThumbBusy(true);
    setThumbMsg(null);
    try {
      const r = await fetchThumbnail(id);
      if (r.availability) setThumbMsg("Unavailable on YouTube");
      else if (!r.ok)     setThumbMsg("Fetch failed");
      else if (r.reason === "maybe-duplicate") {
        setDupPrompt({ preview: r.preview, distance: r.distance, current: thumbs[thumbIdx] || thumbUrl(id) });
      }
      else if (r.added) {
        const list = await loadThumbs();
        setThumbIdx(Math.max(0, list.length - 1));
        setThumbMsg("New thumbnail saved");
      } else setThumbMsg("Already have this one");
    } catch {
      setThumbMsg("Fetch failed");
    } finally {
      setThumbBusy(false);
      setTimeout(() => setThumbMsg(null), 3000);
    }
  }

  async function confirmSaveThumb() {
    setDupPrompt(null);
    setThumbBusy(true);
    try {
      const r = await fetchThumbnail(id, true);
      if (r.added) {
        const list = await loadThumbs();
        setThumbIdx(Math.max(0, list.length - 1));
        setThumbMsg("New thumbnail saved");
      } else setThumbMsg("Already have this one");
    } catch {
      setThumbMsg("Fetch failed");
    } finally {
      setThumbBusy(false);
      setTimeout(() => setThumbMsg(null), 3000);
    }
  }

  // --- Watch tracking: accumulate real playtime (seeks don't count) ---
  const watchRef = useRef({ watched: 0, lastTime: null, sessionId: null, completed: false, reported: 0 });

  const reportProgress = useCallback(async (videoEl) => {
    const w = watchRef.current;
    if (w.watched < 1) return;
    try {
      const r = await postWatchProgress(id, {
        session_id:    w.sessionId,
        watched_secs:  w.watched,
        position_secs: videoEl ? videoEl.currentTime : 0,
        duration_secs: videoEl && videoEl.duration ? videoEl.duration : null,
      });
      w.sessionId = r.session_id;
      w.reported  = w.watched;
      if (r.completed && !w.completed) {
        w.completed = true;
        setJustWatched(true);
        onWatched?.();
      }
    } catch {}
  }, [id, onWatched]);

  function handleTimeUpdate(e) {
    const w = watchRef.current;
    const t = e.target.currentTime;
    if (w.lastTime != null) {
      const delta = t - w.lastTime;
      // timeupdate fires ~4×/s during playback; big jumps are seeks
      if (delta > 0 && delta < 2) w.watched += delta;
    }
    w.lastTime = t;
    // report every ~15s of accumulated playtime
    if (w.watched - w.reported >= 15) reportProgress(e.target);
  }

  function handleSeeked(e) {
    watchRef.current.lastTime = e.target.currentTime;
  }

  // reset tracker per video, flush on leave
  useEffect(() => {
    watchRef.current = { watched: 0, lastTime: null, sessionId: null, completed: false, reported: 0 };
    setJustWatched(false);
    return () => reportProgress(null);
  }, [id, reportProgress]);

  useEffect(() => {
    if (!confirming) return;
    function onKey(e) {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  useEffect(() => {
    if (!fetching) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(t);
  }, [fetching]);

  const video = videos.find(v => v.video_id === id);

  if (!video) {
    return (
      <div className="card">
        <div className="artist-page-header">
          <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
          <h2 className="artist-page-title">Video</h2>
        </div>
        <div className="empty">{videos.length === 0 ? "Loading…" : "Video not found in vault."}</div>
      </div>
    );
  }

  const ytUrl  = `https://www.youtube.com/watch?v=${video.video_id}`;
  const artist = video.channel_name || "Unknown";

  async function handleFetchMeta() {
    setFetching(true);
    try { await onFetchMeta(video.video_id); } catch {} finally {
      setFetching(false);
      setTimeout(() => setElapsed(null), 5000);
    }
  }

  async function handleDelete() {
    setConfirming(false);
    setDeleting(true);
    try {
      await onDelete(video.video_id);
      navigate(-1);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
        <div className="video-page-spacer" />
        <a href={ytUrl} target="_blank" rel="noreferrer" className="btn-yt" title="Open on YouTube">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/>
          </svg>
          YouTube
        </a>
        {elapsed != null && <span className="fetch-timer">{elapsed.toFixed(1)}s</span>}
        <button className="btn-secondary btn-export" onClick={handleFetchMeta} disabled={fetching}>
          {fetching ? "Fetching…" : "⟳ Fetch metadata"}
        </button>
        <button className="btn-secondary btn-export" onClick={handleFetchThumbnail} disabled={thumbBusy} title="Download the current YouTube thumbnail (keeps the original)">
          {thumbBusy ? "…" : "⬇ Thumbnail"}
        </button>
        {thumbMsg && <span className="fetch-timer">{thumbMsg}</span>}
        <button className="btn-secondary btn-export" onClick={() => onEdit(video)}>✎ Edit</button>
        {confirming ? (
          <>
            <span className="del-confirm-label">Delete from vault?</span>
            <button
              className="btn-danger btn-export"
              onClick={handleDelete}
              disabled={deleting}
              autoFocus
              title="Confirm delete"
            >
              ✓ Yes
            </button>
            <button className="btn-secondary btn-export" onClick={() => setConfirming(false)} title="Cancel (Esc)">
              ✕ No
            </button>
          </>
        ) : (
          <button
            className="btn-secondary btn-export btn-page-del"
            disabled={deleting}
            onClick={() => setConfirming(true)}
          >
            ✕
          </button>
        )}
      </div>

      {(() => {
        const poster = thumbs[thumbIdx] || thumbUrl(video.video_id);
        const cycle  = () => thumbs.length > 1 && setThumbIdx(i => (i + 1) % thumbs.length);
        return (
          <div className="vp-player-wrap">
            {playErr ? (
              <div className="player-fallback">
                <img src={poster} alt="" onError={e => { e.target.style.display = "none"; }} />
                <div className="empty">
                  Browser can't play this file{video.file_path ? ` (${video.file_path.split(".").pop()})` : ""}.{" "}
                  <a href={ytUrl} target="_blank" rel="noreferrer" style={{ color: "#90caf9" }}>Watch on YouTube</a>
                </div>
              </div>
            ) : (
              <video
                className="video-player"
                controls
                preload="metadata"
                poster={poster}
                src={streamUrl(video.video_id)}
                onError={() => setPlayErr(true)}
                onTimeUpdate={handleTimeUpdate}
                onSeeked={handleSeeked}
                onPause={e => reportProgress(e.target)}
                onEnded={e => reportProgress(e.target)}
              />
            )}
            {thumbs.length > 1 && (
              <button
                className="vp-thumb-cycle"
                onClick={cycle}
                title="Cycle thumbnail"
              >
                ⤿ <span className="vp-thumb-count">{thumbIdx + 1}/{thumbs.length}</span>
              </button>
            )}
          </div>
        );
      })()}

      <div className="vp-below">
        <h1 className="vp-title">{video.title || video.video_id}</h1>
        <Link to={`/artist/${encodeURIComponent(artist)}`} className="vp-channel" style={{ animationDelay: "60ms" }}>
          <img
            className="vp-channel-avatar"
            src={artistThumbUrl(artist)}
            alt=""
            onError={e => { e.target.style.visibility = "hidden"; }}
          />
          <span className="vp-channel-name">{artist}</span>
          <span className="vp-channel-arrow">→</span>
        </Link>

        <div className="vp-stats">
          {[
            video.duration_secs != null && { num: fmtDuration(video.duration_secs), label: "duration" },
            video.view_count    != null && { num: fmt(video.view_count),            label: "views" },
            video.like_count    != null && { num: fmt(video.like_count),            label: "likes" },
            video.file_size_bytes != null && { num: fmtBytes(video.file_size_bytes), label: "on disk" },
            video.recorded_date && { num: video.recorded_date, label: "uploaded" },
            (video.watch_count > 0 || justWatched) && {
              num: `${Math.max(video.watch_count || 0, justWatched ? 1 : 0)}×`,
              label: "watched",
            },
          ].filter(Boolean).map((s, i) => (
            <div key={s.label} className="vp-stat" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <span className="vp-stat-num">{s.num}</span>
              <span className="vp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        {video.description && (
          <div className="vp-desc" style={{ animationDelay: "350ms" }}>
            <div className="vp-desc-label">Description</div>
            <div className="vp-desc-body">{video.description}</div>
          </div>
        )}
      </div>

      {dupPrompt && (
        <div className="modal-overlay" onClick={() => setDupPrompt(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Looks similar — keep it anyway?</div>
              <button className="modal-close" onClick={() => setDupPrompt(null)}>✕</button>
            </div>
            <div className="field-hint">
              The fetched thumbnail looks close to one you already have (visual distance {dupPrompt.distance}),
              but YouTube is serving a different file. Compare and decide.
            </div>
            <div className="dup-compare">
              <figure>
                <img src={dupPrompt.current} alt="" />
                <figcaption>Current</figcaption>
              </figure>
              <figure>
                <img src={dupPrompt.preview} alt="" />
                <figcaption>New from YouTube</figcaption>
              </figure>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDupPrompt(null)}>Discard</button>
              <button className="btn-primary" onClick={confirmSaveThumb}>Keep both</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
