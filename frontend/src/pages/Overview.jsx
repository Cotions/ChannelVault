import { useState, useMemo } from "react";
import { sortVideos, videoMatches, hasAllTags } from "../lib/sort";
import { useSortPins } from "../lib/sortPins";
import { useRememberedPage } from "../lib/usePagination";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import TagChip from "../components/TagChip";

export default function Overview({ videos, playlists, tags = [], tagIds = [], onTagIds, query, onAddToPlaylist, onDelete, onEdit, onFetchMeta }) {
  const [browseSort, setBrowseSort] = useState("upload");
  const [browseDir,  setBrowseDir]  = useState("desc");
  const pins = useSortPins();   // videos fetched seconds ago hold their slot

  const q = (query || "").trim();
  const tagKey = tagIds.join(",");   // primitives only for the page-reset deps
  const [page, setPage] = useRememberedPage("home", [q, browseSort, browseDir, tagKey]);
  const browse = useMemo(() => {
    let filtered = q ? videos.filter(v => videoMatches(v, q)) : videos;
    if (tagIds.length) filtered = filtered.filter(v => hasAllTags(v, tagIds));
    return sortVideos(filtered, q ? "upload" : browseSort, q ? "desc" : browseDir, pins);
  }, [videos, browseSort, browseDir, q, tagIds, pins]);

  // What the header's tag menu has switched on, in the order it was picked.
  const activeTags = tagIds.map(id => tags.find(t => t.id === id)).filter(Boolean);
  function dropTag(id) { onTagIds?.(ids => ids.filter(x => x !== id)); }

  const pageCount = Math.max(1, Math.ceil(browse.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageVideos = browse.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const cardProps = { onDelete, onEdit, onFetchMeta, playlists, onAddToPlaylist };

  return (
    <div className="card">
      <div className="page-head">
        <h2 className="page-title">{q ? "Results" : "Videos"}</h2>
        <span className="page-count">
          {q
            ? `${browse.length.toLocaleString()} for “${q}”`
            : browse.length.toLocaleString()}
        </span>
        {activeTags.length > 0 && (
          <span className="page-head-tags">
            {activeTags.map(t => <TagChip key={t.id} tag={t} size="sm" onRemove={() => dropTag(t.id)} />)}
          </span>
        )}
        <div className="page-head-spacer" />
        {!q && (
          <div className="sort-controls">
            <SortControls sort={browseSort} dir={browseDir} onSort={setBrowseSort} onDir={setBrowseDir} />
          </div>
        )}
      </div>
      {browse.length === 0 ? (
        <div className="empty">
          {q ? "No matches." : tagIds.length ? (
            <>No videos carry {tagIds.length > 1 ? "all of" : ""} {tagIds.map(id => tags.find(t => t.id === id)).filter(Boolean).map(t => <TagChip key={t.id} tag={t} size="sm" />)}</>
          ) : "No videos yet."}
        </div>
      ) : (
        <>
          <div className="video-grid">
            {pageVideos.map(v => <VideoCard key={v.video_id} video={v} {...cardProps} />)}
          </div>
          <Pagination page={safePage} count={pageCount} onPage={setPage} />
        </>
      )}
    </div>
  );
}
