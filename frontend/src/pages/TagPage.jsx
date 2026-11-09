import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { goBack } from "../lib/nav";
import { getTagVideos, getTagSegments } from "../lib/api";
import { readLayout, saveLayout } from "../lib/layout";
import { sortVideos, videoMatches } from "../lib/sort";
import { useDescriptionHits } from "../lib/descSearch";
import { useSortPins } from "../lib/sortPins";
import { fmtTime } from "../lib/fmt";
import { useRememberedPage, useRememberedState } from "../lib/usePagination";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import TagChip from "../components/TagChip";
import { playableItems } from "../lib/tagQueue";
import Icon from "../components/Icon";
import { usePlayer } from "../player/playerContext";

/* The home of one tag: every video carrying it, and under each card the exact
   segments, as links that open the video at that second. */
// Remount per id: the previous one's data, errors and in-flight requests
// must never show on the next.
// A card lists this many parts; the rest fold behind "N more parts".
const PARTS_SHOWN = 2;

export default function TagPage(props) {
  const { id } = useParams();
  return <TagPageBody key={id} {...props} />;
}

function TagPageBody({ libraryVersion, query, onEdit, onFetchMeta, playlists, onAddToPlaylist, onDelete }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tag,    setTag]    = useState(null);
  const [videos, setVideos] = useState([]);
  const [openParts, setOpenParts] = useState(() => new Set());   // cards showing every part
  const [error,  setError]  = useState(null);
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useRememberedState(`tag:${id}:sort`, "upload");
  const [dir,    setDir]    = useRememberedState(`tag:${id}:dir`, "desc");
  const [queueBusy, setQueueBusy] = useState(false);
  const { playQueue } = usePlayer();

  // Start segment play mode: fetch the flat queue for this tag, then hand it to
  // the player. startAt jumps straight to one segment; shuffle randomises the rest.
  // The queue follows the page's own order, video by video as the grid shows them.
  const startPlay = useCallback(async ({ startAt = null, shuffle = false, order = [] } = {}) => {
    setQueueBusy(true);
    try {
      const r = await getTagSegments(id);
      if (!r.ok || !r.items?.length) return;
      const rank = new Map(order.map((vid, i) => [vid, i]));
      const at = i => rank.get(i.video_id) ?? order.length;
      const items = playableItems(r.items).sort((a, b) => at(a) - at(b) || (a.start_secs || 0) - (b.start_secs || 0));
      const idx = startAt == null ? 0 : Math.max(0, items.findIndex(i => i.segment_id === startAt));
      playQueue(items, { tagId: r.tag.id, tagName: r.tag.name, color: r.tag.color }, idx, { shuffle });
    } finally { setQueueBusy(false); }
  }, [id, playQueue]);

  const load = useCallback(async () => {
    try {
      const r = await getTagVideos(id);
      if (!r.ok) throw new Error(r.error || "not found");
      setTag(r.tag);
      setVideos(r.videos);
      setError(null);
    } catch (e) {
      setError(e.status === 404 ? "This tag doesn't exist (it may have been deleted)." : "Could not load this tag.");
    }
  }, [id]);
  useEffect(() => { load(); }, [load, libraryVersion]);   // an edit elsewhere shows here too

  const q = (query || "").trim();
  const pins = useSortPins();   // videos fetched seconds ago hold their slot
  const descHits = useDescriptionHits(q);
  const [page, setPage] = useRememberedPage(`tag:${id}`, [q, sort, dir]);

  function switchLayout(next) { setLayout(next); saveLayout(next); }

  async function handleFetchMeta(videoId) { await onFetchMeta(videoId); await load(); }
  async function handleDelete(videoId) { await onDelete(videoId); await load(); }

  if (error) {
    return (
      <div className="card">
        <div className="artist-page-header">
          <button className="btn-secondary btn-back" onClick={() => goBack(navigate)}><Icon name="back" size={15} />Back</button>
          <h2 className="artist-page-title">Tag</h2>
        </div>
        <div className="empty">{error}</div>
      </div>
    );
  }

  const sorted     = sortVideos(q ? videos.filter(v => videoMatches(v, q, descHits)) : videos, sort, dir, pins);
  const pageCount  = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, pageCount);
  const pageVideos = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const segTotal   = videos.reduce((n, v) => n + (v.matched_segments?.length || 0), 0);
  const wholeTotal = videos.filter(v => v.tagged_whole && !v.matched_segments?.length).length;
  const order      = sorted.map(v => v.video_id);
  const playLabel  = segTotal ? `Play ${segTotal} part${segTotal !== 1 ? "s" : ""}` : `Play ${wholeTotal} video${wholeTotal !== 1 ? "s" : ""}`;

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => goBack(navigate)}><Icon name="back" size={15} />Back</button>
        <h2 className="artist-page-title tag-page-title">
          {tag ? <TagChip tag={tag} size="lg" /> : "…"}
        </h2>
        <div className="video-page-spacer" />
        {videos.length > 0 && (
          <>
            <button className="btn-primary btn-export" onClick={() => startPlay({ order })} disabled={queueBusy}
              title="One after another, in the order shown">
              <Icon name="play" size={14} className="icon-fill" /> {playLabel}
            </button>
            <button className="icon-btn" onClick={() => startPlay({ shuffle: true, order })} disabled={queueBusy} title="Play them shuffled" aria-label="Shuffle">
              <Icon name="shuffle" size={15} />
            </button>
          </>
        )}
      </div>
      {videos.length > 0 && (
        <div className="grid-toolbar">
          <span className="grid-toolbar-count">
            {videos.length} video{videos.length !== 1 ? "s" : ""}{segTotal ? ` · ${segTotal} tagged part${segTotal !== 1 ? "s" : ""}` : ""}
          </span>
          <span className="page-head-spacer" />
          {videos.length > 1 && <SortControls sort={sort} dir={dir} onSort={setSort} onDir={setDir} />}
          <div className="layout-toggle">
            <button className={`btn-ghost${layout === "grid" ? " active" : ""}`} onClick={() => switchLayout("grid")} title="Grid view" aria-label="Grid view"><Icon name="grid" size={16} /></button>
            <button className={`btn-ghost${layout === "list" ? " active" : ""}`} onClick={() => switchLayout("list")} title="List view" aria-label="List view"><Icon name="list" size={16} /></button>
          </div>
        </div>
      )}

      {videos.length === 0 ? (
        <div className="empty">Nothing has this tag yet. Add it to a video, or to a part of one, from the video's page.</div>
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
                  hideTagId={tag?.id}
                />
                <div className="tag-seg-links">
                  {v.tagged_whole && v.matched_segments?.length > 0 && (
                    <span className="tag-seg-whole">Whole video, and</span>
                  )}
                  {(v.matched_segments || []).slice(0, openParts.has(v.video_id) ? undefined : PARTS_SHOWN).map(s => (
                    <span key={s.id} className="tag-seg-pair">
                      <button
                        className="tag-seg-play"
                        onClick={() => startPlay({ startAt: s.id, order })}
                        disabled={queueBusy}
                        title="Play the tagged parts, starting here"
                      >
                        <Icon name="play" size={10} className="icon-fill" />
                      </button>
                      <Link
                        to={`/video/${v.video_id}?t=${Math.floor(s.start_secs)}`}
                        className="tag-seg-link"
                        title={s.title ? `${s.title} — opens at ${fmtTime(s.start_secs)}` : `Opens at ${fmtTime(s.start_secs)}`}
                      >
                        <span className="tag-seg-time">{fmtTime(s.start_secs)}</span>
                        <span className="tag-seg-sep">→</span>
                        <span className="tag-seg-time">{fmtTime(s.end_secs)}</span>
                        {s.title && <span className="tag-seg-title">{s.title}</span>}
                      </Link>
                    </span>
                  ))}
                  {(v.matched_segments?.length || 0) > PARTS_SHOWN && <span className="tag-seg-break" />}
                  {(v.matched_segments?.length || 0) > PARTS_SHOWN && (
                    <button
                      className="btn-ghost tag-seg-more"
                      onClick={() => setOpenParts(prev => {
                        const next = new Set(prev);
                        if (next.has(v.video_id)) next.delete(v.video_id); else next.add(v.video_id);
                        return next;
                      })}
                    >
                      {openParts.has(v.video_id)
                        ? "Show less"
                        : `${v.matched_segments.length - PARTS_SHOWN} more part${v.matched_segments.length - PARTS_SHOWN === 1 ? "" : "s"}`}
                      <Icon name={openParts.has(v.video_id) ? "arrowUp" : "arrowDown"} size={12} />
                    </button>
                  )}
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
