import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getFeed, checkFeed, saveFeedSettings, markWanted, markIgnored, dismissFeedItem, setChannelId } from "../lib/api";
import Icon from "../components/Icon";
import DownloadButton from "../components/DownloadButton";

const INTERVALS = [1, 3, 6, 12, 24, 48, 168];

// checked_at is SQLite's CURRENT_TIMESTAMP (UTC, no zone); published_at is ISO.
function toDate(ts) {
  if (!ts) return null;
  const d = new Date(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
  return isNaN(d) ? null : d;
}

function ago(ts) {
  const d = toDate(ts);
  if (!d) return "never";
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 60)     return "just now";
  if (s < 3600)   return `${Math.floor(s / 60)} min ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString();
}

// Case- and accent-insensitive, so "asmr" finds "ASMR" and "e" finds "é".
function fold(s) {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function watchUrl(it) {
  return it.is_short ? `https://www.youtube.com/shorts/${it.video_id}` : `https://www.youtube.com/watch?v=${it.video_id}`;
}

export default function InboxPage({ query, onMarked }) {
  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [busy,      setBusy]      = useState({});       // video_id -> true while marking
  const [copied,    setCopied]    = useState(null);
  const [failed,    setFailed]    = useState(null);     // { id, msg } of the last refused mark
  const [removed,   setRemoved]   = useState(null);     // the last upload taken out, for Undo
  const [nameQuery, setNameQuery] = useState("");       // filter for the not-followed list
  const [followOpen,  setFollowOpen]  = useState(false);  // the Followed list, opened by its stat too
  const [followQuery, setFollowQuery] = useState("");
  const [unfollowing, setUnfollowing] = useState(null);   // channel name while it's being unfollowed

  function load() {
    return getFeed().then(d => { setData(d); setError(false); }, () => setError(true));
  }

  useEffect(() => { load(); }, []);

  // A check runs in the background on the server: follow it until it ends.
  const checking = !!data?.checking;
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [checking]);
  useEffect(() => { if (data && !checking) onMarked?.("count"); }, [checking]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCheck() {
    await checkFeed().catch(() => {});
    setData(d => d && { ...d, checking: true });
  }

  async function handleSetting(opts) {
    const r = await saveFeedSettings(opts).catch(() => null);
    if (r?.ok) {
      setData(d => d && {
        ...d,
        enabled:        r.feed_enabled,
        interval_hours: r.feed_interval_hours,
        shorts:         r.feed_shorts,
      });
      onMarked?.("count");
    }
  }

  async function handleMark(it, kind) {
    setBusy(b => ({ ...b, [it.video_id]: true }));
    setFailed(null);
    const body = { video_id: it.video_id, title: it.title, channel_name: it.channel_name, url: watchUrl(it) };
    const r = await (kind === "want" ? markWanted(body) : markIgnored(body)).catch(() => null);
    setBusy(b => { const n = { ...b }; delete n[it.video_id]; return n; });
    if (!r?.ok) {
      setFailed({ id: it.video_id, msg: r?.error || "Could not save — is the backend running?" });
      return;
    }
    setData(d => ({ ...d, items: d.items.filter(x => x.video_id !== it.video_id) }));
    onMarked?.(kind);
  }

  // Out of the inbox and nothing else: not wanted, not ignored, just gone.
  async function handleRemove(it) {
    setFailed(null);
    setData(d => ({ ...d, items: d.items.filter(x => x.video_id !== it.video_id) }));
    const r = await dismissFeedItem(it.video_id).catch(() => null);
    if (!r?.ok) {
      setFailed({ id: it.video_id, msg: r?.error || "Could not remove it — is the backend running?" });
      load();
      return;
    }
    setRemoved(it);
    onMarked?.("count");
  }

  async function handleUndo() {
    const it = removed;
    setRemoved(null);
    if (!it) return;
    await dismissFeedItem(it.video_id, false).catch(() => {});
    await load();
    onMarked?.("count");
  }

  function showFollowed() {
    setFollowOpen(true);
    requestAnimationFrame(() => document.getElementById("inbox-followed")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // Stops checking the channel; the id stays known, so following again from
  // the artist page is one click.
  async function handleUnfollow(name) {
    setUnfollowing(name);
    await setChannelId(name, null).catch(() => {});
    await load();
    setUnfollowing(null);
    onMarked?.("count");
  }

  async function handleCopy(it) {
    try {
      await navigator.clipboard.writeText(watchUrl(it));
      setCopied(it.video_id);
      setTimeout(() => setCopied(c => (c === it.video_id ? null : c)), 1500);
    } catch { /* clipboard refused: the link is still one click away */ }
  }

  const items = data?.items || [];
  const q = query.trim().toLowerCase();
  const pool  = items.filter(it => data.shorts || !it.is_short);
  const fresh   = pool.filter(it => !it.backlog);
  const older   = pool.length - fresh.length;
  const shown   = (showOlder ? pool : fresh).filter(it =>
    !q || (it.title || "").toLowerCase().includes(q) || (it.channel_name || "").toLowerCase().includes(q));
  const hiddenShorts = items.filter(it => it.is_short && (showOlder || !it.backlog)).length;

  if (error && !data) {
    return <div className="card"><div className="msg show err">Could not load the inbox — is the backend running?</div></div>;
  }
  if (!data) return <div className="card"><div className="empty">Loading…</div></div>;

  const followed = data.followed || [];
  const linked = followed.length;
  const fq = fold(followQuery.trim());
  const shownFollowed = fq ? followed.filter(f => fold(f.channel_name).includes(fq)) : followed;
  const newBy = {};
  for (const it of items) if (!it.backlog && (data.shorts || !it.is_short)) newBy[it.channel_name] = (newBy[it.channel_name] || 0) + 1;
  const nq = fold(nameQuery.trim());
  const shownUnlinked = nq ? data.unlinked.filter(n => fold(n).includes(nq)) : data.unlinked;
  const stats = [
    { num: fresh.length.toLocaleString(), label: "new uploads" },
    { num: `${linked}/${data.artists}`,   label: "channels followed", onClick: linked ? showFollowed : null,
      title: "Show who you follow" },
    { num: checking ? "…" : ago(data.last_checked), label: "last checked", small: true },
  ];

  return (
    <div className="inbox-page">
      <div className="card">
        <div className="page-head">
          <h2 className="page-title">Inbox</h2>
          <span className="page-count">{shown.length.toLocaleString()}</span>
          <div className="page-head-spacer" />
          <button className="btn-secondary inbox-check" onClick={handleCheck} disabled={checking}>
            <Icon name="refresh" size={14} className={checking ? "spin" : undefined} />
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>

        <div className="stats-hero is-compact inbox-hero">
          {stats.map((s, i) => (
            <div key={s.label} className={`stats-hero-cell${s.onClick ? " is-link" : ""}`} style={{ animationDelay: `${i * 60}ms` }}
                 onClick={s.onClick || undefined} title={s.onClick ? s.title : undefined}
                 role={s.onClick ? "button" : undefined} tabIndex={s.onClick ? 0 : undefined}
                 onKeyDown={s.onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.onClick(); } } : undefined}>
              <span className={`stats-hero-num${s.small ? " inbox-hero-small" : ""}`}>{s.num}</span>
              <span className="stats-hero-label">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="inbox-controls">
          <label className="inbox-toggle">
            <input type="checkbox" checked={showOlder} onChange={e => setShowOlder(e.target.checked)} />
            Show older uploads{older ? ` (${older.toLocaleString()})` : ""}
          </label>
          <label className="inbox-toggle">
            <input type="checkbox" checked={!!data.shorts} onChange={e => handleSetting({ feed_shorts: e.target.checked })} />
            Show Shorts{!data.shorts && hiddenShorts ? ` (${hiddenShorts.toLocaleString()})` : ""}
          </label>
          <span className="inbox-controls-spacer" />
          <label className="inbox-toggle">
            <input type="checkbox" checked={!!data.enabled} onChange={e => handleSetting({ feed_enabled: e.target.checked })} />
            Check automatically every
          </label>
          <select
            className="inbox-interval"
            value={data.interval_hours}
            disabled={!data.enabled}
            onChange={e => handleSetting({ feed_interval_hours: Number(e.target.value) })}
          >
            {[...new Set([...INTERVALS, data.interval_hours])].sort((a, b) => a - b).map(h => (
              <option key={h} value={h}>{h === 168 ? "week" : h >= 24 && h % 24 === 0 ? `${h / 24} d` : `${h} h`}</option>
            ))}
          </select>
        </div>

        {failed && <div className="msg show err">{failed.msg}</div>}
        {removed && (
          <div className="inbox-removed">
            <span>Removed <b>{removed.title || removed.video_id}</b> from the inbox.</span>
            <button className="btn-ghost" onClick={handleUndo}>Undo</button>
            <button className="inbox-removed-x" title="Dismiss" onClick={() => setRemoved(null)}><Icon name="close" size={12} /></button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="empty" style={{ marginTop: 14 }}>
            {q ? "No matching uploads."
              : linked === 0 ? "No channels followed yet. Follow one from its artist page."
              : checking ? "Checking your channels…"
              : older && !showOlder ? "Nothing new since the last check. Older uploads you never saved are under “Show older uploads”."
              : "Nothing new since the last check."}
          </div>
        ) : (
          <div className="inbox-grid">
            {shown.map((it, i) => (
              <div key={it.video_id} className="inbox-item" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                <a className="inbox-thumb" href={watchUrl(it)} target="_blank" rel="noreferrer" title="Open on YouTube">
                  <img
                    src={`https://i.ytimg.com/vi/${it.video_id}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  {it.is_short ? <span className="inbox-tag">Short</span> : null}
                  {it.backlog ? <span className="inbox-tag inbox-tag-old">Older</span> : null}
                </a>
                <button className="inbox-remove" onClick={() => handleRemove(it)}
                        title="Remove from the inbox. It isn't marked anywhere: not wanted, not ignored">
                  <Icon name="close" size={14} />
                </button>
                <div className="inbox-meta">
                  <a className="inbox-title" href={watchUrl(it)} target="_blank" rel="noreferrer">{it.title || it.video_id}</a>
                  <div className="inbox-sub">
                    <Link to={`/artist/${encodeURIComponent(it.channel_name)}`}>{it.channel_name}</Link>
                    <span className="inbox-dot">·</span>
                    <span title={toDate(it.published_at)?.toLocaleString()}>{ago(it.published_at)}</span>
                  </div>
                  <div className="inbox-actions">
                    <button className="btn-secondary inbox-want" disabled={busy[it.video_id]} onClick={() => handleMark(it, "want")} title="Add to your wanted list">
                      <Icon name="download" size={13} />Want
                    </button>
                    <DownloadButton video={it} />
                    <button className="btn-ghost" disabled={busy[it.video_id]} onClick={() => handleMark(it, "skip")} title="Not for me: it leaves the inbox, goes on your Ignored list, and YouTube shows it as Ignored">
                      <Icon name="dislike" size={13} />Ignore
                    </button>
                    <button className="btn-ghost" onClick={() => handleCopy(it)} title="Copy the video link (for your downloader)">
                      <Icon name={copied === it.video_id ? "check" : "copy"} size={13} />{copied === it.video_id ? "Copied" : "Copy link"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(followed.length > 0 || data.unlinked.length > 0 || data.errors.length > 0) && (
        <div className="card inbox-footer">
          {followed.length > 0 && (
            <details id="inbox-followed" open={followOpen} onToggle={e => setFollowOpen(e.currentTarget.open)}>
              <summary>
                {followed.length.toLocaleString()} channel{followed.length !== 1 ? "s" : ""} followed
              </summary>
              <p className="inbox-help">
                These channels are checked for new uploads{data.enabled ? ` every ${data.interval_hours === 168 ? "week" : data.interval_hours % 24 === 0 ? `${data.interval_hours / 24} d` : `${data.interval_hours} h`}` : " when you press Check now"}.
                Unfollowing keeps the channel id, so following again from the artist page is one click.
              </p>
              {followed.length > 12 && (
                <div className="inbox-names-search">
                  <Icon name="search" size={13} />
                  <input
                    type="search"
                    value={followQuery}
                    onChange={e => setFollowQuery(e.target.value)}
                    placeholder="Filter channels…"
                    aria-label="Filter followed channels"
                  />
                  {followQuery && <span className="inbox-names-count">{shownFollowed.length} of {followed.length}</span>}
                </div>
              )}
              <div className="inbox-followed">
                {shownFollowed.map(f => (
                  <div key={f.channel_name} className="inbox-follow-row">
                    <Link className="inbox-follow-name" to={`/artist/${encodeURIComponent(f.channel_name)}`}>{f.channel_name}</Link>
                    {newBy[f.channel_name] ? <span className="inbox-follow-new">{newBy[f.channel_name]} new</span> : null}
                    <span className={`inbox-follow-checked${f.check_error ? " is-bad" : ""}`}
                          title={f.check_error || (f.checked_at ? toDate(f.checked_at)?.toLocaleString() : "Not checked yet")}>
                      {f.check_error ? <><Icon name="warn" size={12} />check failed</> : f.checked_at ? `checked ${ago(f.checked_at)}` : "not checked yet"}
                    </span>
                    <button className="btn-ghost inbox-unfollow" disabled={unfollowing === f.channel_name}
                            onClick={() => handleUnfollow(f.channel_name)} title={`Stop checking ${f.channel_name} for new uploads`}>
                      {unfollowing === f.channel_name ? "…" : "Unfollow"}
                    </button>
                  </div>
                ))}
                {shownFollowed.length === 0 && <span className="inbox-help">No channel matches “{followQuery}”.</span>}
              </div>
            </details>
          )}
          {data.unlinked.length > 0 && (
            <details>
              <summary>
                {data.unlinked.length.toLocaleString()} channel{data.unlinked.length !== 1 ? "s" : ""} not followed yet
              </summary>
              <p className="inbox-help">
                Only channels you follow are checked: use “Follow uploads” on the artist page. Following
                needs the channel's YouTube id, and ChannelVault never looks it up on its own. It learns it
                when you open one of the channel's videos or its page on YouTube with the userscript
                installed, or when you use “Fetch metadata” on one of its videos; then following is one
                click. You can also paste the id there.
              </p>
              <div className="inbox-names-search">
                <Icon name="search" size={13} />
                <input
                  type="search"
                  value={nameQuery}
                  onChange={e => setNameQuery(e.target.value)}
                  placeholder="Filter channels…"
                  aria-label="Filter channels not followed yet"
                />
                {nameQuery && <span className="inbox-names-count">{shownUnlinked.length} of {data.unlinked.length}</span>}
              </div>
              <div className="inbox-names">
                {shownUnlinked.map(n => (
                  <Link key={n} className="inbox-name" to={`/artist/${encodeURIComponent(n)}`}>{n}</Link>
                ))}
                {shownUnlinked.length === 0 && <span className="inbox-help">No channel matches “{nameQuery}”.</span>}
              </div>
            </details>
          )}
          {data.errors.length > 0 && (
            <details>
              <summary>{data.errors.length} channel{data.errors.length !== 1 ? "s" : ""} failed the last check</summary>
              <ul className="inbox-errors">
                {data.errors.map(e => (
                  <li key={e.channel_name}>
                    <Link to={`/artist/${encodeURIComponent(e.channel_name)}`}>{e.channel_name}</Link>: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
