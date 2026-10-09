import { useLayoutEffect, useMemo, useRef } from "react";
import { rng, starPath } from "./shared";
import { createWorld, run, ropePath, hangAngle } from "./rope";

// Celestial: loose silk strings drape across the top in two uneven layers,
// some dripping short beaded strands; crescent moons and a star ornament hang
// on threads. The strings are simulated ropes (./rope.js): the drapes start
// pulled straight along the top and fall into their sag, each pendant starts
// held out flat to the side and swings down until it hangs still. Sparkles
// twinkle a few times and one shower of glitter falls. Nothing loops.

function layout(seed, w, h, avoid) {
  const rand = rng(seed);
  const r = (a, b) => a + rand() * (b - a);
  const clear = x => !avoid || x < avoid.x1 || x > avoid.x2;

  const drapes = [];
  for (const front of [false, true]) {
    let x = -r(10, 60);
    while (x < w) {
      const span = r(80, 220), slack = front ? r(1.03, 1.11) : r(1.05, 1.15);
      const n = Math.max(8, Math.round(span * slack / 8));    // rope points
      const every = Math.round(r(3, 6));
      drapes.push({
        x1: x, x2: x + span, y1: r(-3, 1), y2: r(-3, 1), front, slack, n,
        beads: Array.from({ length: n }, (_, i) => i).filter(i => i > 1 && i < n - 2 && i % every === 0),
        delay: 0.05 + Math.max(0, x / w) * 0.35 + (front ? 0.08 : 0),
        drips: Array.from({ length: rand() < 0.65 ? (rand() < 0.35 ? 2 : 1) : 0 },
          () => ({ at: r(0.2, 0.8), len: r(10, 48) })).filter(dr => clear(x + span * dr.at)),
        charm: front && rand() < 0.5 && clear(x + span / 2),
      });
      x += span;
    }
  }

  // Moons spread over whatever width is left right of the name.
  const from = avoid ? Math.min(avoid.x2 + 10, w * 0.6) : 0;
  const moonCount = Math.max(2, Math.round((w - from) / 220));
  const moons = Array.from({ length: moonCount }, (_, i) => {
    const x = from + (i + 0.5) * ((w - from) / moonCount) + r(-14, 14);
    return { x, len: r(30, 64), size: r(6, 8.5), delay: 0.35 + i * 0.15 + r(0, 0.1), dir: x < w / 2 ? 1 : -1 };
  });

  const sparkles = Array.from({ length: Math.round(w / 45) }, () => {
    const edge = rand() < 0.5;
    return {
      x: edge ? (rand() < 0.5 ? r(6, 40) : r(w - 40, w - 6)) : r(20, w - 20),
      y: edge ? r(16, h - 10) : r(8, Math.min(h, 120)),
      size: r(2.5, 5.5), dur: r(1.6, 3.4), delay: r(0, 3),
    };
  });
  const glitter = Array.from({ length: Math.round(w / 60) }, () => ({
    x: r(0, w), size: r(0.5, 1.3), dur: r(3, 6), delay: r(0.3, 2.5), drift: r(-25, 25),
  }));
  return { drapes, moons, sparkles, glitter, ornament: { x: w - Math.min(90, w * 0.2), len: r(34, 48), delay: 0.5 } };
}

// Build the rope world for a layout. Returns the world plus, per drawn thing,
// which points it follows.
// Pendants fall slower and swing less than the drapes they hang beside.
const PENDANT = { grav: 0.4, damp: 0.987 };

function buildWorld(fx) {
  const world = createWorld();
  const strand = (from, n, seg, inv, release, endInv = inv, feel) => {
    const ids = [from];
    const p = world.pts[from];
    for (let k = 1; k <= n; k++) {
      ids.push(world.point(p.x, p.y, k === n ? endInv : inv, release, feel));
      world.link(ids[k - 1], ids[k], seg);
    }
    return ids;
  };

  const drapes = fx.drapes.map(d => {
    const span = d.x2 - d.x1, len = span * d.slack, n = d.n;
    const ids = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      ids.push(world.point(d.x1 + span * t, d.y1 + (d.y2 - d.y1) * t, i === 0 || i === n - 1 ? 0 : 1, d.delay));
      if (i) world.link(ids[i - 1], ids[i], len / (n - 1));
    }
    const drips = d.drips.map(dr => {
      const m = Math.max(3, Math.round(dr.len / 6));
      return strand(ids[Math.round(dr.at * (n - 1))], m, dr.len / m, 1, d.delay, 0.5);
    });
    const charm = d.charm ? strand(ids[Math.floor(n / 2)], 2, 5, 1, d.delay, 0.4, PENDANT) : null;
    return { ids, drips, charm, beads: d.beads.map(i => ids[i]) };
  });

  // Pendant: pinned at the top, laid out flat toward `dir`, heavy at the end.
  const pendant = ({ x, len, dir, delay }, endInv, segs = 6) => {
    const seg = len / segs;
    const ids = [world.point(x, -1, 0)];
    for (let k = 1; k <= segs; k++) {
      ids.push(world.point(x + dir * k * seg, -1, k === segs ? endInv : 1, delay, PENDANT));
      world.link(ids[k - 1], ids[k], seg);
    }
    return ids;
  };
  const moons = fx.moons.map(m => pendant(m, 0.25));
  const ornament = pendant({ ...fx.ornament, dir: -1 }, 0.12, 7);
  return { world, drapes, moons, ornament };
}

const THREAD = "rgba(var(--glow-rgb), 0.55)";

export default function Celestial({ seed, w, h, avoid }) {
  const fx = useMemo(() => layout(seed, w, h, avoid), [seed, w, h, avoid]);
  const svgRef = useRef(null);

  useLayoutEffect(() => {
    const { world, drapes, moons, ornament } = buildWorld(fx);
    const pts = world.pts;
    const e = {};
    for (const el of svgRef.current.querySelectorAll("[data-k]")) e[el.dataset.k] = el;
    const path = (key, ids) => e[key]?.setAttribute("d", ropePath(pts, ids));
    const dot = (key, id) => { e[key]?.setAttribute("cx", pts[id].x); e[key]?.setAttribute("cy", pts[id].y); };
    const hang = (key, ids) => {
      const a = pts[ids[ids.length - 2]], b = pts[ids[ids.length - 1]];
      e[key]?.setAttribute("transform", `translate(${b.x} ${b.y}) rotate(${hangAngle(a, b)})`);
    };
    const paint = () => {
      drapes.forEach((d, i) => {
        path(`d${i}`, d.ids);
        d.beads.forEach((id, j) => dot(`d${i}b${j}`, id));
        d.drips.forEach((ids, j) => { path(`d${i}r${j}`, ids); dot(`d${i}r${j}e`, ids[ids.length - 1]); });
        if (d.charm) { path(`d${i}c`, d.charm); hang(`d${i}ce`, d.charm); }
      });
      moons.forEach((ids, i) => { path(`m${i}`, ids); hang(`m${i}e`, ids); });
      path("o", ornament); hang("oe", ornament);
    };
    return run(world, paint);
  }, [fx]);

  const fade = delay => ({ className: "pfx-fade", style: { "--delay": `${delay}s` } });

  return (
    <>
      <div className="pfx-haze" />
      <svg ref={svgRef} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <linearGradient id="pfx-silver" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" style={{ stopColor: "rgb(var(--glow-rgb))" }} />
          </linearGradient>
          <filter id="pfx-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="pfx-bigglow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {fx.moons.map((m, i) => (
            <mask key={i} id={`pfx-moon-${i}`} maskContentUnits="userSpaceOnUse">
              <rect x={-m.size * 2} y={-m.size} width={m.size * 4} height={m.size * 4} fill="white" />
              <circle cx={m.size * 0.45} cy={m.size * 0.75} r={m.size * 0.85} fill="black" />
            </mask>
          ))}
        </defs>

        {fx.drapes.map((d, i) => (
          <g key={i} {...fade(d.delay)}>
            <path data-k={`d${i}`} fill="none" stroke="url(#pfx-silver)"
              strokeWidth={d.front ? 0.95 : 0.65} strokeOpacity={d.front ? 0.9 : 0.45}
              filter={d.front ? "url(#pfx-glow)" : undefined} />
            {d.drips.map((_, j) => (
              <g key={j}>
                <path data-k={`d${i}r${j}`} fill="none" stroke={THREAD} strokeWidth=".6" />
                <circle data-k={`d${i}r${j}e`} r="1.5" fill="url(#pfx-silver)" filter="url(#pfx-glow)" />
              </g>
            ))}
            {d.beads.map((_, j) => (
              <circle key={j} data-k={`d${i}b${j}`} r={j % 3 ? 1 : 1.4} fill="url(#pfx-silver)" opacity={d.front ? 1 : 0.6} />
            ))}
            {d.charm && (
              <>
                <path data-k={`d${i}c`} fill="none" stroke={THREAD} strokeWidth=".6" />
                <g data-k={`d${i}ce`}>
                  <path d="M0 0l3 5-3 6-3-6z" fill="url(#pfx-silver)" filter="url(#pfx-glow)" />
                </g>
              </>
            )}
          </g>
        ))}

        {fx.moons.map((m, i) => (
          <g key={i} {...fade(m.delay)}>
            <path data-k={`m${i}`} fill="none" stroke={THREAD} strokeWidth=".7" />
            <g data-k={`m${i}e`}>
              <circle cy="-1" r="1.6" fill="url(#pfx-silver)" />
              <circle cy={m.size} r={m.size} fill="url(#pfx-silver)" mask={`url(#pfx-moon-${i})`} filter="url(#pfx-glow)" />
            </g>
          </g>
        ))}

        <g {...fade(fx.ornament.delay)}>
          <path data-k={"o"} fill="none" stroke={THREAD} strokeWidth=".7" />
          <g data-k={"oe"}>
            <g filter="url(#pfx-bigglow)" transform="translate(0 15)">
              <path d={starPath(15)} fill="url(#pfx-silver)" />
              <path d={starPath(8)} transform="rotate(45)" fill="url(#pfx-silver)" opacity=".8" />
              <circle r="2.4" fill="white" />
            </g>
          </g>
        </g>

        <g {...fade(0.4)}>
          {fx.sparkles.map((s, i) => (
            <g key={i} className="pfx-twinkle" filter="url(#pfx-glow)"
              style={{ transformOrigin: `${s.x}px ${s.y}px`, "--tw": `${s.dur}s`, "--td": `${s.delay}s` }}>
              <path d={starPath(s.size)} transform={`translate(${s.x} ${s.y})`} fill="url(#pfx-silver)" />
            </g>
          ))}
        </g>
        {fx.glitter.map((g, i) => (
          <circle key={i} className="pfx-glitter" cx={g.x} cy="0" r={g.size} fill="white"
            style={{ "--gd": `${g.dur}s`, "--gdelay": `${g.delay}s`, "--gx": `${g.drift}px`, "--gy": `${h + 20}px` }} />
        ))}
      </svg>
    </>
  );
}
