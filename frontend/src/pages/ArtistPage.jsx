import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { goBack } from "../lib/nav";
import { readLayout, saveLayout } from "../lib/layout";
import { sortVideos, videoMatches } from "../lib/sort";
import { useDescriptionHits } from "../lib/descSearch";
import { useSortPins } from "../lib/sortPins";
import { artistsOf } from "../lib/artists";
import { useRememberedPage, useRememberedState } from "../lib/usePagination";
import { getCreator, getCreators, getArtistLinks, linkArtists, unlinkArtist, getChannelStatuses, setChannelStatus, getArtistRatings, setArtistRating, artistThumbUrl, scan } from "../lib/api";
import { ratingsOn } from "../lib/rating";
import { RatingInput } from "../components/Rating";
import { CHANNEL_STATUS, markedOn } from "../lib/channelStatus";
import { describeLink } from "../lib/socials";
import { fmt, safeUrl } from "../lib/fmt";
import { isYouTube } from "../lib/source";
import SortControls from "../components/SortControls";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import VideoCard from "../components/VideoCard";
import Icon from "../components/Icon";
import DownloadButton from "../components/DownloadButton";
import MarkRow from "../components/MarkRow";
import DownloadPrefs from "../components/DownloadPrefs";
import ChannelLinker from "../components/ChannelLinker";
import SocialIcon from "../components/SocialIcon";
import ChannelStatusMenu from "../components/ChannelStatusMenu";
import FeedFollow from "../components/FeedFollow";
import ArtistRename from "../components/ArtistRename";
import AvatarPicker from "../components/AvatarPicker";
import ProfileEffect from "../components/ProfileEffect";
import ProfileEffectMenu from "../components/ProfileEffectMenu";
import { useEffectPrefs, resolveEffect } from "../lib/profileEffects";

// Remount per name: the previous one's data, errors and in-flight requests
// must never show on the next.
export default function ArtistPage(props) {
  const { name } = useParams();
  return <ArtistPageBody key={name} {...props} />;
}

function ArtistPageBody({ videos, wanted, ignored, query, rating: ratingSettings, onDelete, onRemoveMark, onEdit, onFetchMeta, playlists, onAddToPlaylist, onScanDone }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const artist   = name;              // the router already decoded it; again would choke on "%"
  const [layout, setLayout] = useState(readLayout);
  const [sort,   setSort]   = useRememberedState(`artist:${name}:sort`, "upload");
  const [dir,    setDir]    = useRememberedState(`artist:${name}:dir`, "desc");
  const [creator, setCreator] = useState(null);
  const [scanMsg, setScanMsg] = useState(null);   // null = idle
  const [scanning, setScanning] = useState(false);

  const [linked, setLinked] = useState([]);
  const [linking, setLinking] = useState(false);
  const [creatorNames, setCreatorNames] = useState([]);
  const [channelMark, setChannelMark] = useState(null);   // { status, marked_at } or null
  const [rating, setRating] = useState(null);             // 1 to 10 (half stars), null = not rated
  const [ratingBusy, setRatingBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pickingPicture, setPickingPicture] = useState(false);
  const [, setPictureTick] = useState(0);   // re-render so every avatar picks up the new picture
  const effectPrefs = useEffectPrefs();
  const effect = resolveEffect(effectPrefs, artist);

  async function handleStatus(status) {
    const prev = channelMark;
    setChannelMark(status ? { status, marked_at: new Date().toISOString() } : null);
    try {
      const r = await setChannelStatus(artist, status);
      if (!r.ok) setChannelMark(prev);
    } catch { setChannelMark(prev); }
  }

  // Saved at once; put back if the backend says no.
  async function handleRate(next) {
    const prev = rating;
    setRating(next);
    setRatingBusy(true);
    try {
      const r = await setArtistRating(artist, next);
      if (!r.ok) setRating(prev);
    } catch { setRating(prev); }
    setRatingBusy(false);
  }

  useEffect(() => {
    let alive = true;
    getArtistRatings().then(m => { if (alive) setRating(m?.[artist] || null); }).catch(() => {});
    getCreator(artist).then(c => { if (alive) setCreator(c); }).catch(() => {});
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
  const descHits = useDescriptionHits(q);
  const [page, setPage] = useRememberedPage(`artist:${artist}`, [q, sort, dir]);
  const artistVideos  = sortVideos(
    videos.filter(v => artistsOf(v).includes(artist) && videoMatches(v, q, descHits)),
    sort, dir, pins
  );

  const pageCount = Math.max(1, Math.ceil(artistVideos.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageVideos = artistVideos.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const artistWanted  = wanted.filter(v => artistsOf(v).includes(artist));
  const artistIgnored = ignored.filter(v => artistsOf(v).includes(artist));

  // Videos / Wanted / Skipped. In the URL so Back and a refresh keep the tab;
  // a tab with nothing left in it falls back to the first that has something.
  const counts = { videos: artistVideos.length, wanted: artistWanted.length, skipped: artistIgnored.length };
  const asked  = params.get("tab");
  // No tab asked for: the first one with something in it.
  const first  = ["videos", "wanted", "skipped"].find(k => counts[k]) || "videos";
  const tab    = counts[asked] ? asked : first;
  function openTab(next) {
    setParams(p => {
      const n = new URLSearchParams(p);
      if (next === "videos") n.delete("tab"); else n.set("tab", next);
      return n;
    }, { replace: true });
  }
  const showTabs = counts.wanted > 0 || counts.skipped > 0;

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => goBack(navigate)}>
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
          {ratingsOn(ratingSettings) && (
            <RatingInput value={rating} busy={ratingBusy} onChange={handleRate} size={18} />
          )}
          <button className="artist-rename-btn" onClick={() => setRenaming(true)} title="Rename this artist, or merge it into another">
            <Icon name="pencil" size={13} />
          </button>
          <button className="artist-rename-btn" onClick={() => setPickingPicture(true)} title="Choose this artist's picture">
            <Icon name="image" size={13} />
          </button>
        </h2>
        {artistVideos.length > 0 && (
          <span className="artist-badge">{artistVideos.length} video{artistVideos.length !== 1 ? "s" : ""}</span>
        )}
        {artistWanted.length > 0 && (
          <button type="button" className="artist-badge artist-badge-btn" style={{ background: "#1565c033", color: "#90caf9" }}
                  onClick={() => openTab("wanted")} title="Show the Wanted tab">
            <Icon name="download" size={12} />{artistWanted.length} wanted
          </button>
        )}
        {artistIgnored.length > 0 && (
          <button type="button" className="artist-badge artist-badge-btn" style={{ background: "#b71c1c33", color: "#ef9a9a" }}
                  onClick={() => openTab("skipped")} title="Show the Skipped tab">
            <Icon name="close" size={12} />{artistIgnored.length} skipped
          </button>
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
        {tab === "videos" && artistVideos.length > 1 && (
          <SortControls sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
        )}
        {tab === "videos" && artistVideos.length > 0 && (
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
      <ArtistRename
        artist={artist}
        editing={renaming}
        onCloseEdit={() => setRenaming(false)}
        onRenamed={async next => {
          await onScanDone?.();
          navigate(`/artist/${encodeURIComponent(next)}`, { replace: true });
        }}
        onAlias={next => navigate(`/artist/${encodeURIComponent(next)}`, { replace: true })}
      />
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
        {!channelMark && videos.some(v => isYouTube(v) && artistsOf(v).includes(artist)) && (
          <FeedFollow key={artist} artist={artist} />
        )}
        {!channelMark && videos.some(v => isYouTube(v) && artistsOf(v).includes(artist)) && (
          <DownloadPrefs artist={artist} />
        )}
      </div>

      {creator && (
        <div className="creator-profile">
          {effect && <ProfileEffect effect={effect} seed={artist} />}
          {effectPrefs.enabled && <ProfileEffectMenu artist={artist} prefs={effectPrefs} />}
          <div className="creator-profile-top">
            <button className="creator-profile-avatar-btn" onClick={() => setPickingPicture(true)} title="Choose this artist's picture">
              <img
                className="creator-profile-avatar"
                src={artistThumbUrl(artist)}
                alt=""
                onLoad={e => { e.currentTarget.style.visibility = ""; }}
                onError={e => { e.currentTarget.style.visibility = "hidden"; }}
              />
              <span className="creator-profile-avatar-edit"><Icon name="image" size={14} /></span>
            </button>
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

      {showTabs && (
        <div className="artist-tabs" role="tablist">
          {[["videos", "Videos"], ["wanted", "Wanted"], ["skipped", "Skipped"]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
                    className={`artist-tab artist-tab-${k}${tab === k ? " is-on" : ""}`}
                    disabled={!counts[k]} onClick={() => openTab(k)}>
              {label}<span className="artist-tab-n">{counts[k].toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      {tab === "videos" && artistVideos.length > 0 && (
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

      {tab === "wanted" && (
        <div className="mark-list">
          {artistWanted.map(v => (
            <MarkRow key={v.video_id} video={v} onRemoveMark={onRemoveMark}>
              {isYouTube(v) && <DownloadButton video={v} className="btn-secondary" />}
            </MarkRow>
          ))}
        </div>
      )}

      {tab === "skipped" && (
        <div className="mark-list">
          {artistIgnored.map(v => <MarkRow key={v.video_id} video={v} onRemoveMark={onRemoveMark} />)}
        </div>
      )}

      {tab === "videos" && artistVideos.length === 0 && showTabs && (
        <div className="empty">No downloaded videos yet{q ? " match the search" : ""}.</div>
      )}

      {artistVideos.length === 0 && artistWanted.length === 0 && artistIgnored.length === 0 && (
        <div className="empty">No videos found for this artist.</div>
      )}

      {pickingPicture && (
        <AvatarPicker
          artist={artist}
          videos={videos}
          onClose={() => setPickingPicture(false)}
          onSaved={() => setPictureTick(t => t + 1)}
        />
      )}
    </div>
  );
}
