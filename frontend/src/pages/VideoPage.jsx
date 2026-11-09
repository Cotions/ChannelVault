import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { goBack } from "../lib/nav";
import {
  thumbUrl, artistThumbUrl, getThumbnails, fetchThumbnail, thumbnailVersionUrl,
  getSegments, createSegment, updateSegment, deleteSegment, addSegmentTag, removeSegmentTag,
  addVideoTag, removeVideoTag, importChapters, getTagSegments, getVideo,
} from "../lib/api";
import { artistsOf } from "../lib/artists";
import { isYouTube, sourceLabel } from "../lib/source";
import { fmt, fmtBytes, fmtRecordedDate, safeUrl } from "../lib/fmt";
import { usePlayer } from "../player/playerContext";
import { usePlaybackTime } from "../player/usePlaybackTime";
import QueueBar from "../player/QueueBar";
import WriteTags from "../components/WriteTags";
import Icon from "../components/Icon";
import Menu from "../components/Menu";
import TagPicker from "../components/TagPicker";
import SegmentList from "../components/SegmentList";
import AudioTracks from "../components/AudioTracks";

/* Collapsed to three lines like YouTube's, with its links made clickable. */
const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;
function Description({ text }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  const parts = text.split(URL_RE).map((bit, i) => {
    if (i % 2 === 0) return bit;
    const href = safeUrl(bit);
    if (!href) return bit;
    const shown = bit.replace(/^https?:\/\/(www\.)?/, "");
    return <a key={i} href={href} target="_blank" rel="noreferrer">{shown.length > 48 ? `${shown.slice(0, 46)}…` : shown}</a>;
  });
  return (
    <div className="vp-desc">
      <div ref={ref} className={`vp-desc-body${open ? " is-open" : ""}`}>{parts}</div>
      {(long || open) && (
        <button type="button" className="vp-desc-more" onClick={() => setOpen(o => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export default function VideoPage({ videos, tags = [], onTagsChanged, onEdit, onFetchMeta, onDelete, playlists, onAddToPlaylist }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const player = usePlayer();
  // Stable callbacks (useCallback in the provider) — safe as effect deps.
  const {
    openInline, onLeavePage, setPoster, close: closePlayer, setDock, seek, playQueue,
    setSegments: publishSegments,
  } = player;
  // Length only: the position is read by the segment list itself, so a playing
  // video does not rerender this whole page on every tick.
  const playback = usePlaybackTime(player.videoRef, player.activeId, { time: false });
  const [segments,   setSegments]   = useState([]);
  const [videoTags,  setVideoTags]  = useState([]);
  const [selectedSeg, setSelectedSeg] = useState(null);
  const [segBusy,    setSegBusy]    = useState(false);
  const jumpedRef = useRef(null);
  const [fetching,   setFetching]   = useState(false);
  const [elapsed,    setElapsed]    = useState(null);
  const [deleting,   setDeleting]   = useState(false);
  const [thumbs,     setThumbs]     = useState([]);
  const [thumbIdx,   setThumbIdx]   = useState(0);
  const [thumbBusy,  setThumbBusy]  = useState(false);
  const [thumbMsg,   setThumbMsg]   = useState(null);
  const [dupPrompt,  setDupPrompt]  = useState(null);
  const audioRef = useRef(null);
  const writeRef = useRef(null);
  const toolsRef = useRef(null);
  const [trackCount, setTrackCount] = useState(0);

  // Loads answer late: one for a video we already left must not land on this one.
  const idRef = useRef(id);
  useEffect(() => { idRef.current = id; }, [id]);   // declared first, so it runs before the loads

  const loadThumbs = useCallback(async () => {
    try {
      const r = await getThumbnails(id);
      if (idRef.current !== id) return [];
      const list = (r.thumbnails || []).map(t =>
        t.kind === "original" ? thumbUrl(id) : thumbnailVersionUrl(id, t.file)
      );
      setThumbs(list);
      return list;
    } catch { if (idRef.current === id) setThumbs([]); return []; }
  }, [id]);

  useEffect(() => {
    setThumbMsg(null);
    // Default to the newest thumbnail (last in the list: original first, fetched by age).
    loadThumbs().then(list => { if (idRef.current === id) setThumbIdx(Math.max(0, list.length - 1)); });
  }, [id, loadThumbs]);

  const video = videos.find(v => v.video_id === id);

  // The library list carries no descriptions; this video's comes on its own.
  // Asked again when the list hands over a new copy of the video (an edit, a
  // fetch), so it never shows one that changed since.
  const [desc, setDesc] = useState(null);           // { id, text }
  useEffect(() => {
    if (!video || video.description !== undefined) return;
    let alive = true;
    getVideo(id).then(v => { if (alive) setDesc({ id, text: v.description || null }); }, () => {});
    return () => { alive = false; };
  }, [id, video]);
  const description = video?.description !== undefined ? video.description
                    : desc?.id === id ? desc.text : null;

  const loadSegments = useCallback(async () => {
    try {
      const r = await getSegments(id);
      if (idRef.current !== id) return;
      setSegments(r.segments || []);
      setVideoTags(r.video_tags || []);
    } catch { if (idRef.current === id) { setSegments([]); setVideoTags([]); } }
  }, [id]);
  // Clear first: the last video's parts must not reach the player under this id.
  useEffect(() => { setSelectedSeg(null); setSegments([]); setVideoTags([]); loadSegments(); }, [loadSegments]);
  // The player's scrub bar draws the same parts, and it outlives this page.
  useEffect(() => { publishSegments(id, segments); }, [id, segments, publishSegments]);

  // Deep links from tag pages: /video/:id?t=754 lands on that second, once.
  const jumpTo = params.get("t");
  useEffect(() => {
    if (jumpTo == null || player.activeId !== id) return;
    const key = `${id}@${jumpTo}`;
    if (jumpedRef.current === key) return;
    const el = player.videoRef.current;
    if (!el) return;
    const go = () => { jumpedRef.current = key; seek(parseFloat(jumpTo)); };
    if (el.readyState >= 1) { go(); return; }
    // Left before the metadata came: the next video must not jump to this second.
    el.addEventListener("loadedmetadata", go, { once: true });
    return () => el.removeEventListener("loadedmetadata", go);
  }, [jumpTo, id, player.activeId, player.videoRef, seek]);

  // Every mutation reloads this page's segments and lets App refresh the cards.
  async function mutate(fn) {
    setSegBusy(true);
    try {
      const r = await fn();
      if (r && r.ok === false) return false;
      await loadSegments();
      onTagsChanged?.(id);
      return true;
    } catch { return false; } finally { setSegBusy(false); }
  }
  const handleCreateSegment = data          => mutate(() => createSegment(id, data));
  const handleUpdateSegment = (sid, fields) => mutate(() => updateSegment(sid, fields));
  const handleDeleteSegment = sid           => mutate(() => deleteSegment(sid));
  const handleAddSegTag     = (sid, name)   => mutate(() => addSegmentTag(sid, name));
  const handleRemoveSegTag  = (sid, tid)    => mutate(() => removeSegmentTag(sid, tid));
  const handleAddVideoTag   = name          => mutate(() => addVideoTag(id, name));
  const handleRemoveVideoTag = tag          => mutate(() => removeVideoTag(id, tag.id));
  const handleImportChapters = ()           => mutate(() => importChapters(id));

  async function handleAddToPlaylist(pl) {
    try {
      const r = await onAddToPlaylist(pl.id, id, pl.name);
      setThumbMsg(r?.added === false ? `Already in ${pl.name}` : `Added to ${pl.name}`);
    } catch { setThumbMsg("Couldn't add it"); }
    setTimeout(() => setThumbMsg(null), 3000);
  }

  // Play just this video's segments that carry one tag, in order.
  const playSegmentsOfTag = useCallback(async (tag) => {
    const r = await getTagSegments(tag.id);
    if (!r.ok || !r.items?.length) return;
    const mine = r.items.filter(i => i.video_id === id);
    if (!mine.length) return;
    playQueue(mine, { tagId: tag.id, tagName: tag.name, color: tag.color });
  }, [id, playQueue]);

  // Hand the video off to the persistent player; minimize/close on leave.
  useEffect(() => {
    // A ?t= link names its own second; resuming would fight it.
    if (video) openInline(id, { title: video.title || id, resume: jumpTo == null });
    // Re-open only when the video id or its title changes, not on every videos[] refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, video?.title, openInline]);
  useEffect(() => () => onLeavePage(), [onLeavePage]);
  // Keep the player's poster in sync with the cycled thumbnail.
  useEffect(() => {
    setPoster(thumbs[thumbIdx] || thumbUrl(id));
  }, [thumbs, thumbIdx, id, setPoster]);

  async function handleFetchThumbnail() {
    setThumbBusy(true);
    setThumbMsg(null);
    try {
      const r = await fetchThumbnail(id);
      if (r.availability) setThumbMsg("Unavailable on YouTube");
      else if (!r.ok)     setThumbMsg("Fetch failed");
      else if (r.reason === "maybe-duplicate") {
        setDupPrompt({ preview: r.preview, distance: r.distance, current: thumbs[thumbIdx] || thumbUrl(id) });
      }
      else if (r.added) {
        const list = await loadThumbs();
        setThumbIdx(Math.max(0, list.length - 1));
        setThumbMsg("New thumbnail saved");
      } else setThumbMsg("Already have this one");
    } catch {
      setThumbMsg("Fetch failed");
    } finally {
      setThumbBusy(false);
      setTimeout(() => setThumbMsg(null), 3000);
    }
  }

  async function confirmSaveThumb() {
    setDupPrompt(null);
    setThumbBusy(true);
    try {
      const r = await fetchThumbnail(id, true);
      if (r.availability) setThumbMsg("Unavailable on YouTube");
      else if (!r.ok)     setThumbMsg("Fetch failed");
      else if (r.added) {
        const list = await loadThumbs();
        setThumbIdx(Math.max(0, list.length - 1));
        setThumbMsg("New thumbnail saved");
      } else setThumbMsg("Already have this one");
    } catch {
      setThumbMsg("Fetch failed");
    } finally {
      setThumbBusy(false);
      setTimeout(() => setThumbMsg(null), 3000);
    }
  }

  useEffect(() => {
    if (!fetching) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(t);
  }, [fetching]);

  if (!video) {
    return (
      <div className="card">
        <div className="artist-page-header">
          <button className="btn-secondary btn-back" onClick={() => goBack(navigate)}>
            <Icon name="back" size={15} />Back
          </button>
          <h2 className="artist-page-title">Video</h2>
        </div>
        <div className="empty">{videos.length === 0 ? "Loading…" : "Video not found in vault."}</div>
      </div>
    );
  }

  const fromYT = isYouTube(video);
  // Off YouTube the link is whatever the file was tagged with; a local file has none.
  const srcUrl = fromYT ? `https://www.youtube.com/watch?v=${video.video_id}` : safeUrl(video.url);
  const srcName = sourceLabel(video.source);
  const artists = artistsOf(video);
  // Tags that actually mark parts of this video, so "play only X" has something to play.
  const segmentTags = [...new Map(
    segments.flatMap(sg => sg.tags || []).map(t => [t.id, t])
  ).values()];
  const poster = thumbs[thumbIdx] || thumbUrl(video.video_id);
  const cycle  = () => thumbs.length > 1 && setThumbIdx(i => (i + 1) % thumbs.length);
  const watched = video.watch_count > 0 || player.completedId === video.video_id;

  async function handleFetchMeta() {
    setFetching(true);
    try { await onFetchMeta(video.video_id); } catch { /* ignore */ } finally {
      setFetching(false);
      setTimeout(() => setElapsed(null), 5000);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      closePlayer();
      await onDelete(video.video_id);
      goBack(navigate);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => goBack(navigate)}>
          <Icon name="back" size={15} />Back
        </button>
        <div className="video-page-spacer" />
        {(elapsed != null || thumbMsg) && (
          <span className="vp-status">{fetching ? `Refreshing ${elapsed?.toFixed(1)}s` : thumbMsg || "Refreshed"}</span>
        )}
        <div className="vp-tools" ref={toolsRef}>
          {srcUrl && (
            <a href={srcUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-yt" title={`Open on ${srcName}`}>
              {fromYT ? (
                <svg className="yt-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="#ff0033" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8z"/>
                  <path fill="#fff" d="M9.6 15.6V8.4L15.8 12l-6.2 3.6z"/>
                </svg>
              ) : <Icon name="external" size={15} />}
              <span className="btn-yt-label">Open on {srcName}</span>
            </a>
          )}
          <Menu
            label="More actions"
            items={[
              onAddToPlaylist && playlists && {
                label: "Add to playlist", icon: "playlist",
                items: [
                  ...playlists.map(pl => ({ key: pl.id, label: pl.name, checked: pl.video_ids?.includes(id), onClick: () => handleAddToPlaylist(pl) })),
                  { divider: true },
                  { key: "new", input: { placeholder: "New playlist…" }, onSubmit: n => handleAddToPlaylist({ id: null, name: n }) },
                ],
              },
              { label: "Edit details", icon: "pencil", onClick: () => onEdit(video) },
              { label: trackCount ? "Soundtracks" : "Add a soundtrack", icon: "volume", hint: trackCount ? String(trackCount) : null,
                onClick: () => audioRef.current?.open(toolsRef.current?.getBoundingClientRect()) },
              { divider: true },
              fromYT && { label: "Refresh from YouTube", icon: "refresh", disabled: fetching, onClick: handleFetchMeta },
              fromYT && { label: "Get latest thumbnail", icon: "image", disabled: thumbBusy, onClick: handleFetchThumbnail },
              thumbs.length > 1 && { label: "Next thumbnail", icon: "cycle", hint: `${thumbIdx + 1} of ${thumbs.length}`, keepOpen: true, onClick: cycle },
              video.file_path && { label: "Re-read chapters from file", icon: "refresh", disabled: segBusy, onClick: handleImportChapters,
                title: "Read the chapters saved in the file again. Parts you made stay." },
              video.file_path && { label: "Write details to file", icon: "tag",
                onClick: () => writeRef.current?.open(toolsRef.current?.getBoundingClientRect()) },
              { divider: true },
              { label: "Remove from library", icon: "trash", danger: true, disabled: deleting, onClick: handleDelete,
                confirm: { text: "Remove this video from the library? Its tags, parts, playlists and watch history go too. The file stays on disk, and a scan adds it back.", yes: "Remove" } },
            ]}
          />
          <AudioTracks ref={audioRef} hideTrigger videoId={id} duration={playback.duration || video.duration_secs || 0} onLibraryChanged={onTagsChanged} onCount={setTrackCount} />
          {video.file_path && <WriteTags ref={writeRef} hideTrigger key={video.video_id} videoId={video.video_id} />}
        </div>
      </div>

      <div className="vp-layout">
      <div className="vp-main">
      <div className="vp-player-wrap">
        {player.error ? (
          <div className="player-fallback">
            <img src={poster} alt="" onError={e => { e.target.style.display = "none"; }} />
            <div className="empty">
              Browser can't play this file{video.file_path ? ` (${video.file_path.split(".").pop()})` : ""}.{" "}
              {srcUrl && <a href={srcUrl} target="_blank" rel="noreferrer" style={{ color: "#90caf9" }}>Watch on {srcName}</a>}
            </div>
          </div>
        ) : (
          <div className="vp-player-dock" ref={setDock} />
        )}
      </div>

      {player.queue && <QueueBar />}

      <div className="vp-below">
        <h1 className="vp-title">{video.title || video.video_id}</h1>
        <div className="vp-byline">
          <div className="vp-channels">
            {artists.map(artist => (
              <Link key={artist} to={`/artist/${encodeURIComponent(artist)}`} className="vp-channel">
                <img
                  className="vp-channel-avatar"
                  src={artistThumbUrl(artist)}
                  alt=""
                  onError={e => { e.target.style.visibility = "hidden"; }}
                />
                <span className="vp-channel-name">{artist}</span>
                <span className="vp-channel-arrow"><Icon name="arrowRight" size={14} /></span>
              </Link>
            ))}
          </div>
          <div className="vp-meta">
            {[
              video.view_count != null && `${fmt(video.view_count)} views`,
              video.like_count != null && `${fmt(video.like_count)} likes`,
              video.recorded_date && fmtRecordedDate(video.recorded_date),
              video.file_size_bytes != null && fmtBytes(video.file_size_bytes),
              watched && `Watched ${Math.max(video.watch_count || 0, 1)}×`,
            ].filter(Boolean).map(t => <span key={t}>{t}</span>)}
          </div>
        </div>

        <div className="vp-tags">
          <span className="vp-tags-label"><Icon name="tag" size={13} /> Tags</span>
          <TagPicker
            allTags={tags}
            selected={videoTags}
            onAdd={handleAddVideoTag}
            onRemove={handleRemoveVideoTag}
            placeholder={videoTags.length ? "Add another…" : "Tag the whole video…"}
            disabled={segBusy}
          />
        </div>
      </div>
      </div>

      <aside className="vp-side">
        <SegmentList
          segments={segments}
          allTags={tags}
          videoRef={player.videoRef}
          playbackKey={player.activeId}
          duration={playback.duration || video.duration_secs || 0}
          selectedId={selectedSeg}
          onSelect={setSelectedSeg}
          onSeek={secs => seek(secs)}
          onCreate={handleCreateSegment}
          onUpdate={handleUpdateSegment}
          onDelete={handleDeleteSegment}
          onAddTag={handleAddSegTag}
          onRemoveTag={handleRemoveSegTag}
          playTags={segmentTags}
          onPlayTag={playSegmentsOfTag}
          busy={segBusy}
        />
      </aside>

      {description && <div className="vp-after"><Description key={id} text={description} /></div>}
      </div>

      {dupPrompt && (
        <div className="modal-overlay" onClick={() => setDupPrompt(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Looks similar — keep it anyway?</div>
              <button className="modal-close" onClick={() => setDupPrompt(null)}><Icon name="close" /></button>
            </div>
            <div className="field-hint">
              The fetched thumbnail looks close to one you already have (visual distance {dupPrompt.distance}),
              but YouTube is serving a different file. Compare and decide.
            </div>
            <div className="dup-compare">
              <figure>
                <img src={dupPrompt.current} alt="" />
                <figcaption>Current</figcaption>
              </figure>
              <figure>
                <img src={dupPrompt.preview} alt="" />
                <figcaption>New from YouTube</figcaption>
              </figure>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDupPrompt(null)}>Discard</button>
              <button className="btn-primary" onClick={confirmSaveThumb}>Keep both</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
