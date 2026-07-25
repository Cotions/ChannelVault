import { useEffect, useRef, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { getConfig, getVideos, getWanted, getIgnored, deleteVideo, removeMark, fetchMetadata, getPlaylists, createPlaylist, deletePlaylist, addToPlaylist } from "./lib/api";
import Icon            from "./components/Icon";
import ScrollManager   from "./components/ScrollManager";
import PlayerProvider  from "./player/PlayerProvider";
import SettingsModal   from "./components/SettingsModal";
import AddVideoModal   from "./components/AddVideoModal";
import Overview        from "./pages/Overview";
import ArtistPage      from "./pages/ArtistPage";
import ArtistsPage     from "./pages/ArtistsPage";
import PlaylistPage    from "./pages/PlaylistPage";
import PlaylistsPage   from "./pages/PlaylistsPage";
import DataQualityPage from "./pages/DataQualityPage";
import VideoPage       from "./pages/VideoPage";
import Stats           from "./pages/Stats";

export default function App() {
  const [online,  setOnline]  = useState(false);
  const [cfg,     setCfg]     = useState({});
  const [showWatchFolder, setShowWatchFolder] = useState(false);
  const [showAddVideo,    setShowAddVideo]    = useState(false);
  const [editVideo,       setEditVideo]       = useState(null);
  const [query,   setQuery]   = useState("");
  const [videos,  setVideos]  = useState([]);
  const [wanted,  setWanted]  = useState([]);
  const [ignored, setIgnored] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const searchRef = useRef(null);

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

  async function load() {
    try {
      const [c, v, w, i, p] = await Promise.all([
        getConfig(), getVideos(), getWanted(), getIgnored(), getPlaylists(),
      ]);
      setCfg(c);
      setVideos(v);
      setWanted(w);
      setIgnored(i);
      setPlaylists(p);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id) {
    await deleteVideo(id);
    setVideos(prev => prev.filter(v => v.video_id !== id));
  }

  async function handleFetchMeta(id) {
    const r = await fetchMetadata(id);
    setVideos(await getVideos());
    // A detected private/deleted video returns ok:false WITH availability — not a
    // transient error, so refresh (to show the badge) but don't surface a failure.
    if (!r.ok && !r.availability) throw new Error(r.error || "fetch failed");
  }

  async function handleWatched() {
    setVideos(await getVideos());
  }

  async function handleCreatePlaylist(name) {
    const r = await createPlaylist(name);
    if (!r.ok) throw new Error(r.error || "create failed");
    setPlaylists(await getPlaylists());
  }

  async function handleDeletePlaylist(id) {
    await deletePlaylist(id);
    setPlaylists(prev => prev.filter(p => p.id !== id));
  }

  async function handleAddToPlaylist(playlistId, videoId) {
    const r = await addToPlaylist(playlistId, videoId);
    if (!r.ok) throw new Error(r.error || "add failed");
    setPlaylists(await getPlaylists());
  }

  async function handleRemoveMark(id) {
    await removeMark(id);
    const [w, i] = await Promise.all([getWanted(), getIgnored()]);
    setWanted(w);
    setIgnored(i);
  }

  return (
    <PlayerProvider onCompleted={handleWatched}>
      <ScrollManager />
      <header>
        <div className="brand">
          <span className="brand-mark"><Icon name="vault" size={17} /></span>
          <h1>ChannelVault</h1>
        </div>
        <div className="header-search-wrap">
          <Icon name="search" size={15} className="header-search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="header-search"
            placeholder="Search title, channel, description…"
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
        <div className="header-right">
          <span className="header-count" title="Videos in vault">{videos.length.toLocaleString()}</span>
          <span
            className={`status-dot ${online ? "online" : ""}`}
            title={online ? "Backend connected" : "Backend offline"}
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
        />
      )}
      {showAddVideo && (
        <AddVideoModal onClose={() => setShowAddVideo(false)} onAdded={load} />
      )}
      {editVideo && (
        <AddVideoModal onClose={() => setEditVideo(null)} onAdded={load} initialVideo={editVideo} />
      )}

      <div className="app-body">
        <nav className="sidebar">
          <NavLink to="/" end className="side-link"><Icon name="home" />Home</NavLink>
          <NavLink to="/playlists" className="side-link"><Icon name="playlist" />Playlists</NavLink>
          <NavLink to="/artists" className="side-link"><Icon name="users" />Artists</NavLink>
          <NavLink to="/data-quality" className="side-link"><Icon name="pulse" />Data Quality</NavLink>
          <NavLink to="/stats" className="side-link"><Icon name="chart" />Stats</NavLink>
          <div className="side-sep" />
          <button className="side-link" onClick={() => setShowAddVideo(true)}><Icon name="plus" />Add Video</button>
          <button className="side-link" onClick={() => setShowWatchFolder(true)}><Icon name="settings" />Settings</button>
        </nav>

        <main>
          <Routes>
            <Route
              path="/"
              element={
                <Overview
                  videos={videos}
                  playlists={playlists}
                  query={query}
                  onAddToPlaylist={handleAddToPlaylist}
                  onDelete={handleDelete}
                  onEdit={setEditVideo}
                  onFetchMeta={handleFetchMeta}
                />
              }
            />
            <Route
              path="/playlists"
              element={<PlaylistsPage playlists={playlists} query={query} onCreatePlaylist={handleCreatePlaylist} onDeletePlaylist={handleDeletePlaylist} />}
            />
            <Route
              path="/artists"
              element={<ArtistsPage videos={videos} wanted={wanted} ignored={ignored} query={query} />}
            />
            <Route path="/data-quality" element={<DataQualityPage />} />
            <Route path="/stats" element={<Stats videos={videos} wanted={wanted} ignored={ignored} />} />
            <Route path="/artist/:name/stats" element={<Stats videos={videos} />} />
            <Route
              path="/artist/:name"
              element={<ArtistPage videos={videos} wanted={wanted} ignored={ignored} query={query} onDelete={handleDelete} onRemoveMark={handleRemoveMark} onEdit={setEditVideo} onFetchMeta={handleFetchMeta} playlists={playlists} onAddToPlaylist={handleAddToPlaylist} />}
            />
            <Route
              path="/video/:id"
              element={<VideoPage videos={videos} onEdit={setEditVideo} onFetchMeta={handleFetchMeta} onDelete={handleDelete} onWatched={handleWatched} />}
            />
            <Route
              path="/playlist/:id"
              element={<PlaylistPage query={query} onEdit={setEditVideo} onFetchMeta={handleFetchMeta} />}
            />
          </Routes>
        </main>
      </div>
    </PlayerProvider>
  );
}
