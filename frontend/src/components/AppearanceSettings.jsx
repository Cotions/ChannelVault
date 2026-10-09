import { useEffect, useState } from "react";
import Icon from "./Icon";
import {
  PRESETS, ROLES, DEFAULT_THEME_ID, applyTheme, getActiveId, getActiveTheme,
  getCustomThemes, palette, saveCustomThemes, setActiveTheme, themeColors,
} from "../lib/theme";
import { useEffectPrefs, setEffectsEnabled, setFallbackEffect } from "../lib/profileEffects";
import { EFFECTS } from "./effects";

// Which palette variable each pinnable role shows when left on auto.
const ROLE_VAR = {
  fill: "--accent", buttonText: "--on-accent", glow: "--glow",
  glowText: "--on-glow", highlight: "--accent-text",
};

function ThemeCard({ theme, active, onPick, onCopy, onEdit, onDelete }) {
  const c = themeColors(theme);
  return (
    <div className={`theme-card${active ? " active" : ""}`} onClick={onPick} role="button" tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick())}>
      <div className="theme-card-art">
        <span className="theme-orb" style={{ "--orb-a": c["--glow"], "--orb-b": c["--accent"] }} />
        <span className="theme-sample" style={{ background: `linear-gradient(180deg, ${c["--accent-hover"]}, ${c["--accent"]})`, color: c["--on-accent"] }}>Aa</span>
        <span className="theme-sample-text" style={{ color: c["--accent-text"] }}>42</span>
      </div>
      <div className="theme-card-foot">
        <span className="theme-card-name">{theme.name}</span>
        <span className="theme-card-actions" onClick={e => e.stopPropagation()}>
          {onEdit && <button className="icon-btn-sm" onClick={onEdit} title="Edit theme"><Icon name="pencil" size={13} /></button>}
          <button className="icon-btn-sm" onClick={onCopy} title="Duplicate as a custom theme"><Icon name="copy" size={13} /></button>
          {onDelete && <button className="icon-btn-sm danger" onClick={onDelete} title="Delete theme"><Icon name="trash" size={13} /></button>}
        </span>
      </div>
    </div>
  );
}

function ThemeEditor({ initial, onSave, onCancel }) {
  const [draft, setDraft] = useState(initial);

  // Paint the page live while editing. However the editor goes away (Save,
  // Cancel, closing Settings) the saved active theme is put back on the way out.
  useEffect(() => {
    applyTheme({ ...initial, id: initial.id || "draft" });
    return () => applyTheme(getActiveTheme());
  }, [initial]);

  function update(next) {
    setDraft(next);
    applyTheme({ ...next, id: next.id || "draft" });
  }

  const derived = palette({ base: draft.base });
  const current = palette(draft);

  return (
    <div className="theme-editor">
      <div className="theme-editor-head">
        <input
          type="text"
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="Theme name"
          maxLength={32}
        />
      </div>

      <div className="theme-role">
        <label className="theme-role-swatch" style={{ background: draft.base }}>
          <input type="color" value={draft.base} onChange={e => update({ ...draft, base: e.target.value })} />
        </label>
        <div className="theme-role-label">
          <span>Base colour</span>
          <small>Everything below follows it unless pinned</small>
        </div>
      </div>

      {ROLES.map(r => {
        const pinned = !!draft[r.key];
        const value = current[ROLE_VAR[r.key]];
        return (
          <div key={r.key} className={`theme-role${pinned ? " pinned" : ""}`}>
            <label className="theme-role-swatch" style={{ background: value }}>
              <input type="color" value={value} onChange={e => update({ ...draft, [r.key]: e.target.value })} />
            </label>
            <div className="theme-role-label">
              <span>{r.label}</span>
              <small>{r.hint}</small>
            </div>
            {pinned ? (
              <button className="btn-ghost" onClick={() => { const rest = { ...draft }; delete rest[r.key]; update(rest); }}
                title={`Back to ${derived[ROLE_VAR[r.key]]}, worked out from the base colour`}>
                Use auto
              </button>
            ) : (
              <span className="theme-role-auto">auto</span>
            )}
          </div>
        );
      })}

      <div className="theme-preview">
        <button className="btn-primary" tabIndex={-1}>Scan Now</button>
        <span className="artist-badge">207 videos</span>
        <span className="theme-preview-play"><Icon name="play" size={14} /></span>
        <span className="status-dot online" />
      </div>

      <div className="theme-editor-foot">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave({ ...draft, name: draft.name.trim() || "Custom" })}>Save theme</button>
      </div>
    </div>
  );
}

function ProfileEffectSettings() {
  const prefs = useEffectPrefs();
  const picked = Object.keys(prefs.artists).length;
  return (
    <>
      <div className="card-title" style={{ marginTop: "24px" }}>Profile effects</div>
      <label className="pfx-setting">
        <input type="checkbox" checked={prefs.enabled} onChange={e => setEffectsEnabled(e.target.checked)} />
        Show decorative effects on creator profiles
      </label>
      <div className="folder-row pfx-setting">
        <span>Default effect</span>
        <select className="sort-select" value={prefs.fallback} disabled={!prefs.enabled} onChange={e => setFallbackEffect(e.target.value)}>
          {EFFECTS.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          <option value="none">None</option>
        </select>
      </div>
      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "10px" }}>
        Pick a different effect for one artist with the sparkle button on their profile.
        {picked > 0 && ` ${picked} artist${picked === 1 ? " has" : "s have"} their own pick.`} Saved in this browser.
      </div>
    </>
  );
}

export default function AppearanceSettings() {
  const [custom, setCustom] = useState(getCustomThemes);
  const [activeId, setActiveId] = useState(getActiveId);
  const [editing, setEditing] = useState(null);

  function pick(theme) {
    setActiveTheme(theme);
    setActiveId(theme.id);
  }

  function copyOf(theme) {
    const rest = { ...theme };
    delete rest.id;
    // Phosphor's look comes from index.css, not the derivation: pin its exact roles.
    const pins = theme.id === DEFAULT_THEME_ID
      ? { fill: "#2f9e4f", glow: "#4ade80", highlight: "#a5f0bf", buttonText: "#04130a", glowText: "#04130a" }
      : {};
    setEditing({ ...rest, ...pins, name: `${theme.name} copy` });
  }

  function save(theme) {
    const t = theme.id ? theme : { ...theme, id: `c-${Date.now().toString(36)}` };
    const list = custom.some(c => c.id === t.id) ? custom.map(c => c.id === t.id ? t : c) : [...custom, t];
    saveCustomThemes(list);
    setCustom(list);
    setEditing(null);
    pick(t);
  }


  function remove(theme) {
    const list = custom.filter(c => c.id !== theme.id);
    saveCustomThemes(list);
    setCustom(list);
    if (activeId === theme.id) pick(PRESETS[0]);
  }

  return (
    <>
      <div className="theme-section-head">
        <div className="card-title">Themes</div>
        {!editing && (
          <button className="btn-secondary btn-export" onClick={() => copyOf(getActiveTheme())}>
            <Icon name="plus" size={13} />Create theme
          </button>
        )}
      </div>

      {editing ? (
        <ThemeEditor key={editing.id || "new"} initial={editing} onSave={save} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div className="theme-grid">
            {PRESETS.map(t => (
              <ThemeCard key={t.id} theme={t} active={t.id === activeId} onPick={() => pick(t)} onCopy={() => copyOf(t)} />
            ))}
          </div>

          {custom.length > 0 && (
            <>
              <div className="card-title" style={{ marginTop: "18px" }}>Your themes</div>
              <div className="theme-grid">
                {custom.map(t => (
                  <ThemeCard
                    key={t.id}
                    theme={t}
                    active={t.id === activeId}
                    onPick={() => pick(t)}
                    onCopy={() => copyOf(t)}
                    onEdit={() => setEditing(t)}
                    onDelete={() => remove(t)}
                  />
                ))}
              </div>
            </>
          )}

          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "10px" }}>
            Themes recolour icons, buttons, highlights and glows. The dark background stays the same.
            Duplicate any theme to pin exact colours for each part, including button text.
            Saved in this browser.
          </div>
        </>
      )}

      {!editing && <ProfileEffectSettings />}
    </>
  );
}
