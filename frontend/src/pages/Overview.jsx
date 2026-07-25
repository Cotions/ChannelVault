import { useState, useMemo } from "react";
import { sortVideos, videoMatches } from "../lib/sort";
import { useRememberedPage } from "../lib/usePagination";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";

export default function Overview({ videos, playlists, query, onAddToPlaylist, onDelete, onEdit, onFetchMeta }) {
  const [browseSort, setBrowseSort] = useState("upload");
  const [browseDir,  setBrowseDir]  = useState("desc");

  const q = (query || "").trim();
  const [page, setPage] = useRememberedPage("home", [q, browseSort, browseDir]);
  const browse = useMemo(() => {
    const filtered = q ? videos.filter(v => videoMatches(v, q)) : videos;
    return sortVideos(filtered, q ? "upload" : browseSort, q ? "desc" : browseDir);
  }, [videos, browseSort, browseDir, q]);

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
      {browse.length === 0 ? (
        <div className="empty">{q ? "No matches." : "No videos yet."}</div>
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
