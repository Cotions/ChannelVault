import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  latestThumbUrl, artistAvatarSrcUrl, getArtistAvatars,
  uploadArtistAvatar, setArtistAvatar, clearArtistAvatar,
} from "../lib/api";
import { artistsOf } from "../lib/artists";
import Icon from "./Icon";

const FRAME = 240;          // preview circle, px
const MAX_ZOOM = 4;
const UPLOAD_EDGE = 1600;   // longest side an upload is scaled down to

// Same order the backend uses for the default picture: newest upload first.
function newestFirst(a, b) {
  const r = String(b.recorded_date || "").localeCompare(String(a.recorded_date || ""));
  return r || String(b.downloaded_at || "").localeCompare(String(a.downloaded_at || ""));
}

// The square the backend will cut, in source pixels: centred on the focus,
// pushed back inside the picture near an edge. Mirrors _render_avatar.
function cropBox(w, h, fx, fy, zoom) {
  const side = Math.min(w, h) / zoom;
  const left = Math.min(Math.max(fx * w - side / 2, 0), w - side);
  const top  = Math.min(Math.max(fy * h - side / 2, 0), h - side);
  return { side, left, top };
}

// A focus past where the crop stops moving would make dragging feel dead.
function clampFocus(f, len, side) {
  const half = side / 2 / len;
  return half >= 0.5 ? 0.5 : Math.min(Math.max(f, half), 1 - half);
}

// The upload goes over JSON (the backend takes no multipart), so shrink it
// first: a phone photo would not fit, and an avatar never needs the pixels.
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Not an image this browser can read"));
      el.src = url;
    });
    const scale = Math.min(1, UPLOAD_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width  = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f1117";    // transparent PNGs land on the app's background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let q = 0.92, data = canvas.toDataURL("image/jpeg", q);
    while (data.length > 1_800_000 && q > 0.5) data = canvas.toDataURL("image/jpeg", (q -= 0.1));
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Choose an artist's picture: one of their videos' thumbnails or an image of
   your own, dragged and zoomed inside the circle. */
export default function AvatarPicker({ artist, videos, onClose, onSaved }) {
  const own = useMemo(
    () => videos.filter(v => artistsOf(v).includes(artist)).sort(newestFirst),
    [videos, artist],
  );
  const [source, setSource] = useState(null);     // { video_id } | { upload }
  const [current, setCurrent] = useState(null);   // the saved choice, if any
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState(null);   // { w, h } of the source
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const drag = useRef(null);

  // Open on the saved choice, else on what the artist shows today.
  useEffect(() => {
    let alive = true;
    getArtistAvatars().then(map => {
      if (!alive) return;
      const c = map?.[artist];
      if (c) {
        setCurrent(c);
        setSource(c.upload ? { upload: c.upload } : { video_id: c.video_id });
        setFocus({ x: c.focus_x, y: c.focus_y });
        setZoom(c.zoom);
      } else if (own[0]) {
        setSource({ video_id: own[0].video_id });
      }
    }).catch(() => { if (alive && own[0]) setSource({ video_id: own[0].video_id }); });
    return () => { alive = false; };
  }, [artist]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = e => {
      const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); handleFile(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const srcUrl = source?.upload ? artistAvatarSrcUrl(source.upload)
               : source?.video_id ? latestThumbUrl(source.video_id) : null;

  function pick(next) {
    if (source && (next.video_id ? next.video_id === source.video_id : next.upload === source.upload)) return;
    setNatural(null);
    setSource(next);
    setFocus({ x: 0.5, y: 0.5 });
    setZoom(1);
    setErr(null);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("That file isn't an image"); return; }
    setBusy(true);
    setErr(null);
    try {
      const data = await shrinkImage(file);
      const r = await uploadArtistAvatar(data);
      if (!r?.ok) { setErr(r?.error || "Upload failed"); return; }
      pick({ upload: r.upload });
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  // Display geometry: the source scaled so the crop square fills the circle.
  const geo = natural && (() => {
    const { side, left, top } = cropBox(natural.w, natural.h, focus.x, focus.y, zoom);
    const scale = FRAME / side;
    return { scale, side, style: { width: natural.w * scale, height: natural.h * scale, left: -left * scale, top: -top * scale } };
  })();

  function setZoomKeepingFocus(z) {
    const nz = Math.min(Math.max(z, 1), MAX_ZOOM);
    setZoom(nz);
    if (natural) {
      const side = Math.min(natural.w, natural.h) / nz;
      setFocus(f => ({ x: clampFocus(f.x, natural.w, side), y: clampFocus(f.y, natural.h, side) }));
    }
  }

  function onPointerDown(e) {
    if (!geo) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, focus, geo };
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d || !natural) return;
    // Dragging moves the picture, so the focus moves the other way.
    const fx = d.focus.x - (e.clientX - d.x) / d.geo.scale / natural.w;
    const fy = d.focus.y - (e.clientY - d.y) / d.geo.scale / natural.h;
    setFocus({ x: clampFocus(fx, natural.w, d.geo.side), y: clampFocus(fy, natural.h, d.geo.side) });
  }
  function onPointerUp() { drag.current = null; }

  async function save() {
    if (!source) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await setArtistAvatar({ name: artist, ...source, focus_x: focus.x, focus_y: focus.y, zoom });
      if (!r?.ok) { setErr(r?.error || "Could not save"); return; }
      onSaved?.();
      onClose();
    } catch {
      setErr("Could not reach the backend");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const r = await clearArtistAvatar(artist);
      if (r?.ok) { onSaved?.(); onClose(); }
      else setErr(r?.error || "Could not reset");
    } catch {
      setErr("Could not reach the backend");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile([...(e.dataTransfer?.files || [])].find(f => f.type.startsWith("image/")) || e.dataTransfer?.files?.[0]);
  }

  // Portaled: the page card is animated, and a transformed ancestor would
  // pin this "fixed" overlay to the card instead of the viewport.
  return createPortal(
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal modal-wide avatar-picker${dragOver ? " is-drop" : ""}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
        onDrop={onDrop}
      >
        <div className="modal-header">
          <span className="modal-title">Picture for {artist}</span>
          <button className="modal-close" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </div>

        <div className="ap-body">
          <div className="ap-stage">
            <div
              className={`ap-frame${geo ? " is-ready" : ""}`}
              style={{ width: FRAME, height: FRAME }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={e => setZoomKeepingFocus(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
            >
              {srcUrl ? (
                <img
                  key={srcUrl}
                  src={srcUrl}
                  alt=""
                  draggable={false}
                  style={geo ? geo.style : { opacity: 0 }}
                  onLoad={e => {
                    const n = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                    setNatural(n);
                    const side = Math.min(n.w, n.h) / zoom;
                    setFocus(f => ({ x: clampFocus(f.x, n.w, side), y: clampFocus(f.y, n.h, side) }));
                  }}
                  onError={() => setErr("This picture didn't load")}
                />
              ) : (
                <span className="ap-empty">No picture yet</span>
              )}
            </div>
            <label className="ap-zoom">
              <Icon name="minus" size={13} />
              <input
                type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
                onChange={e => setZoomKeepingFocus(+e.target.value)}
                disabled={!geo}
              />
              <Icon name="plus" size={13} />
            </label>
            <span className="field-hint">Drag to move · scroll or slide to zoom</span>
            {geo && (
              <div className="ap-sizes" aria-hidden>
                {[72, 40, 24].map(s => (
                  <span key={s} className="ap-mini" style={{ width: s, height: s }}>
                    <img src={srcUrl} alt="" style={{
                      width: geo.style.width * s / FRAME, height: geo.style.height * s / FRAME,
                      left: geo.style.left * s / FRAME, top: geo.style.top * s / FRAME,
                    }} />
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="ap-sources">
            <div className="ap-sources-head">
              <span className="ap-label">From a video{own.length ? ` · ${own.length}` : ""}</span>
              <button className="btn-secondary ap-upload" onClick={() => fileInput.current?.click()} disabled={busy}>
                <Icon name="image" size={13} />Upload image
              </button>
              <input
                ref={fileInput} type="file" accept="image/*" hidden
                onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </div>
            {source?.upload && (
              <div className="ap-upload-note"><Icon name="check" size={12} />Using your image</div>
            )}
            {own.length > 0 ? (
              <div className="ap-thumbs">
                {own.map(v => (
                  <button
                    key={v.video_id}
                    className={`ap-thumb${source?.video_id === v.video_id ? " is-on" : ""}`}
                    onClick={() => pick({ video_id: v.video_id })}
                    title={v.title || v.video_id}
                  >
                    <img src={latestThumbUrl(v.video_id)} alt="" loading="lazy"
                         onError={e => { e.currentTarget.parentElement.style.display = "none"; }} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="ap-none">No downloaded videos yet. Upload, drop or paste an image.</div>
            )}
            <span className="field-hint">You can also drop an image here or paste one (Ctrl+V).</span>
          </div>
        </div>

        {err && <div className="msg err">{err}</div>}

        <div className="modal-actions">
          {current && (
            <button className="btn-ghost ap-reset" onClick={reset} disabled={busy} title="Go back to the newest video's thumbnail">
              <Icon name="refresh" size={13} />Automatic
            </button>
          )}
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || !geo}>
            {busy ? "Saving…" : "Save picture"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
