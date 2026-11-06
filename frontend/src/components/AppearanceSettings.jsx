import { useEffect, useState } from "react";
import Icon from "./Icon";
import {
  PRESETS, ROLES, DEFAULT_THEME_ID, applyTheme, getActiveId, getActiveTheme,
  getCustomThemes, palette, saveCustomThemes, setActiveTheme, themeColors,
} from "../lib/theme";
import { useEffectPrefs, setEffectsEnabled, setFallbackEffect } from "../lib/profileEffects";
import { EFFECTS } from "./effects";
import { Stars } from "./Rating";
import { saveRatingSettings } from "../lib/api";
import { bandsProblem, DEFAULT_RATING, MAX_RATING, starsShort, withBand } from "../lib/rating";

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


/* Artist ratings: on or off as a whole (off, no stars, borders or rating
   sort anywhere, and nothing to rate with), and the border color a rated
   artist's card takes, by band. The switch saves at once; the bands are a
   draft until Save. Saved in config.json, for every browser and profile. */
function RatingSettings({ saved, onSaved }) {
  const [draft,  setDraft]  = useState(saved.bands);
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState(null);
  const problem = bandsProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.bands);

  async function send(next, okText) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await saveRatingSettings(next);
      if (r?.ok) { onSaved?.(r.rating || next); if (okText) setMsg({ ok: true, text: okText }); }
      else setMsg({ ok: false, text: r?.error || "Save failed." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const edit = next => { setDraft(next); setMsg(null); };
  const editBand = (i, change) => edit(draft.map((b, j) => (j === i ? { ...b, ...change } : b)));
  const added = withBand(draft);
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_RATING.bands);

  return (
    <>
      <div className="card-title" style={{ marginTop: "24px" }}>Artist ratings</div>
      <label className="pfx-setting">
        <input type="checkbox" checked={saved.enabled} disabled={saving}
               onChange={e => send({ enabled: e.target.checked, bands: saved.bands })} />
        Rate artists, and color their card&rsquo;s border by rating
      </label>
      {saved.enabled ? (
        <form onSubmit={e => { e.preventDefault(); if (!problem) send({ enabled: true, bands: draft }, "Saved."); }}>
          <div style={{ fontSize: "11px", color: "var(--muted)", margin: "10px 0" }}>
            A rated artist&rsquo;s card takes the color of the highest band that starts at or below their
            rating. Below the first band, and not rated: the plain border.
          </div>
          <ul className="rating-bands" aria-label="Rating bands">
            {draft.map((b, i) => {
              const top = i === draft.length - 1;
              const reach = top ? "Top band" : draft[i + 1].min > b.min ? `Up to ${starsShort(draft[i + 1].min - 1)}★` : "";
              return (
                <li key={i} className="rating-band">
                  <input type="color" className="rating-band-color" value={b.color}
                         aria-label={`Color from ${starsShort(b.min)} stars`}
                         onChange={e => editBand(i, { color: e.target.value.toLowerCase() })} />
                  <label className="rating-band-min">
                    <span>From</span>
                    <select className="sort-select" value={b.min} aria-label={`Band ${i + 1} starts at`}
                            onChange={e => editBand(i, { min: Number(e.target.value) })}>
                      {Array.from({ length: MAX_RATING }, (_, n) => n + 1).map(n => (
                        <option key={n} value={n}>{starsShort(n)}★</option>
                      ))}
                    </select>
                  </label>
                  <span className={`rating-sample is-rated${top ? " is-top-band" : ""}`} style={{ "--rating-color": b.color }}>
                    <Stars rating={b.min} />
                    <span className="rating-sample-reach" title={reach}>{reach}</span>
                  </span>
                  <button type="button" className="icon-btn-sm danger" disabled={draft.length <= 1}
                          aria-label={`Remove the band from ${starsShort(b.min)} stars`} title="Remove"
                          onClick={() => edit(draft.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
          {problem && <div className="rating-problem">{problem}</div>}
          <div className="rating-actions">
            <button type="button" className="btn-secondary btn-export" disabled={!added} onClick={() => edit(added)}
                    title={added ? "A band half a star above the last" : "The last band starts at 5 stars, or there are 10"}>
              <Icon name="plus" size={13} />Add a band
            </button>
            <button type="submit" className="btn-primary" disabled={saving || !dirty || !!problem}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost" disabled={isDefault} onClick={() => edit(DEFAULT_RATING.bands)}>
              Reset to defaults
            </button>
            {dirty && <button type="button" className="btn-ghost" onClick={() => edit(saved.bands)}>Discard changes</button>}
          </div>
        </form>
      ) : (
        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "10px" }}>
          Ratings are hidden everywhere. Ratings already given are kept for when you turn them back on.
        </div>
      )}
      {msg && <div className={`rating-msg ${msg.ok ? "ok" : "err"}`} role="alert">{msg.text}</div>}
    </>
  );
}

export default function AppearanceSettings({ rating, onRatingSaved }) {
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
      {!editing && (
        <RatingSettings saved={rating || DEFAULT_RATING} onSaved={onRatingSaved} />
      )}
    </>
  );
}
