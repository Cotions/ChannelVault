import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { latestThumbUrl } from "../lib/api";
import { pinSortSlot, releaseSortSlot, PIN_MS } from "../lib/sortPins";
import { artistsOf } from "../lib/artists";
import { isYouTube, sourceLabel } from "../lib/source";
import { fmt, fmtDuration, fmtRecordedDate } from "../lib/fmt";
import Icon from "./Icon";
import Menu from "./Menu";
import TagChip from "./TagChip";

const AUDIO_FILE_RE = /\.(mp3|m4a|aac|opus|ogg|oga|flac|wav|weba)$/i;

export default function VideoCard({ video, onDelete, onEdit, onFetchMeta, playlists, onAddToPlaylist, onRemoveFromList, layout = "grid", hideTagId, hideChannel = false }) {
  const [thumbOk,    setThumbOk]    = useState(true);
  const [deleting,   setDeleting]   = useState(false);
  const [fetching,   setFetching]   = useState(false);
  // Holds yt-dlp's own reason ("Sign in to confirm your age", …) so the card
  // says why instead of a bare "Fetch failed".
  const [fetchErr,   setFetchErr]   = useState(null);
  const [elapsed,    setElapsed]    = useState(null);
  const [plAdded,    setPlAdded]    = useState(null);
  const [menuOpen,   setMenuOpen]   = useState(false);

  async function handleAddToPlaylist(plId, newName) {
    try {
      const r = await onAddToPlaylist(plId, video.video_id, newName);
      const name = newName || playlists.find(p => p.id === plId)?.name || "playlist";
      setPlAdded(r?.added === false ? `Already in ${name}` : `Added to ${name}`);
      setTimeout(() => setPlAdded(null), 2500);
    } catch {}
  }

  useEffect(() => {
    if (!fetching) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [fetching]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(video.video_id);
    } catch {
      setDeleting(false);
    }
  }

  async function handleFetchMeta() {
    setFetching(true);
    setFetchErr(null);
    // Hold this card's place in the list while the fetch runs and for as long as
    // the timer below stays up, so the numbers it just pulled can be read before
    // a stats-driven sort ("Oldest fetch") moves the card away.
    pinSortSlot(video);
    try {
      await onFetchMeta(video.video_id);
    } catch (e) {
      setFetchErr(e?.message || "Fetch failed");
      setTimeout(() => setFetchErr(null), 8000);
    } finally {
      setFetching(false);
      releaseSortSlot(video.video_id);
      setTimeout(() => setElapsed(null), PIN_MS);
    }
  }

  const dur     = fmtDuration(video.duration_secs);
  const date    = fmtRecordedDate(video.recorded_date);
  const artists = artistsOf(video);

  const AVAIL_LABELS = {
    private: "Private", deleted: "Deleted", members: "Members",
    geo: "Geo-blocked", age: "Age-gated", unavailable: "Unavailable",
  };
  // Kept for the sound only: plays over its thumbnail, so say so on the card.
  const audioOnly  = AUDIO_FILE_RE.test(video.file_path || "");
  const fromYT     = isYouTube(video);
  const dead       = video.availability && video.availability !== "available";
  const availLabel = dead ? (AVAIL_LABELS[video.availability] || "Unavailable") : null;

  // On a tag's own page every card would repeat that tag.
  const shownTags = (video.tags || []).filter(t => t.id !== hideTagId);

  const menuItems = [
    onAddToPlaylist && playlists && {
      label: "Add to playlist", icon: "playlist",
      items: [
        ...playlists.map(pl => ({ key: pl.id, label: pl.name, checked: pl.video_ids?.includes(video.video_id), onClick: () => handleAddToPlaylist(pl.id) })),
        { divider: true },
        { key: "new", input: { placeholder: "New playlist…" }, onSubmit: n => handleAddToPlaylist(null, n) },
      ],
    },
    onEdit && { label: "Edit details", icon: "pencil", onClick: () => onEdit(video) },
    onRemoveFromList && { label: "Remove from this playlist", icon: "minus", onClick: () => onRemoveFromList(video.video_id) },
    onFetchMeta && fromYT && { divider: true },
    onFetchMeta && fromYT && {
      label: dead ? `Refresh from YouTube (${availLabel.toLowerCase()})` : "Refresh from YouTube",
      icon: "refresh", disabled: fetching, onClick: handleFetchMeta,
    },
    onDelete && { divider: true },
    onDelete && {
      label: "Remove from library", icon: "trash", danger: true, disabled: deleting, onClick: handleDelete,
      confirm: { text: "Remove this video from the library? Its tags, playlists and watch history go too. The file stays on disk, and a scan adds it back.", yes: "Remove" },
    },
  ].filter(Boolean);

  return (
    <div className={`video-card${layout === "list" ? " list" : ""}${menuOpen ? " menu-open" : ""}`}>
      <Link to={`/video/${video.video_id}`} className="video-thumb-link">
        {thumbOk ? (
          <img
            className="video-thumb"
            src={latestThumbUrl(video.video_id, "card")}
            alt=""
            loading="lazy"
            onError={() => setThumbOk(false)}
          />
        ) : (
          <div className="video-thumb-placeholder"><Icon name="play" size={30} className="icon-fill" /></div>
        )}
        <span className="thumb-play"><Icon name="play" size={20} className="icon-fill" /></span>
        {availLabel && (
          <span className={`avail-badge avail-${video.availability}`} title={`${availLabel} on YouTube. Your copy is safe here.`}>
            {availLabel}
          </span>
        )}
        {video.watch_count > 0 && (
          <span className="watched-badge" title={`Watched ${video.watch_count}×`}>
            <Icon name="check" size={11} />{video.watch_count > 1 ? video.watch_count : ""}
          </span>
        )}
        {(audioOnly || !fromYT) && (
          <span className="audio-badge" title={[
            audioOnly && "Audio only — plays over the thumbnail",
            !fromYT && (video.source === "local" ? "Local file — not from any site" : `From ${sourceLabel(video.source)}`),
          ].filter(Boolean).join(" · ")}>
            {audioOnly && <><Icon name="volume" size={11} />Audio</>}
            {audioOnly && !fromYT && " · "}
            {!fromYT && sourceLabel(video.source)}
          </span>
        )}
        {dur && <span className="dur-badge">{dur}</span>}
      </Link>
      <div className="video-info">
        {menuItems.length > 0 && (
          <div className="video-more">
            <Menu items={menuItems} className="video-more-btn" label="More actions" onOpenChange={setMenuOpen} />
          </div>
        )}
        <div className="video-title">
          <Link to={`/video/${video.video_id}`}>{video.title || video.video_id}</Link>
        </div>
        {!hideChannel && (
          <Link className="video-channel" to={`/artist/${encodeURIComponent(artists[0])}`} title={artists.join(", ")}>
            {artists[0]}{artists.length > 1 ? ` +${artists.length - 1}` : ""}
          </Link>
        )}
        <div className="video-meta">
          {date && <span>{date}</span>}
          {video.view_count != null && <span>{fmt(video.view_count)} views</span>}
        </div>
        {shownTags.length > 0 && (
          <div className="video-tags">
            {shownTags.slice(0, 3).map(t => <TagChip key={t.id} tag={t} size="sm" link />)}
            {shownTags.length > 3 && (
              <span className="video-tags-more" title={shownTags.slice(3).map(t => t.name).join(", ")}>+{shownTags.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {(fetching || fetchErr || plAdded || elapsed != null) && (
        <span className={`card-status${fetchErr ? " is-bad" : ""}`} title={fetchErr || ""}>
          {fetching && <Icon name="refresh" size={12} className="spin" />}
          {fetchErr ? "Couldn't refresh" : plAdded ? plAdded : fetching ? `Refreshing ${elapsed?.toFixed(1) ?? "0.0"}s` : "Refreshed"}
        </span>
      )}
    </div>
  );
}
