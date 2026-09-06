import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { readLayout, saveLayout } from "../lib/layout";
import { sortVideos, videoMatches } from "../lib/sort";
import { artistsOf } from "../lib/artists";
import { useRememberedPage } from "../lib/usePagination";
import { getCreator, artistThumbUrl } from "../lib/api";
import { fmt, safeUrl } from "../lib/fmt";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import Icon from "../components/Icon";

export default function ArtistPage({ videos, wanted, ignored, query, onDelete, onRemoveMark, onEdit, onFetchMeta, playlists, onAddToPlaylist }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const artist   = decodeURIComponent(name);
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useState("upload");
  const [dir,    setDir]    = useState("desc");
  const [creator, setCreator] = useState(null);

  useEffect(() => {
    let alive = true;
    getCreator(artist).then(c => { if (alive) setCreator(c); });
    return () => { alive = false; };
  }, [artist]);

  function switchLayout(next) {
    setLayout(next);
    saveLayout(next);
  }

  const q = (query || "").trim();
  const [page, setPage] = useRememberedPage(`artist:${artist}`, [q, sort, dir]);
  const artistVideos  = sortVideos(
    videos.filter(v => artistsOf(v).includes(artist) && videoMatches(v, q)),
    sort, dir
  );

  const pageCount = Math.max(1, Math.ceil(artistVideos.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageVideos = artistVideos.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const artistWanted  = wanted.filter(v => artistsOf(v).includes(artist));
  const artistIgnored = ignored.filter(v => artistsOf(v).includes(artist));

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>
          <Icon name="back" size={15} />Back
        </button>
        <h2 className="artist-page-title">{artist}</h2>
        {artistVideos.length > 0 && (
          <span className="artist-badge">{artistVideos.length} video{artistVideos.length !== 1 ? "s" : ""}</span>
        )}
        {artistWanted.length > 0 && (
          <span className="artist-badge" style={{ background: "#1565c033", color: "#90caf9" }}><Icon name="download" size={12} />{artistWanted.length} wanted</span>
        )}
        {artistIgnored.length > 0 && (
          <span className="artist-badge" style={{ background: "#b71c1c33", color: "#ef9a9a" }}><Icon name="close" size={12} />{artistIgnored.length} skipped</span>
        )}
        {artistVideos.length > 0 && (
          <Link to={`/artist/${encodeURIComponent(artist)}/stats`} className="btn-secondary btn-export">Stats</Link>
        )}
        {artistVideos.length > 1 && (
          <SortControls sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
        )}
        {artistVideos.length > 0 && (
          <div className="layout-toggle">
            <button
              className={`btn-ghost${layout === "grid" ? " active" : ""}`}
              onClick={() => switchLayout("grid")}
              title="Grid view"
            >
              <Icon name="grid" size={15} />
            </button>
            <button
              className={`btn-ghost${layout === "list" ? " active" : ""}`}
              onClick={() => switchLayout("list")}
              title="List view"
            >
              <Icon name="list" size={15} />
            </button>
          </div>
        )}
      </div>

      {creator && (
        <div className="creator-profile">
          <div className="creator-profile-top">
            <img
              className="creator-profile-avatar"
              src={artistThumbUrl(artist)}
              alt=""
              onError={e => { e.currentTarget.style.visibility = "hidden"; }}
            />
            <div className="creator-profile-id">
              <div className="creator-profile-name">{artist}</div>
              {safeUrl(creator.channel_url) ? (
                <a className="creator-profile-handle" href={safeUrl(creator.channel_url)} target="_blank" rel="noreferrer">
                  {creator.handle || creator.channel_url}
                </a>
              ) : creator.handle && (
                <span className="creator-profile-handle">{creator.handle}</span>
              )}
            </div>
          </div>

          <div className="creator-profile-stats">
            {creator.subscriber_count != null && (
              <div className="creator-profile-stat">
                <span className="cp-num">{fmt(creator.subscriber_count)}</span>
                <span className="cp-label">Subscribers</span>
              </div>
            )}
            {creator.video_count != null && (
              <div className="creator-profile-stat">
                <span className="cp-num">{fmt(creator.video_count)}</span>
                <span className="cp-label">Videos</span>
              </div>
            )}
            {creator.total_views != null && (
              <div className="creator-profile-stat">
                <span className="cp-num">{fmt(creator.total_views)}</span>
                <span className="cp-label">Total views</span>
              </div>
            )}
            {creator.country && (
              <div className="creator-profile-stat">
                <span className="cp-num cp-text">{creator.country}</span>
                <span className="cp-label">Country</span>
              </div>
            )}
            {creator.joined_date && (
              <div className="creator-profile-stat">
                <span className="cp-num cp-text">{creator.joined_date}</span>
                <span className="cp-label">Joined</span>
              </div>
            )}
          </div>

          {creator.description && (
            <p className="creator-profile-desc">{creator.description}</p>
          )}

          {(creator.email || (creator.links && creator.links.length > 0)) && (
            <div className="creator-profile-links">
              {creator.email && safeUrl(`mailto:${creator.email}`, ["mailto:"]) && (
                <a className="cp-link" href={safeUrl(`mailto:${creator.email}`, ["mailto:"])}>✉ {creator.email}</a>
              )}
              {(creator.links || []).filter(l => safeUrl(l.url)).map((l, i) => (
                <a key={i} className="cp-link" href={safeUrl(l.url)} target="_blank" rel="noreferrer">🔗 {l.title}</a>
              ))}
            </div>
          )}
        </div>
      )}

      {artistVideos.length > 0 && (
        <>
          <div className={layout === "list" ? "video-list" : "video-grid"}>
            {pageVideos.map(v => (
              <VideoCard
                key={v.video_id}
                video={v}
                onDelete={onDelete}
                onEdit={onEdit}
                onFetchMeta={onFetchMeta}
                playlists={playlists}
                onAddToPlaylist={onAddToPlaylist}
                layout={layout}
              />
            ))}
          </div>
          <Pagination page={safePage} count={pageCount} onPage={setPage} />
        </>
      )}

      {artistWanted.length > 0 && (
        <div style={{ marginTop: artistVideos.length > 0 ? 24 : 0 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Wanted</div>
          <div className="wanted-list">
            {artistWanted.map(v => (
              <div key={v.video_id} className="wanted-item">
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer">
                  {v.title || v.video_id}
                </a>
                <button className="del-btn del-btn-danger" title="Remove mark" onClick={() => onRemoveMark(v.video_id)}><Icon name="close" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {artistIgnored.length > 0 && (
        <div style={{ marginTop: (artistVideos.length > 0 || artistWanted.length > 0) ? 24 : 0 }}>
          <div className="card-title" style={{ marginBottom: 8, color: "#ef9a9a" }}>Skipped</div>
          <div className="wanted-list">
            {artistIgnored.map(v => (
              <div key={v.video_id} className="ignored-item">
                <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noreferrer">
                  {v.title || v.video_id}
                </a>
                <button className="del-btn del-btn-danger" title="Remove mark" onClick={() => onRemoveMark(v.video_id)}><Icon name="close" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {artistVideos.length === 0 && artistWanted.length === 0 && artistIgnored.length === 0 && (
        <div className="empty">No videos found for this artist.</div>
      )}
    </div>
  );
}
