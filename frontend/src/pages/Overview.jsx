import { useState, useMemo } from "react";
import { sortVideos, videoMatches, hasAllTags } from "../lib/sort";
import { useRememberedPage } from "../lib/usePagination";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import TagChip, { tagStyle } from "../components/TagChip";
import Icon from "../components/Icon";

export default function Overview({ videos, playlists, tags = [], query, onAddToPlaylist, onDelete, onEdit, onFetchMeta }) {
  const [browseSort, setBrowseSort] = useState("upload");
  const [browseDir,  setBrowseDir]  = useState("desc");
  const [tagIds,     setTagIds]     = useState([]);   // selected tag filter, AND across ids

  const q = (query || "").trim();
  const tagKey = tagIds.join(",");   // primitives only for the page-reset deps
  const [page, setPage] = useRememberedPage("home", [q, browseSort, browseDir, tagKey]);
  const browse = useMemo(() => {
    let filtered = q ? videos.filter(v => videoMatches(v, q)) : videos;
    if (tagIds.length) filtered = filtered.filter(v => hasAllTags(v, tagIds));
    return sortVideos(filtered, q ? "upload" : browseSort, q ? "desc" : browseDir);
  }, [videos, browseSort, browseDir, q, tagIds]);

  const usedTags = useMemo(() => tags.filter(t => t.video_count > 0), [tags]);
  function toggleTag(id) {
    setTagIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

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
        <div className="page-head-spacer" />
        {!q && (
          <div className="sort-controls">
            <SortControls sort={browseSort} dir={browseDir} onSort={setBrowseSort} onDir={setBrowseDir} />
          </div>
        )}
      </div>
      {usedTags.length > 0 && (
        <div className="tag-filter">
          <Icon name="tag" size={13} className="tag-filter-icon" />
          {usedTags.map(t => {
            const on = tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={`tag-chip tag-chip-sm tag-filter-chip${on ? " is-on" : ""}`}
                style={on ? tagStyle(t.color) : undefined}
                onClick={() => toggleTag(t.id)}
                title={on ? `Stop filtering by ${t.name}` : `Only videos tagged ${t.name}`}
              >
                <span className="tag-chip-dot" style={{ background: t.color }} />
                <span className="tag-chip-name">{t.name}</span>
                <span className="tag-filter-count">{t.video_count}</span>
              </button>
            );
          })}
          {tagIds.length > 0 && (
            <button type="button" className="btn-ghost tag-filter-clear" onClick={() => setTagIds([])}>
              <Icon name="close" size={12} /> clear
            </button>
          )}
        </div>
      )}
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
