import { useEffect, useRef, useState } from "react";
import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import { getConfig, getVideos, getVideo, getWanted, getIgnored, deleteVideo, removeMark, fetchMetadata, getPlaylists, createPlaylist, deletePlaylist, addToPlaylist, getTags, getProfiles, shutdownApp, getFeedCount } from "./lib/api";
import Icon            from "./components/Icon";
import CyberBackground from "./components/CyberBackground";
import ScrollManager   from "./components/ScrollManager";
import PlayerProvider  from "./player/PlayerProvider";
import SettingsModal   from "./components/SettingsModal";
import ProfileSwitch   from "./components/ProfileSwitch";
import TagSelect       from "./components/TagSelect";
import AddVideoModal   from "./components/AddVideoModal";
import Overview        from "./pages/Overview";
import Rediscover      from "./components/Rediscover";
import ArtistPage      from "./pages/ArtistPage";
import ArtistsPage     from "./pages/ArtistsPage";
import PlaylistPage    from "./pages/PlaylistPage";
import PlaylistsPage   from "./pages/PlaylistsPage";
import DataQualityPage from "./pages/DataQualityPage";
import VideoPage       from "./pages/VideoPage";
import Stats           from "./pages/Stats";
import UploadsPage     from "./pages/UploadsPage";
import TagsPage        from "./pages/TagsPage";
import TagPage         from "./pages/TagPage";
import InboxPage       from "./pages/InboxPage";
import WantedPage      from "./pages/WantedPage";
import DownloadQueue from "./components/DownloadQueue";
import SideDownloads from "./components/SideDownloads";
import { onDownloadDone } from "./lib/downloads";
import { clearDescriptionHits } from "./lib/descSearch";

// A deleted tag must leave the Home filter too, or the grid filters on an id
// nothing carries.
function dropDeletedTags(ids, tags) {
  const next = ids.filter(id => tags.some(t => t.id === id));
  return next.length === ids.length ? ids : next;
}

function searchScope(path) {
  if (path === "/") return "Search your videos";
  if (path === "/artists") return "Search artists";
  if (path.startsWith("/artist/")) {
    // Sub-pages (/stats, /uploads) belong to the artist; a "/" in a name is encoded.
    let name = path.slice(8).split("/")[0];
    try { name = decodeURIComponent(name); } catch { /* keep it raw */ }
    return path.endsWith("/uploads") ? `Search ${name}'s uploads` : `Search ${name}`;
  }
  if (path === "/tags") return "Search tags";
  if (path.startsWith("/tag/")) return "Search this tag";
  if (path === "/playlists") return "Search playlists";
  if (path.startsWith("/playlist/")) return "Search this playlist";
  if (path === "/inbox") return "Search the inbox";
  if (path === "/wanted-videos") return "Search wanted videos";
  return null;
}

export default function App() {
  const [online,  setOnline]  = useState(null);   // null until the first answer
  const [cfg,     setCfg]     = useState({});
  const [showWatchFolder, setShowWatchFolder] = useState(false);
  const [showAddVideo,    setShowAddVideo]    = useState(false);
  const [editVideo,       setEditVideo]       = useState(null);
  const [videos,  setVideos]  = useState([]);
  const [wanted,  setWanted]  = useState([]);
  const [ignored, setIgnored] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [tags,      setTags]      = useState([]);
  const [profiles,  setProfiles]  = useState([]);
  // The tag filter belongs to the library grid but its control sits in the
  // header next to search, so the selection lives up here.
  const [tagIds,    setTagIds]    = useState([]);
  const [quit,        setQuit]        = useState(false);
  const searchRef = useRef(null);
  const location  = useLocation();
  const navigate  = useNavigate();
  const onLibrary = location.pathname === "/";
  // The header search filters whatever list the page shows, so it says which,
  // and a query belongs to the page it was typed on. Pages with no list send
  // the typing to the library.
  const scope = searchScope(location.pathname);
  const [search, setSearch] = useState({ q: "", path: "/" });
  const query = search.path === location.pathname ? search.q : "";
  // A detail page lights up the section it belongs to (/artist/x under Artists).
  const inTabs = /^\/($|inbox|artists?(\/|$)|tags?(\/|$))/.test(location.pathname) || location.pathname.startsWith("/video/");
  const sectionCls = (base, prefix) => ({ isActive }) =>
    `${base}${isActive || location.pathname.startsWith(prefix) ? " active" : ""}`;
  function setQuery(q) {
    if (scope) { setSearch({ q, path: location.pathname }); return; }
    setSearch({ q, path: "/" });
    navigate("/");
  }
  // Phones get a bottom tab bar; "More" opens the full sidebar as a sheet.
  const [navOpen, setNavOpen] = useState(false);

  // "/" and ⌘/Ctrl-K jump to search from anywhere, Esc drops focus.
  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const hot = e.key === "k" && (e.metaKey || e.ctrlKey);
      if (hot || (e.key === "/" && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape" && e.target === searchRef.current) {
        searchRef.current.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [libVer, setLibVer] = useState(0);

  async function fetchVideos() {
    clearDescriptionHits();          // a reload may follow an edit or a scan
    return getVideos();
  }

  // After an action on one video, that card alone is refetched (with its
  // description) instead of the whole library. One no longer in the library
  // leaves; anything unexpected falls back to the full list.
  async function refreshVideo(id) {
    try {
      const v = await getVideo(id);
      setVideos(prev => prev.some(x => x.video_id === id)
        ? prev.map(x => (x.video_id === id ? v : x))
        : [v, ...prev]);
    } catch (e) {
      if (e.status === 404) setVideos(prev => prev.filter(x => x.video_id !== id));
      else setVideos(await fetchVideos());
    }
  }

  // The list carries no descriptions, and the edit form saves every field it
  // shows: it opens on the video fetched whole, or it would save one blank.
  async function handleEdit(v) {
    try { setEditVideo(await getVideo(v.video_id)); }
    catch { setEditVideo(v.description != null ? v : null); }   // offline: no form, rather than a blanking one
  }

  async function load() {
    try {
      const [c, v, w, i, p, t] = await Promise.all([
        getConfig(), fetchVideos(), getWanted(), getIgnored(), getPlaylists(), getTags(),
      ]);
      setCfg(c);
      setVideos(v);
      setWanted(w);
      setIgnored(i);
      setPlaylists(p);
      setTags(t);
      setTagIds(prev => dropDeletedTags(prev, t));
      loadInboxCount();          // a scan may have filed a video the inbox listed
      setLibVer(n => n + 1);     // pages holding their own lists (tag, playlist) reload on this
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }

  async function loadProfiles() {
    try { setProfiles((await getProfiles()).profiles || []); } catch { /* offline: load() reports it */ }
  }

  useEffect(() => { load(); loadProfiles(); }, []);
  // A download that lands in the library shows up without a reload.
  useEffect(() => onDownloadDone(() => { load(); loadInboxCount(); }), []);   // eslint-disable-line react-hooks/exhaustive-deps

  // New uploads waiting in the inbox. The poller runs on the server; checking
  // its count now and then keeps the sidebar badge current.
  const [inboxCount, setInboxCount] = useState(0);
  async function loadInboxCount() {
    try { setInboxCount((await getFeedCount()).count || 0); } catch { /* offline: load() reports it */ }
  }
  useEffect(() => {
    const t = setInterval(loadInboxCount, 5 * 60 * 1000);   // load() asks once at mount
    return () => clearInterval(t);
  }, []);

  // Want or Ignore in the inbox adds an entry the artist pages and Stats list.
  async function handleInboxMarked(kind) {
    loadInboxCount();
    if (kind === "count") return;
    const [w, i] = await Promise.all([getWanted(), getIgnored()]);
    setWanted(w);
    setIgnored(i);
  }

  async function handleDelete(id) {
    const r = await deleteVideo(id);
    if (r && r.ok === false) throw new Error(r.error || "delete failed");   // keep it on screen
    setVideos(prev => prev.filter(v => v.video_id !== id));
    window.dispatchEvent(new CustomEvent("cv:video-deleted", { detail: id }));
  }

  async function handleFetchMeta(id) {
    const r = await fetchMetadata(id);
    clearDescriptionHits();          // the fetch may have brought a new description
    await refreshVideo(id);
    // A detected private/deleted video returns ok:false WITH availability — not a
    // transient error, so refresh (to show the badge) but don't surface a failure.
    if (!r.ok && !r.availability) throw new Error(r.error || "fetch failed");
  }

  // Its watch count went up: refresh that card alone.
  async function handleWatched(id) {
    if (id) await refreshVideo(id);
    else setVideos(await fetchVideos());
  }

  // Tag or segment edits change what the cards show, so refetch that video
  // (or the whole library, when the change was not to one video) and the tags.
  async function handleTagsChanged(id) {
    const [, t] = await Promise.all([
      id ? refreshVideo(id) : fetchVideos().then(setVideos),
      getTags(),
    ]);
    setTags(t);
    setTagIds(prev => dropDeletedTags(prev, t));
  }

  async function handleCreatePlaylist(name) {
    const r = await createPlaylist(name);
    if (!r.ok) throw new Error(r.error || "create failed");
    setPlaylists(await getPlaylists());
  }

  async function handleDeletePlaylist(id) {
    const r = await deletePlaylist(id);
    if (r && r.ok === false) throw new Error(r.error || "delete failed");
    setPlaylists(prev => prev.filter(p => p.id !== id));
  }

  // No id: make the playlist first (named from a card or video menu), then add.
  async function handleAddToPlaylist(playlistId, videoId, newName) {
    if (playlistId == null) {
      const c = await createPlaylist(newName);
      if (!c.ok) throw new Error(c.error || "create failed");
      playlistId = c.id;
    }
    const r = await addToPlaylist(playlistId, videoId);
    if (!r.ok) throw new Error(r.error || "add failed");
    setPlaylists(await getPlaylists());
    return r;
  }

  // The backend exits right after answering, so the response may never land.
  // Either way the app is going down: show the farewell screen regardless.
  async function handleQuit() {
    setQuit(true);
    setOnline(false);
    try { await shutdownApp(); } catch { /* connection dropped as it exited */ }
  }

  async function handleRemoveMark(id) {
    await removeMark(id);
    const [w, i] = await Promise.all([getWanted(), getIgnored()]);
    setWanted(w);
    setIgnored(i);
  }

  if (quit) {
    return (
      <div className="quit-screen">
        <span className="quit-mark"><Icon name="vault" size={26} /></span>
        <h2>ChannelVault closed</h2>
        <p>The backend has stopped. Close this tab, and start the app again when you need it.</p>
      </div>
    );
  }

  return (
    <PlayerProvider onCompleted={handleWatched}>
      <CyberBackground />
      <ScrollManager />
      <header>
        <div className="brand">
          <span className="brand-mark"><Icon name="vault" size={17} /></span>
          <h1>ChannelVault</h1>
        </div>
        <div className="header-center">
        <div className="header-search-wrap">
          <Icon name="search" size={15} className="header-search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="header-search"
            placeholder={scope || "Search your videos"}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery("")} title="Clear search">
              <Icon name="close" size={14} />
            </button>
          ) : (
            <kbd className="search-kbd">/</kbd>
          )}
        </div>
        {onLibrary && (
          <TagSelect
            tags={tags}
            selected={tagIds}
            onToggle={id => setTagIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])}
            onClear={() => setTagIds([])}
          />
        )}
        </div>
        <div className="header-right">
          <button className="btn-secondary header-add" onClick={() => setShowAddVideo(true)} title="Add a video by its link or file">
            <Icon name="plus" size={15} />Add video
          </button>
          <DownloadQueue />
          <ProfileSwitch profiles={profiles} onManage={() => setShowWatchFolder("profiles")} />
          <span
            className={`status-dot ${online ? "online" : ""}`}
            title={online ? "Backend connected" : online === null ? "Connecting…" : "Backend offline"}
          />
        </div>
      </header>

      {showWatchFolder && (
        <SettingsModal
          onClose={() => setShowWatchFolder(false)}
          initialDir={cfg.watch_directory}
          initialDataDir={cfg.data_directory}
          initialRoots={cfg.media_roots}
          onScanDone={load}
          onProfilesChanged={loadProfiles}
          rating={cfg.rating}
          onRatingSaved={r => setCfg(c => ({ ...c, rating: r }))}
          initialTab={showWatchFolder === "profiles" ? "profiles" : "library"}
          onQuit={handleQuit}
        />
      )}
      {showAddVideo && (
        <AddVideoModal onClose={() => setShowAddVideo(false)} onAdded={load} />
      )}
      {editVideo && (
        <AddVideoModal onClose={() => setEditVideo(null)} onAdded={load} initialVideo={editVideo} />
      )}

      <div className="app-body">
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
        <nav className={`sidebar${navOpen ? " is-open" : ""}`} onClick={e => { if (e.target.closest("a")) setNavOpen(false); }}>
          <NavLink to="/" end className="side-link side-dup"><Icon name="home" />Home</NavLink>
          <NavLink to="/inbox" className="side-link side-dup">
            <Icon name="inbox" />Inbox
            {inboxCount > 0 && <span className="side-badge" title="New uploads from channels you follow">{inboxCount > 99 ? "99+" : inboxCount}</span>}
          </NavLink>
          <NavLink to="/rediscover" className="side-link"><Icon name="sparkle" />Rediscover</NavLink>
          <div className="side-sep side-dup" />
          <NavLink to="/artists" className={sectionCls("side-link side-dup", "/artist/")}><Icon name="users" />Artists</NavLink>
          <NavLink to="/tags" className={sectionCls("side-link side-dup", "/tag/")}><Icon name="tag" />Tags</NavLink>
          <NavLink to="/playlists" className={sectionCls("side-link", "/playlist/")}><Icon name="playlist" />Playlists</NavLink>
          <NavLink to="/wanted-videos" className="side-link">
            <Icon name="download" />Wanted
            {wanted.length > 0 && <span className="side-badge side-badge-quiet" title="Videos marked to download">{wanted.length > 999 ? "999+" : wanted.length}</span>}
          </NavLink>
          <div className="side-sep" />
          <button className="side-link side-phone" onClick={() => { setNavOpen(false); setShowAddVideo(true); }}><Icon name="plus" />Add video</button>
          <NavLink to="/stats" className="side-link"><Icon name="chart" />Stats</NavLink>
          <NavLink to="/data-quality" className="side-link"><Icon name="pulse" />Library check</NavLink>
          <button className="side-link" onClick={() => setShowWatchFolder(true)}><Icon name="settings" />Settings</button>
          <SideDownloads />
        </nav>

        <nav className="tabbar" aria-label="Main" onClick={e => { if (e.target.closest("a")) setNavOpen(false); }}>
          <NavLink to="/" end className="tab-link"><Icon name="home" size={20} /><span>Home</span></NavLink>
          <NavLink to="/inbox" className="tab-link">
            <Icon name="inbox" size={20} /><span>Inbox</span>
            {inboxCount > 0 && <span className="tab-badge">{inboxCount > 99 ? "99+" : inboxCount}</span>}
          </NavLink>
          <NavLink to="/artists" className={sectionCls("tab-link", "/artist/")}><Icon name="users" size={20} /><span>Artists</span></NavLink>
          <NavLink to="/tags" className={sectionCls("tab-link", "/tag/")}><Icon name="tag" size={20} /><span>Tags</span></NavLink>
          <button className={`tab-link${navOpen || !inTabs ? " active" : ""}`} onClick={() => setNavOpen(o => !o)} aria-expanded={navOpen}>
            <Icon name="more" size={20} /><span>More</span>
          </button>
        </nav>

        <main>
          <Routes>
            <Route
              path="/"
              element={
                <Overview
                  videos={videos}
                  playlists={playlists}
                  tags={tags}
                  tagIds={tagIds}
                  onTagIds={setTagIds}
                  query={query}
                  onAddToPlaylist={handleAddToPlaylist}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onFetchMeta={handleFetchMeta}
                  loading={libVer === 0}
                />
              }
            />
            <Route
              path="/rediscover"
              element={
                <Rediscover
                  videos={videos}
                  cardProps={{ onDelete: handleDelete, onEdit: handleEdit, onFetchMeta: handleFetchMeta, playlists, onAddToPlaylist: handleAddToPlaylist }}
                />
              }
            />
            <Route
              path="/playlists"
              element={<PlaylistsPage playlists={playlists} query={query} onCreatePlaylist={handleCreatePlaylist} onDeletePlaylist={handleDeletePlaylist} />}
            />
            <Route
              path="/artists"
              element={<ArtistsPage videos={videos} wanted={wanted} ignored={ignored} query={query} rating={cfg.rating} />}
            />
            <Route path="/wanted-videos" element={<WantedPage wanted={wanted} ignored={ignored} query={query} onRemoveMark={handleRemoveMark} />} />
            <Route path="/inbox" element={<InboxPage query={query} onMarked={handleInboxMarked} />} />
            <Route path="/data-quality" element={<DataQualityPage onLibraryChanged={load} />} />
            <Route path="/tags" element={<TagsPage tags={tags} query={query} onChanged={handleTagsChanged} />} />
            <Route
              path="/tag/:id"
              element={<TagPage libraryVersion={libVer} query={query} onEdit={handleEdit} onFetchMeta={handleFetchMeta} onDelete={handleDelete} playlists={playlists} onAddToPlaylist={handleAddToPlaylist} />}
            />
            <Route path="/stats" element={<Stats videos={videos} wanted={wanted} ignored={ignored} />} />
            <Route path="/artist/:name/stats" element={<Stats videos={videos} />} />
            <Route path="/artist/:name/uploads" element={<UploadsPage query={query} />} />
            <Route
              path="/artist/:name"
              element={<ArtistPage videos={videos} wanted={wanted} ignored={ignored} query={query} rating={cfg.rating} onDelete={handleDelete} onRemoveMark={handleRemoveMark} onEdit={handleEdit} onFetchMeta={handleFetchMeta} playlists={playlists} onAddToPlaylist={handleAddToPlaylist} onScanDone={load} />}
            />
            <Route
              path="/video/:id"
              element={<VideoPage videos={videos} tags={tags} onTagsChanged={handleTagsChanged} onEdit={handleEdit} onFetchMeta={handleFetchMeta} onDelete={handleDelete} playlists={playlists} onAddToPlaylist={handleAddToPlaylist} />}
            />
            <Route
              path="/playlist/:id"
              element={<PlaylistPage libraryVersion={libVer} query={query} onEdit={handleEdit} onFetchMeta={handleFetchMeta} onPlaylistsChanged={async () => setPlaylists(await getPlaylists())} />}
            />
          </Routes>
        </main>
      </div>
    </PlayerProvider>
  );
}
