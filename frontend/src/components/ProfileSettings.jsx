import { useEffect, useState } from "react";
import { getProfiles, createProfile, renameProfile, deleteProfile, browse, browseData } from "../lib/api";
import { switchProfile } from "./ProfileSwitch";
import Icon from "./Icon";

const EMPTY = { name: "", watch_directory: "", data_directory: "" };

/* Profiles are separate libraries. Each one has its own watch folder, media
   roots and data directory, so its videos, tags, playlists and stats never
   show up in another. Removing a profile only forgets it: nothing on disk is
   deleted, and adding it back with the same data directory brings it all back. */
export default function ProfileSettings({ onChanged }) {
  const [profiles, setProfiles] = useState([]);
  const [form,     setForm]     = useState(EMPTY);
  const [editing,  setEditing]  = useState(null);   // { id, name }
  const [removing, setRemoving] = useState(null);
  const [msg,      setMsg]      = useState(null);

  async function reload() {
    try {
      const r = await getProfiles();
      setProfiles(r.profiles || []);
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  useEffect(() => { reload(); }, []);

  function flash(text, type) {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  async function pickFolder(field, picker) {
    try {
      const r = await picker();
      if (r.ok && r.directory) setForm(f => ({ ...f, [field]: r.directory }));
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleCreate() {
    try {
      const r = await createProfile({
        name:            form.name.trim(),
        watch_directory: form.watch_directory.trim(),
        data_directory:  form.data_directory.trim(),
      });
      if (!r.ok) { flash(r.error || "Could not create the profile", "err"); return; }
      setForm(EMPTY);
      await reload();
      onChanged?.();
      flash(`Created ${r.profile.name}`, "ok");
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleRename() {
    try {
      const r = await renameProfile(editing.id, editing.name.trim());
      if (!r.ok) { flash(r.error || "Rename failed", "err"); return; }
      setEditing(null);
      await reload();
      onChanged?.();
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleRemove(id) {
    try {
      const r = await deleteProfile(id);
      setRemoving(null);
      if (!r.ok) { flash(r.error || "Remove failed", "err"); return; }
      await reload();
      onChanged?.();
    } catch {
      flash("Request failed — is the backend running?", "err");
    }
  }

  async function handleSwitch(id) {
    try {
      await switchProfile(id);
    } catch (e) {
      flash(e.message, "err");
    }
  }

  return (
    <>
      <div className="card-title">Profiles</div>
      <div className="profile-list">
        {profiles.map(p => (
          <div className={`profile-row${p.active ? " is-active" : ""}`} key={p.id}>
            <div className="profile-row-main">
              {editing?.id === p.id ? (
                <div className="folder-row">
                  <input
                    type="text"
                    autoFocus
                    value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(null); }}
                  />
                  <button className="btn-primary" onClick={handleRename}>Save</button>
                  <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="profile-row-name">
                  {p.name}
                  {p.active && <span className="profile-row-badge">Active</span>}
                  <span className="profile-row-count">{p.video_count ?? "?"} videos</span>
                </div>
              )}
              <div className="profile-row-path" title="Watch folder">{p.watch_directory}</div>
              <div className="profile-row-path" title="Data directory">{p.data_directory}</div>
            </div>
            {editing?.id !== p.id && (
              <div className="profile-row-actions">
                {!p.active && (
                  <button className="btn-secondary" onClick={() => handleSwitch(p.id)}>Switch</button>
                )}
                <button className="btn-ghost" onClick={() => setEditing({ id: p.id, name: p.name })} title="Rename">
                  <Icon name="pencil" size={13} />
                </button>
                {!p.active && (removing === p.id ? (
                  <>
                    <button className="btn-ghost" onClick={() => handleRemove(p.id)} title="Confirm: forget this profile">
                      <Icon name="check" size={13} />
                    </button>
                    <button className="btn-ghost" onClick={() => setRemoving(null)} title="Cancel">
                      <Icon name="close" size={13} />
                    </button>
                  </>
                ) : (
                  <button className="btn-ghost" onClick={() => setRemoving(p.id)} title="Remove profile (files are kept)">
                    <Icon name="trash" size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card-title" style={{ marginTop: "16px" }}>New Profile</div>
      <div className="folder-row" style={{ marginBottom: "6px" }}>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Name"
        />
      </div>
      <div className="folder-row" style={{ marginBottom: "6px" }}>
        <input
          type="text"
          value={form.watch_directory}
          onChange={e => setForm(f => ({ ...f, watch_directory: e.target.value }))}
          placeholder="Watch folder (where its videos are downloaded)"
        />
        <button className="btn-secondary" onClick={() => pickFolder("watch_directory", browse)}>Browse…</button>
      </div>
      <div className="folder-row">
        <input
          type="text"
          value={form.data_directory}
          onChange={e => setForm(f => ({ ...f, data_directory: e.target.value }))}
          placeholder="Data directory (its own database and thumbnails)"
        />
        <button className="btn-secondary" onClick={() => pickFolder("data_directory", browseData)}>Browse…</button>
        <button className="btn-primary" onClick={handleCreate}>Create</button>
      </div>
      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
        Each profile is its own library: videos, tags, playlists and stats stay inside it.
        Pick an empty data directory to start fresh, or one an earlier profile used to bring
        it back. Media roots are set in the Library tab after switching. Removing a profile
        only forgets it; its files stay on disk. The userscript always files into the active profile.
      </div>

      {msg && <div className={`msg show ${msg.type}`}>{msg.text}</div>}
    </>
  );
}
