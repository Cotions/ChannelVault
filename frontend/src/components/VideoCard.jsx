import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { latestThumbUrl } from "../lib/api";
import { fmt, fmtDuration } from "../lib/fmt";

export default function VideoCard({ video, onDelete, onEdit, onFetchMeta, playlists, onAddToPlaylist, onRemoveFromList, layout = "grid" }) {
  const [thumbOk,    setThumbOk]    = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [fetching,   setFetching]   = useState(false);
  const [fetchErr,   setFetchErr]   = useState(false);
  const [elapsed,    setElapsed]    = useState(null);
  const [plOpen,     setPlOpen]     = useState(false);
  const [plAdded,    setPlAdded]    = useState(null);
  const plRef = useRef(null);

  useEffect(() => {
    if (!plOpen) return;
    function onDown(e) {
      if (plRef.current && !plRef.current.contains(e.target)) setPlOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plOpen]);

  async function handleAddToPlaylist(plId) {
    setPlOpen(false);
    try {
      await onAddToPlaylist(plId, video.video_id);
      setPlAdded(plId);
      setTimeout(() => setPlAdded(null), 2000);
    } catch {}
  }

  useEffect(() => {
    if (!fetching) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [fetching]);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (confirming && confirmRef.current) confirmRef.current.focus();
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    function onKey(e) {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  async function handleDelete() {
    setConfirming(false);
    setDeleting(true);
    try {
      await onDelete(video.video_id);
    } catch {
      setDeleting(false);
    }
  }

  async function handleFetchMeta() {
    setFetching(true);
    setFetchErr(false);
    try {
      await onFetchMeta(video.video_id);
    } catch {
      setFetchErr(true);
      setTimeout(() => setFetchErr(false), 3000);
    } finally {
      setFetching(false);
      setTimeout(() => setElapsed(null), 5000);
    }
  }

  const dur   = fmtDuration(video.duration_secs);
  const date  = video.recorded_date || null;

  const AVAIL_LABELS = {
    private: "Private", deleted: "Deleted", members: "Members",
    geo: "Geo-blocked", unavailable: "Unavailable",
  };
  const dead       = video.availability && video.availability !== "available";
  const availLabel = dead ? (AVAIL_LABELS[video.availability] || "Unavailable") : null;

  return (
    <div className={`video-card${layout === "list" ? " list" : ""}`}>
      <Link to={`/video/${video.video_id}`} className="video-thumb-link">
        {thumbOk ? (
          <img
            className="video-thumb"
            src={latestThumbUrl(video.video_id)}
            alt=""
            onError={() => setThumbOk(false)}
          />
        ) : (
          <div className="video-thumb-placeholder">▶</div>
        )}
        {video.watch_count > 0 && (
          <span className="watched-badge" title={`Watched ${video.watch_count}×`}>
            ✓{video.watch_count > 1 ? ` ${video.watch_count}` : ""}
          </span>
        )}
      </Link>
      <div className="video-info">
        <div className="video-title">
          <Link to={`/video/${video.video_id}`}>{video.title || video.video_id}</Link>
        </div>
        <div className="video-meta">
          {dur && <span>{dur}</span>}
          {date && <span>{date}</span>}
          {video.view_count != null && <span>{fmt(video.view_count)} views</span>}
          {video.like_count  != null && <span>{fmt(video.like_count)} likes</span>}
        </div>
      </div>
      <div className="video-actions">
        {confirming ? (
          <>
            <span className="del-confirm-label">Delete?</span>
            <button
              ref={confirmRef}
              className="del-btn del-btn-confirm"
              onClick={handleDelete}
              disabled={deleting}
              title="Confirm delete (Enter)"
            >
              ✓
            </button>
            <button
              className="del-btn"
              onClick={() => setConfirming(false)}
              title="Cancel (Esc)"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <div className="va-left">
              {onFetchMeta && (
                <button
                  className={`del-btn fetch-btn${fetching ? " spinning" : ""}${fetchErr ? " fetch-err" : ""}${dead ? " fetch-dead" : ""}`}
                  title={fetchErr ? "Fetch failed" : dead ? `${availLabel} — fetch may fail` : "Fetch metadata from YouTube"}
                  disabled={fetching}
                  onClick={handleFetchMeta}
                >
                  {fetchErr ? "!" : "⟳"}
                </button>
              )}
              {availLabel && (
                <span className={`avail-badge avail-${video.availability}`} title={`${availLabel} on YouTube`}>
                  {availLabel}
                </span>
              )}
              {onFetchMeta && elapsed != null && (
                <span className="fetch-timer">{elapsed.toFixed(1)}s</span>
              )}
            </div>
            <div className="va-right">
            {onAddToPlaylist && playlists && (
              <div className="pl-menu-wrap" ref={plRef}>
                <button
                  className={`del-btn pl-btn${plAdded ? " pl-added" : ""}`}
                  title="Add to playlist"
                  onClick={() => setPlOpen(o => !o)}
                >
                  {plAdded ? "✓" : "+"}
                </button>
                {plOpen && (
                  <div className="pl-menu">
                    {playlists.length === 0 ? (
                      <div className="pl-menu-empty">No playlists yet</div>
                    ) : (
                      playlists.map(pl => (
                        <button key={pl.id} className="pl-menu-item" onClick={() => handleAddToPlaylist(pl.id)}>
                          {pl.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            {onEdit && (
              <button className="del-btn" title="Edit metadata" onClick={() => onEdit(video)}>
                ✎
              </button>
            )}
            {onRemoveFromList && (
              <button
                className="del-btn"
                title="Remove from playlist"
                onClick={() => onRemoveFromList(video.video_id)}
              >
                −
              </button>
            )}
            {onDelete && (
              <button
                className="del-btn"
                title="Remove from vault"
                disabled={deleting}
                onClick={() => setConfirming(true)}
              >
                ✕
              </button>
            )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
