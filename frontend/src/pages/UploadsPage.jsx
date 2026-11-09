import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Icon from "../components/Icon";
import { getArtistUploads } from "../lib/api";
import { goBack } from "../lib/nav";

const ytUrl = id => `https://www.youtube.com/watch?v=${id}`;
const TAB_LABEL = { shorts: "Short", streams: "Live" };
const STATUS_LABEL = { downloaded: "In vault", wanted: "Wanted", ignored: "Ignored" };

/* Every YouTube link the vault has known for an artist, kept for the links:
   channel scans, the feed, the vault's own entries, and entries removed from
   the vault since. A video that gets unlisted or deleted stays, marked gone.
   Nothing on this page is wanted or downloaded by being here. */
export default function UploadsPage({ query }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [goneOnly, setGoneOnly] = useState(false);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    let live = true;
    getArtistUploads(name).then(d => live && setData(d)).catch(() => live && setData({ ok: false }));
    return () => { live = false; };
  }, [name]);

  const q     = (query || "").trim().toLowerCase();
  const all   = data?.uploads || [];
  const gone  = all.filter(u => u.gone_at);
  const shown = (goneOnly ? gone : all).filter(u => !q || (u.title || u.video_id).toLowerCase().includes(q));

  async function copyLinks() {
    try {
      await navigator.clipboard.writeText(shown.map(u => ytUrl(u.video_id)).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: nothing to undo */ }
  }

  return (
    <div className="card">
      <div className="artist-page-header">
        <button className="btn-secondary btn-back" onClick={() => goBack(navigate)}>
          <Icon name="back" size={15} />Back
        </button>
        <h2 className="artist-page-title">
          <Link to={`/artist/${encodeURIComponent(name)}`}>{name}</Link> · All uploads
        </h2>
      </div>

      {data && all.length === 0 ? (
        <div className="empty" style={{ marginTop: 14 }}>
          {data.ok === false
            ? "Couldn't load the list."
            : !data.linked
              ? "This artist isn't linked to a YouTube channel yet. Open their channel on YouTube with the userscript installed and it links itself."
              : "No uploads kept yet. Open the channel's Videos tab on YouTube and press Sync channel to Vault: every video it lists is kept here, with its link, even if it's later unlisted or deleted."}
        </div>
      ) : data && (
        <>
          <div className="grid-toolbar">
            <div className="artist-tabs uploads-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={!goneOnly}
                      className={`artist-tab${!goneOnly ? " is-on" : ""}`} onClick={() => setGoneOnly(false)}>
                All<span className="artist-tab-n">{all.length.toLocaleString()}</span>
              </button>
              <button type="button" role="tab" aria-selected={goneOnly} disabled={!gone.length}
                      className={`artist-tab${goneOnly ? " is-on" : ""}`} onClick={() => setGoneOnly(true)}>
                Gone<span className="artist-tab-n">{gone.length.toLocaleString()}</span>
              </button>
            </div>
            <span className="page-head-spacer" />
            <button className="btn-secondary uploads-copy" onClick={copyLinks} disabled={!shown.length}>
              <Icon name={copied ? "check" : "copy"} size={15} />
              {copied ? "Copied" : shown.length === 1 ? "Copy link" : `Copy ${shown.length.toLocaleString()} links`}
            </button>
          </div>

          {shown.length === 0 && <div className="empty" style={{ marginTop: 14 }}>No uploads match “{query.trim()}”.</div>}
          <ul className="uploads-list">
            {shown.map(u => (
              <li key={u.video_id} className={`uploads-row${u.gone_at ? " is-gone" : ""}`}>
                <a className="uploads-title" href={ytUrl(u.video_id)} target="_blank" rel="noreferrer">
                  {u.title || u.video_id}
                </a>
                {TAB_LABEL[u.tab] && <span className="uploads-tag">{TAB_LABEL[u.tab]}</span>}
                {u.gone_at && <span className="uploads-tag is-gone" title="No longer listed on the channel: unlisted, private or deleted">Gone</span>}
                {u.status === "downloaded"
                  ? <Link className="uploads-tag is-vault" to={`/video/${u.video_id}`}>In vault</Link>
                  : STATUS_LABEL[u.status] && <span className="uploads-tag">{STATUS_LABEL[u.status]}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
