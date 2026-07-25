import { useEffect, useRef } from "react";

/* Fixed backdrop behind everything: columns of coloured glyphs falling straight
   down over a flat dark field. No haze, no glow, no parallax — the colour lives
   in the glyphs themselves and nothing slides sideways with the cursor.

   Every glyph is pre-rendered once into a small sprite and the frame loop only
   blits those. Calling fillText several hundred times a frame is what made the
   fall stutter.

   The cursor still disturbs a column it passes through: that column flares
   white and sheds a few glyphs. Column state lives in refs, never React state,
   so a 120 Hz mousemove cannot re-render the app. */

const DROPS  = 46;
const SPECKS = 90;
const COLOURS = ["#5b9dff", "#f472b6", "#a855f7", "#c4b5fd", "#e8ecf6"];
// Half-width katakana and a few symbols: the standard rain alphabet, and every
// glyph occupies the same cell so a column never reflows.
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=*+<>|";
const CELL = 17;    // vertical spacing between glyphs in a column
const SPRITE = 26;  // sprite box; no glow to leave room for, so it fits the cell
const BASE = 16;    // font size the sprites are drawn at; blitted scaled down

function pick() {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
}

/* One sprite per (glyph, colour, head) triple, built on first use and kept for
   the life of the page. Bounded by the alphabet, so it tops out around 600
   little canvases and settles within a few seconds of load. */
const sprites = new Map();
function sprite(ch, colour, head) {
  const key = `${ch}|${colour}|${head ? 1 : 0}`;
  let c = sprites.get(key);
  if (c) return c;
  // Baked at device resolution, or a retina screen blits a 1x glyph upscaled
  // and the rain goes soft.
  const ss = Math.min(window.devicePixelRatio || 1, 2);
  c = document.createElement("canvas");
  c.width = c.height = Math.round(SPRITE * ss);
  const g = c.getContext("2d");
  g.setTransform(ss, 0, 0, ss, 0, 0);
  g.font = `${BASE}px "JetBrains Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Flat ink, no shadow. The head is only a paler tint of the same colour.
  g.fillStyle = head ? "#eef1f8" : colour;
  g.fillText(ch, SPRITE / 2, SPRITE / 2);
  sprites.set(key, c);
  return c;
}

export default function CyberBackground() {
  const rootRef   = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cx = -999, cy = -999;
    function onMove(e) { cx = e.clientX; cy = e.clientY; }
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

    // depth 0.25..1 drives size, fall speed and brightness.
    function reset(d, i, first, t) {
      const depth = 0.25 + Math.random() * 0.75;
      d.depth = depth;
      d.x = first ? ((i * 73) % 100) / 100 * w : Math.random() * w;
      d.len = 6 + Math.round(depth * 12);
      d.y = first ? Math.random() * h : -CELL * d.len - Math.random() * h * 0.4;
      d.speed = 16 + depth * 38;                 // px/s downward. Slow on purpose.
      d.colour = COLOURS[(Math.random() * COLOURS.length) | 0];
      d.chars = Array.from({ length: d.len }, pick);
      // Each cell rewrites on its own clock, so the trail churns instead of the
      // whole column flipping at once.
      d.next = Array.from({ length: d.len }, () => t + Math.random() * 1.2);
      d.hit = 0;
    }
    const drops = Array.from({ length: DROPS }, (_, i) => {
      const d = {};
      reset(d, i, true, 0);
      return d;
    });

    /* Glyphs shaken loose by the cursor. Fixed-size pool: a sweeping cursor can
       brush the field many times a second, and allocating per touch would hand
       the GC a steady drip of garbage. */
    const specks = Array.from({ length: SPECKS }, () => ({
      x: 0, y: 0, vy: 0, life: 0, born: 1, ch: "0", colour: "#fff",
    }));
    let speckAt = 0;

    function shed(x, y, colour, depth) {
      const n = 2 + Math.round(depth * 3);
      for (let i = 0; i < n; i++) {
        const p = specks[speckAt = (speckAt + 1) % SPECKS];
        p.x = x + (i - n / 2) * 3;
        p.y = y + i * 6;
        p.vy = 30 + Math.random() * 50 * depth;   // they just drop away
        p.ch = pick();
        p.born = p.life = 1.1 + Math.random() * 1.1;
        p.colour = colour;
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      const t = now / 1000;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      for (const d of drops) {
        d.y += d.speed * dt;

        const tail = d.y - CELL * (d.len - 1);
        if (tail > h + CELL) { reset(d, 0, false, t); continue; }

        d.hit = Math.max(0, d.hit - dt * 0.9);       // ~1.1s to settle

        // Cursor against the column as a vertical segment, not a box: a box
        // fires on empty air beside the glyphs.
        const near = Math.abs(cx - d.x) < 22 &&
                     cy > tail - CELL && cy < d.y + CELL;
        if (d.hit < 0.25 && near) {
          d.hit = 1;
          shed(d.x, cy, d.colour, d.depth);
        }

        const scale = (10 + d.depth * 6) / BASE;
        const box = SPRITE * scale;
        const dim = 0.09 + d.depth * 0.2;

        for (let i = 0; i < d.len; i++) {
          const y = d.y - i * CELL;

          // Rewrite on this cell's own clock. Deeper in the tail it churns
          // faster, since that is where it is dim enough not to read as a blink;
          // the head holds its glyph long enough to stay legible.
          if (t > d.next[i]) {
            d.next[i] = t + (i === 0 ? 0.7 : 0.22) + Math.random() * (i === 0 ? 0.9 : 0.7);
            d.chars[i] = pick();
          }

          if (y < -CELL || y > h + CELL) continue;
          // Head is the bright one; the tail falls away on a curve so the column
          // reads as a streak rather than a dotted line.
          const head = i === 0;
          const fade = 1 - i / d.len;
          ctx.globalAlpha = Math.min(0.9,
            (head ? dim * 2.6 : dim * fade * fade) + d.hit * (head ? 0.35 : 0.16));
          ctx.drawImage(sprite(d.chars[i], d.colour, head && d.hit < 0.2),
                        d.x - box / 2, y - box / 2, box, box);
        }
      }

      const speckBox = SPRITE * (11 / BASE);
      for (const p of specks) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.y += p.vy * dt;
        p.vy *= Math.max(0, 1 - dt * 0.4);
        const k = Math.max(0, p.life / p.born);
        ctx.globalAlpha = k * k * 0.5;              // squared: soft tail
        ctx.drawImage(sprite(p.ch, p.colour, false),
                      p.x - speckBox / 2, p.y - speckBox / 2, speckBox, speckBox);
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
      <canvas className="cyber-rain" ref={canvasRef} />
      <div className="cyber-grain" />
      <div className="cyber-vignette" />
    </div>
  );
}
