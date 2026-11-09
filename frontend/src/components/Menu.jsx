import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

/* One "more" button that holds a screen's secondary actions, so the screen
   shows its main action and little else. Portalled to <body>: cards clip their
   overflow and the player shell paints above the page, so a menu rendered in
   place would be cut off or open behind the picture.

   items: [{ label, icon, onClick, danger, disabled, hint, keepOpen,
             href (opens in a new tab), confirm: { text, yes },
             items: [...] (a sub-list shown in place), divider: true,
             input: { placeholder, icon } with onSubmit(text) (a one-line field) }]
   Falsy entries are skipped, so callers can write `cond && {...}`. */
export default function Menu({ items, label = "More actions", icon = "more", className = "icon-btn", size = 16, children, onOpenChange }) {
  const [open, setOpen]       = useState(false);
  const [pos, setPos]         = useState(null);
  const [confirm, setConfirm] = useState(null);   // the item waiting for a yes
  const [subKey, setSubKey]   = useState(null);   // which item's sub-list is showing
  const btnRef  = useRef(null);
  const menuRef = useRef(null);
  // Looked up on every render, so a sub-list reflects a change it just made.
  const sub  = subKey == null ? null : items.filter(Boolean).find(i => (i.key ?? i.label) === subKey) || null;
  // Dividers only between groups: none first, last or twice in a row.
  const list = (sub ? sub.items : items).filter(Boolean)
    .filter((it, i, a) => !it.divider || (i > 0 && i < a.length - 1 && !a[i - 1].divider));
  const setSub = it => setSubKey(it ? (it.key ?? it.label) : null);

  function close() { setOpen(false); setConfirm(null); setSub(null); onOpenChange?.(false); }
  function toggle(e) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { close(); return; }
    setOpen(true);
    onOpenChange?.(true);
  }

  // Hang it under the button, right edges aligned; flip up or left when the
  // screen runs out.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      const m = menuRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = m?.width || 220, h = m?.height || 200;
      let left = r.right - w;
      if (left < 8) left = Math.min(r.left, window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      setPos({ top, left: Math.max(8, left) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, confirm, subKey]);

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = e => {
      if (e.key === "Escape") { e.stopPropagation(); close(); btnRef.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const els = [...(menuRef.current?.querySelectorAll("button:not(:disabled), a, input") || [])];
      if (!els.length) return;
      e.preventDefault();
      const i = els.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
      els[next].focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the first entry so the keyboard can carry on from the button.
  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector("button:not(:disabled), a")?.focus({ preventScroll: true });
  }, [open, !!pos, confirm, subKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  function run(it) {
    if (it.items) { setSub(it); return; }
    if (it.confirm) { setConfirm(it); return; }
    it.onClick?.();
    if (!it.keepOpen) close();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${className}${open ? " is-on" : ""}`}
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {children || <Icon name={icon} size={size} />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="menu"
          role="menu"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
          onClick={e => e.stopPropagation()}
        >
          {confirm ? (
            <div className="menu-confirm">
              <div className="menu-confirm-text">{confirm.confirm.text}</div>
              <div className="menu-confirm-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
                <button
                  type="button"
                  className={confirm.danger ? "btn-danger" : "btn-primary"}
                  onClick={() => { confirm.onClick?.(); close(); }}
                >
                  {confirm.confirm.yes || confirm.label}
                </button>
              </div>
            </div>
          ) : (
            <>
              {sub && (
                <button type="button" className="menu-item menu-back" onClick={() => setSub(null)}>
                  <Icon name="back" size={15} />{sub.label}
                </button>
              )}
              {sub && list.length === 0 && <div className="menu-empty">{sub.empty || "Nothing here yet"}</div>}
              {list.map((it, i) => it.divider
                ? <div key={`d${i}`} className="menu-sep" role="separator" />
                : it.input ? (
                  <MenuInput key={it.key || "input"} {...it.input} onSubmit={text => { it.onSubmit?.(text); close(); }} />
                ) : it.href ? (
                  <a
                    key={it.label}
                    className="menu-item"
                    role="menuitem"
                    href={it.href}
                    {...(it.download ? { download: "" } : { target: "_blank", rel: "noreferrer" })}
                    onClick={close}
                  >
                    {it.icon && <Icon name={it.icon} size={16} />}
                    <span className="menu-label">{it.label}</span>
                    {!it.download && <Icon name="external" size={13} className="menu-trail" />}
                  </a>
                ) : (
                  <button
                    key={it.key || it.label}
                    type="button"
                    role="menuitem"
                    className={`menu-item${it.danger ? " is-danger" : ""}${it.checked ? " is-checked" : ""}`}
                    disabled={it.disabled}
                    onClick={() => run(it)}
                    title={it.title}
                  >
                    {it.icon && <Icon name={it.icon} size={16} className={it.spin ? "spin" : ""} />}
                    <span className="menu-label">{it.label}</span>
                    {it.hint && <span className="menu-hint">{it.hint}</span>}
                    {it.items && <Icon name="arrowRight" size={13} className="menu-trail" />}
                    {it.checked && <Icon name="check" size={14} className="menu-trail" />}
                  </button>
                ))}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// Type a name, press Enter: for "make a new one" rows inside a menu.
function MenuInput({ placeholder, icon = "plus", onSubmit }) {
  const [text, setText] = useState("");
  return (
    <form
      className="menu-input"
      onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t) onSubmit(t); }}
    >
      <Icon name={icon} size={16} />
      <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}
