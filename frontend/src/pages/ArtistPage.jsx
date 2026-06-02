import { useParams, useNavigate } from "react-router-dom";
import VideoCard from "../components/VideoCard";

export default function ArtistPage({ videos, onDelete }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const artist   = decodeURIComponent(name);

  const artistVideos = videos.filter(v => (v.channel_name || "Unknown") === artist);

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => navigate(-1)}>← Back</button>
        <h2 className="artist-page-title">{artist}</h2>
        <span className="artist-badge">{artistVideos.length} video{artistVideos.length !== 1 ? "s" : ""}</span>
      </div>

      {artistVideos.length === 0 ? (
        <div className="empty">No videos found for this artist.</div>
      ) : (
        <div className="video-grid">
          {artistVideos.map(v => (
            <VideoCard key={v.video_id} video={v} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
