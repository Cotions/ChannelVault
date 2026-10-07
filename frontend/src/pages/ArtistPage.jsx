import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { readLayout, saveLayout } from "../lib/layout";
import { sortVideos, videoMatches } from "../lib/sort";
import { useSortPins } from "../lib/sortPins";
import { artistsOf } from "../lib/artists";
import { useRememberedPage } from "../lib/usePagination";
import { getCreator, getCreators, getArtistLinks, linkArtists, unlinkArtist, getChannelStatuses, setChannelStatus, artistThumbUrl, scan } from "../lib/api";
import { CHANNEL_STATUS, markedOn } from "../lib/channelStatus";
import { describeLink } from "../lib/socials";
import { fmt, safeUrl } from "../lib/fmt";
import { isYouTube } from "../lib/source";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import Icon from "../components/Icon";
import ChannelLinker from "../components/ChannelLinker";
import SocialIcon from "../components/SocialIcon";
import ChannelStatusMenu from "../components/ChannelStatusMenu";

export default function ArtistPage({ videos, wanted, ignored, query, onDelete, onRemoveMark, onEdit, onFetchMeta, playlists, onAddToPlaylist, onScanDone }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const artist   = name;              // the router already decoded it; again would choke on "%"
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useState("upload");
  const [dir,    setDir]    = useState("desc");
  const [creator, setCreator] = useState(null);
  const [scanMsg, setScanMsg] = useState(null);   // null = idle
  const [scanning, setScanning] = useState(false);

  const [linked, setLinked] = useState([]);
  const [linking, setLinking] = useState(false);
  const [creatorNames, setCreatorNames] = useState([]);
  const [channelMark, setChannelMark] = useState(null);   // { status, marked_at } or null

  async function handleStatus(status) {
    const prev = channelMark;
    setChannelMark(status ? { status, marked_at: new Date().toISOString() } : null);
    try {
      const r = await setChannelStatus(artist, status);
      if (!r.ok) setChannelMark(prev);
    } catch { setChannelMark(prev); }
  }

  useEffect(() => {
    let alive = true;
    getCreator(artist).then(c => { if (alive) setCreator(c); });
    getArtistLinks(artist).then(l => { if (alive) setLinked(l || []); }).catch(() => {});
    getChannelStatuses().then(m => { if (alive) setChannelMark(m?.[artist] || null); }).catch(() => {});
    return () => { alive = false; };
  }, [artist]);

  // Saved-profile channels count too: a channel can be linked before any of
  // its videos are in the vault.
  useEffect(() => {
    if (!linking) return;
    getCreators().then(c => setCreatorNames((c || []).map(x => x.channel_name))).catch(() => {});
  }, [linking]);

  const allNames = useMemo(() => {
    const set = new Set(creatorNames);
    for (const list of [videos, wanted, ignored]) for (const v of list) for (const a of artistsOf(v)) set.add(a);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [videos, wanted, ignored, creatorNames]);
  const linkExclude = useMemo(() => new Set([artist, ...linked]), [artist, linked]);

  async function handleLink(other) {
    setLinking(false);
    try {
      const r = await linkArtists(artist, other);
      if (r.ok !== false) setLinked(r.linked || []);
    } catch { /* leave the list as it was */ }
  }

  async function handleUnlink(other) {
    if (!window.confirm(`Unlink ${other} from ${artist}?`)) return;
    try {
      await unlinkArtist(other);
      setLinked(await getArtistLinks(artist));
    } catch { /* leave the list as it was */ }
  }

  // Rescan only this artist's folders instead of the whole library.
  async function handleScan() {
    setScanning(true);
    setScanMsg("Scanning…");
    try {
      await scan(evt => {
        if (evt.type === "start")    setScanMsg(evt.total ? `Scanning 0/${evt.total}…` : "No files found");
        if (evt.type === "progress") setScanMsg(`Scanning ${evt.done}/${evt.total}…`);
        if (evt.type === "done") {
          setScanMsg(evt.total ? `${evt.total} file${evt.total !== 1 ? "s" : ""} scanned${evt.errors ? `, ${evt.errors} error${evt.errors !== 1 ? "s" : ""}` : ""}` : "No files found");
          onScanDone?.();
        }
      }, artist);
    } catch {
      setScanMsg("Scan failed");
    }
    setScanning(false);
    setTimeout(() => setScanMsg(null), 4000);
  }

  function switchLayout(next) {
    setLayout(next);
    saveLayout(next);
  }

  const q = (query || "").trim();
  const pins = useSortPins();   // videos fetched seconds ago hold their slot
  const [page, setPage] = useRememberedPage(`artist:${artist}`, [q, sort, dir]);
  const artistVideos  = sortVideos(
    videos.filter(v => artistsOf(v).includes(artist) && videoMatches(v, q)),
    sort, dir, pins
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
        <h2 className="artist-page-title">
          {artist}
          {channelMark && CHANNEL_STATUS[channelMark.status] && (
            <span
              className={`channel-status-badge is-${channelMark.status}`}
              title={markedOn(channelMark.marked_at) ? `Marked ${markedOn(channelMark.marked_at)}` : undefined}
            >
              {CHANNEL_STATUS[channelMark.status].label}
            </span>
          )}
        </h2>
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
        <button
          className="btn-secondary btn-export"
          onClick={handleScan}
          disabled={scanning}
          title="Scan this artist's folders for new files"
        >
          <Icon name="refresh" size={13} />{scanMsg || "Scan folder"}
        </button>
        <ChannelStatusMenu status={channelMark?.status || null} onChange={handleStatus} />
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
      <div className="artist-links-row">
        {linked.length > 0 && <span className="artist-links-label">Also on</span>}
        {linked.map(n => (
          <span key={n} className="artist-link-chip">
            <Link to={`/artist/${encodeURIComponent(n)}`} className="artist-link-name">
              <img
                className="artist-link-avatar"
                src={artistThumbUrl(n)}
                alt=""
                onError={e => { e.currentTarget.style.display = "none"; }}
              />
              {n}
            </Link>
            <button className="artist-link-remove" title={`Unlink ${n}`} onClick={() => handleUnlink(n)}>
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        {linking ? (
          <ChannelLinker
            names={allNames}
            exclude={linkExclude}
            onPick={handleLink}
            onClose={() => setLinking(false)}
          />
        ) : (
          <button className="artist-link-add" onClick={() => setLinking(true)} title="Mark another channel as the same person">
            <Icon name="plus" size={12} />Link channel
          </button>
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
                <a className="cp-link" href={safeUrl(`mailto:${creator.email}`, ["mailto:"])}>
                  <SocialIcon name="email" />{creator.email}
                </a>
              )}
              {(creator.links || []).filter(l => safeUrl(l.url)).map((l, i) => {
                const s = describeLink(l.url);
                return (
                  <a key={i} className="cp-link" href={safeUrl(l.url)} target="_blank" rel="noreferrer" title={l.url}>
                    <SocialIcon name={s.key} color={s.color} />
                    {s.key !== "website" && <span className="cp-link-platform">{s.label}</span>}
                    {s.detail && <span className="cp-link-detail">{s.detail}</span>}
                  </a>
                );
              })}
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
                <a href={isYouTube(v) ? `https://www.youtube.com/watch?v=${v.video_id}` : safeUrl(v.url)} target="_blank" rel="noreferrer">
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
                <a href={isYouTube(v) ? `https://www.youtube.com/watch?v=${v.video_id}` : safeUrl(v.url)} target="_blank" rel="noreferrer">
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
