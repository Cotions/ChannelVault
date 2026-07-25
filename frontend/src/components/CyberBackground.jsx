import { useEffect, useRef } from "react";

/* Fixed backdrop behind everything: a neon haze and a field of slow drifting
   filaments. Built for a room you sit in for hours, so nothing flashes, tears
   or strobes — the fastest thing on screen takes half a second.

   The pointer draws no light of its own. It leans the whole plate (parallax,
   slight skew, hue shift) and it disturbs filaments it actually crosses: the
   struck one brightens, bends away and sheds a few slow motes that fade out.

   Pointer state lives in refs and CSS custom properties written straight to the
   DOM, never React state — a 120 Hz mousemove must not re-render the app. */

const LINES  = 70;
const MOTES  = 90;
const HIT_RADIUS = 30;
const COLOURS = ["#4ade80", "#22d3ee", "#d946ef", "#5b9dff"];

// Distance from a point to a segment. Used to tell whether the cursor crossed a
// filament; a bounding box would fire on the empty corner of a steep line.
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function CyberBackground() {
  const rootRef   = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const el = rootRef.current, canvas = canvasRef.current;
    if (!el || !canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let px = 0.5, py = 0.4, lx = 0.5, ly = 0.4;
    function onMove(e) {
      px = e.clientX / window.innerWidth;
      py = e.clientY / window.innerHeight;
    }
    window.addEventListener("pointermove", onMove, { passive: true });

    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, raf = 0, last = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    // depth 0.25..1 drives length, speed, brightness and how hard wind hits.
    const lines = Array.from({ length: LINES }, (_, i) => {
      const depth = 0.25 + ((i * 37) % 100) / 133;
      return {
        x: ((i * 73) % 100) / 100 * w,
        y: ((i * 149) % 100) / 100 * h,
        depth,
        len: 22 + depth * 96,
        speed: 7 + depth * 26,        // px per second, upward. Deliberately slow.
        colour: COLOURS[i % COLOURS.length],
        phase: ((i * 211) % 100) / 100 * Math.PI * 2,
        hit: 0,    // 1 just after the cursor crosses it, eases back to 0
        kick: 0,   // sideways drift from that touch, px/s
      };
    });

    /* Motes shed on a touch. Fixed-size pool: a sweeping cursor can brush the
       field many times a second, and allocating per touch would hand the GC a
       steady drip of garbage. */
    const motes = Array.from({ length: MOTES }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, born: 1, colour: "#fff",
    }));
    let moteAt = 0;

    function shed(x, y, colour, depth) {
      const n = 2 + Math.round(depth * 2);
      for (let i = 0; i < n; i++) {
        const p = motes[moteAt = (moteAt + 1) % MOTES];
        const a = Math.random() * Math.PI * 2;
        const v = 8 + Math.random() * 26 * depth;   // drift, not spray
        p.x = x; p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - 10;
        p.born = p.life = 1.6 + Math.random() * 1.4;
        p.colour = colour;
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;

      // Heavily eased cursor: the plate follows like it is behind glass.
      lx += (px - lx) * Math.min(1, dt * 2.6);
      ly += (py - ly) * Math.min(1, dt * 2.6);
      const wx = (lx - 0.5) * 2, wy = (ly - 0.5) * 2;

      el.style.setProperty("--px", `${(wx * -26).toFixed(1)}px`);
      el.style.setProperty("--py", `${(wy * -17).toFixed(1)}px`);
      el.style.setProperty("--tilt", `${(wx * 2.2).toFixed(2)}deg`);
      el.style.setProperty("--hue", `${(wx * 30).toFixed(1)}deg`);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      const cx = lx * w, cy = ly * h;

      for (const s of lines) {
        s.x += (wx * 26 * s.depth + s.kick) * dt;
        s.y += (-s.speed + wy * 20 * s.depth) * dt;
        s.kick *= Math.max(0, 1 - dt * 1.6);   // bleeds off over a second or so
        if (s.y + s.len < 0) { s.y = h + s.len; s.x = Math.random() * w; }
        if (s.y - s.len > h) s.y = -s.len;
        if (s.x < -40) s.x = w + 40;
        if (s.x > w + 40) s.x = -40;

        // Head and tail as drawn, so the test matches the pixels on screen.
        const tx = s.x + wx * s.len * 0.35 * s.depth, ty = s.y + s.len;
        s.hit = Math.max(0, s.hit - dt * 0.8);   // ~1.2s to settle
        if (s.hit < 0.25 && pointSegDist(cx, cy, s.x, s.y, tx, ty) < HIT_RADIUS) {
          s.hit = 1;
          s.kick = (s.x < cx ? -1 : 1) * (16 + 26 * s.depth);
          shed(s.x, s.y + s.len * 0.5, s.colour, s.depth);
        }

        const breathe = 0.6 + 0.4 * Math.sin(now / 2600 + s.phase);
        ctx.globalAlpha = Math.min(0.85, (0.05 + s.depth * 0.16) * breathe + s.hit * 0.32);
        ctx.strokeStyle = s.colour;
        ctx.shadowColor = s.colour;
        ctx.shadowBlur  = 6 + s.depth * 12 + s.hit * 18;
        ctx.lineWidth   = 0.6 + s.depth * 1.3 + s.hit * 0.9;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      for (const p of motes) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.max(0, 1 - dt * 0.7);
        p.vy *= Math.max(0, 1 - dt * 0.7);
        const k = Math.max(0, p.life / p.born);
        ctx.globalAlpha = k * k * 0.5;          // squared, so the tail is soft
        ctx.fillStyle   = p.colour;
        ctx.shadowColor = p.colour;
        ctx.shadowBlur  = 8 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.1 + k * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    if (!reduced) raf = requestAnimationFrame(frame);

    function onVisibility() {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf && !reduced) { last = 0; raf = requestAnimationFrame(frame); }
    }

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="cyber-bg" ref={rootRef} aria-hidden="true">
      <div className="cyber-haze" />
      <canvas className="cyber-lines" ref={canvasRef} />
      <div className="cyber-grain" />
      <div className="cyber-vignette" />
    </div>
  );
}
