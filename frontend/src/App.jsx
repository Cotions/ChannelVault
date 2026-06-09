import { useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { getConfig, getVideos, getWanted, getIgnored, deleteVideo, removeMark, fetchMetadata, getPlaylists, createPlaylist, deletePlaylist, addToPlaylist } from "./lib/api";
import WatchFolder    from "./components/WatchFolder";
import AddVideoModal  from "./components/AddVideoModal";
import Overview       from "./pages/Overview";
import ArtistPage     from "./pages/ArtistPage";
import PlaylistPage   from "./pages/PlaylistPage";
import VideoPage      from "./pages/VideoPage";
import Stats          from "./pages/Stats";

export default function App() {
  const [online,  setOnline]  = useState(false);
  const [cfg,     setCfg]     = useState({});
  const [showWatchFolder, setShowWatchFolder] = useState(false);
  const [showAddVideo,    setShowAddVideo]    = useState(false);
  const [editVideo,       setEditVideo]       = useState(null);
  const [videos,  setVideos]  = useState([]);
  const [wanted,  setWanted]  = useState([]);
  const [ignored, setIgnored] = useState([]);
  const [playlists, setPlaylists] = useState([]);

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
    if (!r.ok) throw new Error(r.error || "fetch failed");
    setVideos(await getVideos());
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
    <>
      <header>
        <div className={`status-dot ${online ? "online" : ""}`} />
        <h1>ChannelVault</h1>
        <span className="status-label">{online ? "Backend connected" : "Backend offline"}</span>
        <Link to="/stats" className="btn-ghost btn-ghost-add" title="Library stats">
          Stats
        </Link>
        <button className="btn-ghost" onClick={() => setShowAddVideo(true)} title="Add video manually">
          + Add Video
        </button>
        <button
          className="btn-ghost"
          onClick={() => setShowWatchFolder(v => !v)}
          title="Toggle watch folder settings"
        >
          {showWatchFolder ? "▲ Settings" : "▼ Settings"}
        </button>
      </header>

      {showAddVideo && (
        <AddVideoModal onClose={() => setShowAddVideo(false)} onAdded={load} />
      )}
      {editVideo && (
        <AddVideoModal onClose={() => setEditVideo(null)} onAdded={load} initialVideo={editVideo} />
      )}

      <main>
        {showWatchFolder && (
          <WatchFolder initialDir={cfg.watch_directory} initialDataDir={cfg.data_directory} onScanDone={load} />
        )}
        <Routes>
          <Route
            path="/"
            element={
              <Overview
                videos={videos}
                wanted={wanted}
                ignored={ignored}
                playlists={playlists}
                onCreatePlaylist={handleCreatePlaylist}
                onDeletePlaylist={handleDeletePlaylist}
                onAddToPlaylist={handleAddToPlaylist}
                onDelete={handleDelete}
                onEdit={setEditVideo}
                onFetchMeta={handleFetchMeta}
              />
            }
          />
          <Route path="/stats" element={<Stats videos={videos} />} />
          <Route path="/artist/:name/stats" element={<Stats videos={videos} />} />
          <Route
            path="/artist/:name"
            element={<ArtistPage videos={videos} wanted={wanted} ignored={ignored} onDelete={handleDelete} onRemoveMark={handleRemoveMark} onEdit={setEditVideo} onFetchMeta={handleFetchMeta} playlists={playlists} onAddToPlaylist={handleAddToPlaylist} />}
          />
          <Route
            path="/video/:id"
            element={<VideoPage videos={videos} onEdit={setEditVideo} onFetchMeta={handleFetchMeta} onDelete={handleDelete} onWatched={handleWatched} />}
          />
          <Route
            path="/playlist/:id"
            element={<PlaylistPage onEdit={setEditVideo} onFetchMeta={handleFetchMeta} />}
          />
        </Routes>
      </main>
    </>
  );
}
