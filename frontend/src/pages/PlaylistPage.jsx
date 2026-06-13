import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getPlaylist, removeFromPlaylist } from "../lib/api";
import { readLayout, saveLayout } from "../lib/layout";
import { sortVideos, videoMatches } from "../lib/sort";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";

export default function PlaylistPage({ query, onDelete, onEdit, onFetchMeta }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [videos,   setVideos]   = useState([]);
  const [error,    setError]    = useState(null);
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useState("upload");
  const [dir,    setDir]    = useState("desc");
  const [page,   setPage]   = useState(1);

  const load = useCallback(async () => {
    try {
      const r = await getPlaylist(id);
      if (!r.ok) throw new Error(r.error || "not found");
      setPlaylist(r.playlist);
      setVideos(r.videos);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const q = (query || "").trim();
  // Reset to page 1 when playlist, search, or ordering changes.
  useEffect(() => { setPage(1); }, [id, q, sort, dir]);

  function switchLayout(next) {
    setLayout(next);
    saveLayout(next);
  }

  async function handleRemove(videoId) {
    await removeFromPlaylist(id, videoId);
    setVideos(prev => prev.filter(v => v.video_id !== videoId));
  }

  async function handleFetchMeta(videoId) {
    await onFetchMeta(videoId);
    await load();
  }

  if (error) {
    return (
      <div className="card">
        <div className="artist-page-header">
          <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
          <h2 className="artist-page-title">Playlist</h2>
        </div>
        <div className="empty">{error}</div>
      </div>
    );
  }

  const sorted = sortVideos(q ? videos.filter(v => videoMatches(v, q)) : videos, sort, dir);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageVideos = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
        <h2 className="artist-page-title">{playlist ? playlist.name : "…"}</h2>
        {videos.length > 0 && (
          <span className="artist-badge">{videos.length} video{videos.length !== 1 ? "s" : ""}</span>
        )}
        {videos.length > 1 && (
          <SortControls sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
        )}
        {videos.length > 0 && (
          <div className="layout-toggle">
            <button className={`btn-ghost${layout === "grid" ? " active" : ""}`} onClick={() => switchLayout("grid")} title="Grid view">▦</button>
            <button className={`btn-ghost${layout === "list" ? " active" : ""}`} onClick={() => switchLayout("list")} title="List view">☰</button>
          </div>
        )}
      </div>

      {videos.length === 0 ? (
        <div className="empty">Playlist is empty. Add videos with the + button on any video card.</div>
      ) : sorted.length === 0 ? (
        <div className="empty">No videos match "{q}".</div>
      ) : (
        <>
          <div className={layout === "list" ? "video-list" : "video-grid"}>
            {pageVideos.map(v => (
              <VideoCard
                key={v.video_id}
                video={v}
                onEdit={onEdit}
                onFetchMeta={handleFetchMeta}
                onRemoveFromList={handleRemove}
                layout={layout}
              />
            ))}
          </div>
          <Pagination page={safePage} count={pageCount} onPage={setPage} />
        </>
      )}
    </div>
  );
}
