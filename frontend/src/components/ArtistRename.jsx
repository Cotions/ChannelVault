import { useEffect, useState } from "react";
import { getArtistNameInfo, renameArtist, keepArtistName } from "../lib/api";
import Icon from "./Icon";

/* Renaming an artist, by hand (`editing`) or when YouTube shows the channel
   under a new name (the banner). Both go through a dry run first, so the user
   sees how many videos move and whether it merges into an existing artist. */
export default function ArtistRename({ artist, editing, onCloseEdit, onRenamed, onAlias }) {
  const [hint,    setHint]    = useState(null);      // { to, existing } from YouTube
  const [target,  setTarget]  = useState(null);      // name being confirmed
  const [preview, setPreview] = useState(null);      // { videos, merge }
  const [text,    setText]    = useState(artist);
  const [err,     setErr]     = useState(null);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    let alive = true;
    getArtistNameInfo(artist).then(info => {
      if (!alive) return;
      if (info?.alias_of) onAlias?.(info.alias_of);
      else setHint(info?.rename || null);
    }, () => {});
    return () => { alive = false; };
  }, [artist]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(to) {
    to = to.trim();
    setErr(null);
    if (!to || to === artist) { cancel(); return; }
    setBusy(true);
    try {
      const r = await renameArtist(artist, to, true);
      if (r?.ok === false) { setErr(r.error || "Can't rename"); return; }
      setTarget(to);
      setPreview(r);
    } catch {
      setErr("Could not reach the backend");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const r = await renameArtist(artist, target);
      if (r?.ok === false) { setErr(r.error || "Rename failed"); return; }
      onRenamed?.(r.name);
    } catch {
      setErr("Could not reach the backend");
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    setBusy(true);
    try {
      const r = await keepArtistName(artist);
      if (r?.ok !== false) setHint(null);
    } catch { /* banner stays; nothing changed */ }
    setBusy(false);
  }

  function cancel() {
    setTarget(null);
    setPreview(null);
    setErr(null);
    setText(artist);
    onCloseEdit?.();
  }

  if (target && preview) {
    const n = preview.videos;
    return (
      <div className="rename-bar">
        <Icon name="pencil" size={14} />
        <span className="rename-text">
          {preview.merge ? "Merge" : "Rename"} <b>{artist}</b> {preview.merge ? "into" : "to"} <b>{target}</b>:
          {" "}{n} entr{n === 1 ? "y" : "ies"} move{n === 1 ? "s" : ""}
          {preview.merge ? ", plus the profile, links and status where the other has none." : ", with the profile, links and status."}
          {" "}Files on disk stay where they are.
        </span>
        <button className="btn-primary" disabled={busy} onClick={confirm}>{preview.merge ? "Merge" : "Rename"}</button>
        <button className="btn-ghost" disabled={busy} onClick={cancel}>Cancel</button>
        {err && <span className="rename-err">{err}</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <form className="rename-bar" onSubmit={e => { e.preventDefault(); ask(text); }}>
        <Icon name="pencil" size={14} />
        <span className="rename-text">Rename to</span>
        <input
          className="rename-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") cancel(); }}
          autoFocus
          onFocus={e => e.target.select()}
        />
        <button className="btn-secondary" type="submit" disabled={busy || !text.trim() || text.trim() === artist}>Next</button>
        <button className="btn-ghost" type="button" onClick={cancel}>Cancel</button>
        {err && <span className="rename-err">{err}</span>}
      </form>
    );
  }

  if (hint) {
    return (
      <div className="rename-bar is-hint">
        <Icon name="sparkle" size={14} />
        <span className="rename-text">
          YouTube now calls this channel <b>{hint.to}</b>.
          {hint.existing && <> You also have <b>{hint.to}</b> in your library.</>}
        </span>
        <button className="btn-secondary" disabled={busy} onClick={() => ask(hint.to)}>
          {hint.existing ? `Merge into ${hint.to}` : `Rename to ${hint.to}`}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={keep} title="Don't ask again for this name">Keep “{artist}”</button>
        {err && <span className="rename-err">{err}</span>}
      </div>
    );
  }

  return null;
}
