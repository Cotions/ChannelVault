import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { getConfig, getVideos, getWanted, getIgnored, deleteVideo, removeMark } from "./lib/api";
import WatchFolder    from "./components/WatchFolder";
import AddVideoModal  from "./components/AddVideoModal";
import Overview       from "./pages/Overview";
import ArtistPage     from "./pages/ArtistPage";

export default function App() {
  const [online,  setOnline]  = useState(false);
  const [cfg,     setCfg]     = useState({});
  const [showWatchFolder, setShowWatchFolder] = useState(false);
  const [showAddVideo,    setShowAddVideo]    = useState(false);
  const [videos,  setVideos]  = useState([]);
  const [wanted,  setWanted]  = useState([]);
  const [ignored, setIgnored] = useState([]);

  async function load() {
    try {
      const [c, v, w, i] = await Promise.all([
        getConfig(), getVideos(), getWanted(), getIgnored(),
      ]);
      setCfg(c);
      setVideos(v);
      setWanted(w);
      setIgnored(i);
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
        <button className="btn-ghost btn-ghost-add" onClick={() => setShowAddVideo(true)} title="Add video manually">
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
                onRemoveMark={handleRemoveMark}
              />
            }
          />
          <Route
            path="/artist/:name"
            element={<ArtistPage videos={videos} onDelete={handleDelete} />}
          />
        </Routes>
      </main>
    </>
  );
}
