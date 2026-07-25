import { useEffect, useRef } from "react";

/* Fixed backdrop behind everything: a blue/pink/violet haze and slow falling
   columns of glyphs. Built for a room you sit in for hours, so nothing flashes
   or strobes — drops take many seconds to cross, and a glyph only ever swaps
   during the dim tail where the change is invisible.

   The pointer draws no light of its own. It leans the whole plate (parallax,
   slight skew, hue) and disturbs drops it actually touches: the struck one
   flares white, gets shoved sideways, and throws off specks that fade out.

   Pointer state lives in refs and CSS custom properties written straight to the
   DOM, never React state — a 120 Hz mousemove must not re-render the app. */

const DROPS  = 46;
const SPECKS = 90;
const COLOURS = ["#5b9dff", "#f472b6", "#a855f7", "#c4b5fd", "#e8ecf6"];
// Half-width katakana and a few symbols: the standard rain alphabet, and every
// glyph occupies the same cell so a column never reflows.
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=*+<>|";
const CELL = 17;   // vertical spacing between glyphs in a column

function pick() {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
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

    // depth 0.25..1 drives size, fall speed, brightness and wind response.
    function reset(d, i, first) {
      const depth = 0.25 + Math.random() * 0.75;
      d.depth = depth;
      d.x = first ? ((i * 73) % 100) / 100 * w : Math.random() * w;
      d.len = 5 + Math.round(depth * 12);
      d.y = first
        ? Math.random() * h
        : -CELL * d.len - Math.random() * h * 0.4;
      d.speed = 14 + depth * 34;                 // px/s downward. Slow on purpose.
      d.colour = COLOURS[(Math.random() * COLOURS.length) | 0];
      d.chars = Array.from({ length: d.len }, pick);
      d.swapAt = 0;
      d.hit = 0;
      d.kick = 0;
    }
    const drops = Array.from({ length: DROPS }, (_, i) => {
      const d = {};
      reset(d, i, true);
      return d;
    });

    /* Specks thrown off on a touch. Fixed-size pool: a sweeping cursor can brush
       the field many times a second, and allocating per touch would hand the GC
       a steady drip of garbage. */
    const specks = Array.from({ length: SPECKS }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, born: 1, ch: "0", colour: "#fff",
    }));
    let speckAt = 0;

    function shed(x, y, colour, depth) {
      const n = 2 + Math.round(depth * 3);
      for (let i = 0; i < n; i++) {
        const p = specks[speckAt = (speckAt + 1) % SPECKS];
        const a = Math.random() * Math.PI * 2;
        const v = 12 + Math.random() * 34 * depth;   // drift, not spray
        p.x = x; p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v + 14;                 // biased with the rain
        p.ch = pick();
        p.born = p.life = 1.3 + Math.random() * 1.2;
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
      el.style.setProperty("--hue", `${(wx * 22).toFixed(1)}deg`);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const cx = lx * w, cy = ly * h;
      const t = now / 1000;

      for (const d of drops) {
        d.x += (wx * 16 * d.depth + d.kick) * dt;
        d.y += (d.speed * (1 + wy * 0.25)) * dt;
        d.kick *= Math.max(0, 1 - dt * 1.6);

        const tail = d.y - CELL * (d.len - 1);
        if (tail > h + CELL) { reset(d, 0, false); continue; }
        if (d.x < -40) d.x = w + 40;
        if (d.x > w + 40) d.x = -40;

        d.hit = Math.max(0, d.hit - dt * 0.9);       // ~1.1s to settle

        // Cursor against the column as a vertical segment, not a box: a box
        // fires on empty air beside the glyphs.
        const near = Math.abs(cx - d.x) < 22 &&
                     cy > tail - CELL && cy < d.y + CELL;
        if (d.hit < 0.25 && near) {
          d.hit = 1;
          d.kick = (d.x < cx ? -1 : 1) * (26 + 34 * d.depth);
          shed(d.x, cy, d.colour, d.depth);
        }

        // One glyph swap per drop every ~1.4s, always deep in the faded tail
        // where the change cannot read as a blink.
        if (t > d.swapAt) {
          d.swapAt = t + 1.1 + Math.random() * 0.8;
          d.chars[(Math.random() * (d.len - 2) | 0) + 2] = pick();
        }

        const size = 10 + d.depth * 6;
        ctx.font = `${size}px ${"JetBrains Mono, ui-monospace, monospace"}`;
        const base = 0.06 + d.depth * 0.14;

        for (let i = 0; i < d.len; i++) {
          const y = d.y - i * CELL;
          if (y < -CELL || y > h + CELL) continue;
          // Head is the bright one and stays near white; the tail falls away on
          // a curve so the column reads as a streak, not a dotted line.
          const fade = 1 - i / d.len;
          const head = i === 0;
          ctx.globalAlpha = Math.min(0.85,
            (head ? base * 3.4 : base * fade * fade) + d.hit * (head ? 0.4 : 0.18));
          ctx.fillStyle = head && d.hit < 0.2 ? "#e8ecf6" : d.colour;
          ctx.shadowColor = d.colour;
          ctx.shadowBlur = (head ? 10 : 4) + d.hit * 14;
          ctx.fillText(d.chars[i], d.x, y);
        }
      }

      ctx.shadowBlur = 0;
      ctx.font = "11px JetBrains Mono, ui-monospace, monospace";
      for (const p of specks) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.max(0, 1 - dt * 0.9);
        p.vy *= Math.max(0, 1 - dt * 0.5);
        const k = Math.max(0, p.life / p.born);
        ctx.globalAlpha = k * k * 0.45;             // squared: soft tail
        ctx.fillStyle = p.colour;
        ctx.fillText(p.ch, p.x, p.y);
      }

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
      <canvas className="cyber-rain" ref={canvasRef} />
      <div className="cyber-grain" />
      <div className="cyber-vignette" />
    </div>
  );
}
