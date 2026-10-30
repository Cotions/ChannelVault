import { useEffect, useState } from "react";
import { getChannelIds, setChannelId } from "../lib/api";
import Icon from "./Icon";

const VIA = { userscript: "seen by the userscript", ytdlp: "from Fetch metadata", manual: "pasted by hand" };

/* Whether the Inbox follows this artist's uploads. Following needs the
   channel's YouTube id; the userscript and Fetch metadata usually supply it,
   and this lets the user paste one (or fix a wrong one). */
export default function FeedFollow({ artist }) {
  const [info,    setInfo]    = useState(undefined);   // undefined = loading, null = not linked
  const [editing, setEditing] = useState(false);
  const [text,    setText]    = useState("");
  const [err,     setErr]     = useState(null);
  const [busy,    setBusy]    = useState(false);

  function load(alive = { current: true }) {
    return getChannelIds().then(
      m  => { if (alive.current) setInfo(m?.[artist] || null); },
      () => { if (alive.current) setInfo(null); },
    );
  }

  // Mounted with key={artist}, so a new artist starts from fresh state.
  useEffect(() => {
    const alive = { current: true };
    load(alive);
    return () => { alive.current = false; };
  }, [artist]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function save(value) {
    setBusy(true);
    setErr(null);
    try {
      const r = await setChannelId(artist, value);
      if (r?.ok === false) { setErr(r.error || "Could not save"); return; }
      setEditing(false);
      setText("");
      await load();
    } catch {
      setErr("Could not save — is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  if (info === undefined) return null;

  if (editing) {
    return (
      <form className="feed-follow-form" onSubmit={e => { e.preventDefault(); if (text.trim()) save(text.trim()); }}>
        <input
          className="feed-follow-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") setEditing(false); }}
          placeholder="Channel id (UC…) or youtube.com/channel/UC… link"
          autoFocus
          spellCheck={false}
        />
        <button className="btn-secondary" type="submit" disabled={busy || !text.trim()}>Save</button>
        {info && (
          <button className="btn-ghost" type="button" disabled={busy} onClick={() => save(null)} title="Stop following this channel's uploads">
            Unfollow
          </button>
        )}
        <button className="btn-ghost" type="button" onClick={() => { setEditing(false); setErr(null); }}>Cancel</button>
        {err && <span className="feed-follow-err">{err}</span>}
      </form>
    );
  }

  if (!info) {
    return (
      <button
        className="artist-link-add feed-follow-add"
        onClick={() => { setText(""); setEditing(true); }}
        title="Show this channel's new uploads in the Inbox. Opening one of its videos on YouTube with the userscript does this too."
      >
        <Icon name="inbox" size={12} />Follow uploads
      </button>
    );
  }

  const tip = [
    `Channel ${info.channel_id}`,
    VIA[info.found_via] || null,
    info.check_error ? `Last check failed: ${info.check_error}` : info.checked_at ? `Checked ${info.checked_at} UTC` : "Not checked yet",
    "Click to change",
  ].filter(Boolean).join("\n");

  return (
    <button
      className={`feed-follow-chip${info.check_error ? " is-err" : ""}`}
      onClick={() => { setText(info.channel_id); setEditing(true); }}
      title={tip}
    >
      <span className="feed-follow-dot" />
      {info.check_error ? "Feed check failed" : "Following uploads"}
    </button>
  );
}
