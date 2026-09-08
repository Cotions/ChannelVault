import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getTagVideos } from "../lib/api";
import { readLayout, saveLayout } from "../lib/layout";
import { sortVideos, videoMatches } from "../lib/sort";
import { fmtTime } from "../lib/fmt";
import { useRememberedPage } from "../lib/usePagination";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import TagChip from "../components/TagChip";
import Icon from "../components/Icon";

/* The home of one tag: every video carrying it, and under each card the exact
   segments, as links that open the video at that second. */
export default function TagPage({ query, onEdit, onFetchMeta, playlists, onAddToPlaylist, onDelete }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tag,    setTag]    = useState(null);
  const [videos, setVideos] = useState([]);
  const [error,  setError]  = useState(null);
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useState("upload");
  const [dir,    setDir]    = useState("desc");

  const load = useCallback(async () => {
    try {
      const r = await getTagVideos(id);
      if (!r.ok) throw new Error(r.error || "not found");
      setTag(r.tag);
      setVideos(r.videos);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const q = (query || "").trim();
  const [page, setPage] = useRememberedPage(`tag:${id}`, [q, sort, dir]);

  function switchLayout(next) { setLayout(next); saveLayout(next); }

  async function handleFetchMeta(videoId) { await onFetchMeta(videoId); await load(); }
  async function handleDelete(videoId) { await onDelete(videoId); await load(); }

  if (error) {
    return (
      <div className="card">
        <div className="artist-page-header">
          <button className="btn-secondary btn-back" onClick={() => navigate(-1)}><Icon name="back" size={15} />Back</button>
          <h2 className="artist-page-title">Tag</h2>
        </div>
        <div className="empty">{error}</div>
      </div>
    );
  }

  const sorted     = sortVideos(q ? videos.filter(v => videoMatches(v, q)) : videos, sort, dir);
  const pageCount  = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, pageCount);
  const pageVideos = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const segTotal   = videos.reduce((n, v) => n + (v.matched_segments?.length || 0), 0);

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}><Icon name="back" size={15} />Back</button>
        <h2 className="artist-page-title tag-page-title">
          {tag ? <TagChip tag={tag} size="lg" /> : "…"}
        </h2>
        {videos.length > 0 && (
          <span className="artist-badge">
            {videos.length} video{videos.length !== 1 ? "s" : ""}{segTotal ? ` · ${segTotal} segment${segTotal !== 1 ? "s" : ""}` : ""}
          </span>
        )}
        <div className="video-page-spacer" />
        {videos.length > 1 && <SortControls sort={sort} dir={dir} onSort={setSort} onDir={setDir} />}
        {videos.length > 0 && (
          <div className="layout-toggle">
            <button className={`btn-ghost${layout === "grid" ? " active" : ""}`} onClick={() => switchLayout("grid")} title="Grid view"><Icon name="grid" size={15} /></button>
            <button className={`btn-ghost${layout === "list" ? " active" : ""}`} onClick={() => switchLayout("list")} title="List view"><Icon name="list" size={15} /></button>
          </div>
        )}
      </div>

      {videos.length === 0 ? (
        <div className="empty">Nothing carries this tag yet. Add it to a video or a segment from any video page.</div>
      ) : sorted.length === 0 ? (
        <div className="empty">No videos match “{q}”.</div>
      ) : (
        <>
          <div className={layout === "list" ? "video-list tag-video-list" : "video-grid tag-video-grid"}>
            {pageVideos.map(v => (
              <div key={v.video_id} className="tag-card">
                <VideoCard
                  video={v}
                  onEdit={onEdit}
                  onFetchMeta={handleFetchMeta}
                  onDelete={onDelete ? handleDelete : undefined}
                  playlists={playlists}
                  onAddToPlaylist={onAddToPlaylist}
                  layout={layout}
                />
                <div className="tag-seg-links">
                  {v.tagged_whole && (
                    <Link to={`/video/${v.video_id}`} className="tag-seg-link tag-seg-link-whole" title="The whole video carries this tag">
                      <Icon name="play" size={10} /> whole video
                    </Link>
                  )}
                  {(v.matched_segments || []).map(s => (
                    <Link
                      key={s.id}
                      to={`/video/${v.video_id}?t=${Math.floor(s.start_secs)}`}
                      className="tag-seg-link"
                      title={s.title ? `${s.title} — opens at ${fmtTime(s.start_secs)}` : `Opens at ${fmtTime(s.start_secs)}`}
                    >
                      <Icon name="play" size={10} />
                      <span className="tag-seg-time">{fmtTime(s.start_secs)}</span>
                      <span className="tag-seg-sep">→</span>
                      <span className="tag-seg-time">{fmtTime(s.end_secs)}</span>
                      {s.title && <span className="tag-seg-title">{s.title}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Pagination page={safePage} count={pageCount} onPage={setPage} />
        </>
      )}
    </div>
  );
}
