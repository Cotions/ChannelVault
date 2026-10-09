// Tiny Verlet rope simulation for the profile effects. Points move under
// gravity; links stop two points drifting further apart than their length but
// let them bunch up, which is what makes a thread hang loose instead of acting
// like a stick. A point with invMass 0 is pinned; heavier points (lower
// invMass) pull the rope straight like a pendant does. Per point, `grav`
// scales gravity (lower = slower fall) and `damp` is its drag (lower = less
// swinging).

const GRAVITY = 1400;     // px/s²
const STEP = 1 / 240;     // fixed substep, s
const DAMP = 0.996;       // velocity kept per substep (air drag)
const ITER = 14;          // constraint passes per substep

export function createWorld() {
  const pts = [];         // { x, y, px, py, inv, release, grav, damp }
  const links = [];       // [a, b, len]
  return {
    pts,
    point(x, y, inv = 1, release = 0, { grav = 1, damp = DAMP } = {}) {
      pts.push({ x, y, px: x, py: y, inv, release, grav, damp });
      return pts.length - 1;
    },
    link(a, b, len) { links.push([a, b, len]); },
    // Advance to `t` seconds; returns the largest move this call, for settling.
    step(t) {
      let moved = 0;
      for (const p of pts) {
        if (!p.inv || t < p.release) { p.px = p.x; p.py = p.y; continue; }
        const vx = (p.x - p.px) * p.damp, vy = (p.y - p.py) * p.damp;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * p.grav * STEP * STEP;
      }
      for (let k = 0; k < ITER; k++) {
        for (const [a, b, len] of links) {
          const pa = pts[a], pb = pts[b];
          const ia = t < pa.release ? 0 : pa.inv, ib = t < pb.release ? 0 : pb.inv;
          if (!ia && !ib) continue;
          const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy);
          if (d <= len || !d) continue;
          const f = (d - len) / d / (ia + ib);
          pa.x += dx * f * ia; pa.y += dy * f * ia;
          pb.x -= dx * f * ib; pb.y -= dy * f * ib;
        }
      }
      for (const p of pts) moved = Math.max(moved, Math.abs(p.x - p.px) + Math.abs(p.y - p.py));
      return moved;
    },
  };
}

// Drive a world in real time, calling paint() each frame, until it has been
// still for half a second (or `maxSecs` pass). Returns a cancel function.
// Under reduced motion it jumps straight to the settled state.
export function run(world, paint, { maxSecs = 10 } = {}) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let t = 0, still = 0, raf = 0, last = null;
  const settle = () => {
    // Everything released at once so nothing waits on a delay.
    for (const p of world.pts) p.release = 0;
    for (let i = 0; i < maxSecs / STEP; i++) world.step(i * STEP);
    paint();
  };
  if (reduce) { settle(); return () => {}; }

  const frame = now => {
    if (last == null) last = now;
    const target = t + Math.min((now - last) / 1000, 0.05);   // a background tab can't make it jump
    last = now;
    while (t < target) {
      const moved = world.step(t);
      t += STEP;
      const released = world.pts.every(p => t >= p.release);
      still = released && moved < 0.004 ? still + STEP : 0;
    }
    paint();
    if (still < 0.5 && t < maxSecs) raf = requestAnimationFrame(frame);
  };
  paint();
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// Smooth SVG path through a run of points (quadratic through midpoints).
export function ropePath(pts, ids) {
  const p = ids.map(i => pts[i]);
  let d = `M${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2;
    d += `Q${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const e = p[p.length - 1];
  return d + `L${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
}

// Rotation (deg) that turns "hanging straight down" into the direction a→b.
export function hangAngle(a, b) {
  return (Math.atan2(-(b.x - a.x), b.y - a.y) * 180) / Math.PI;
}
