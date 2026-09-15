/* One WebAudio graph, shared by the player's <video> and its alternate <audio>.

   Two things a media element cannot do on its own. Its volume stops at 1.0, and
   a good part of a downloaded library is mastered quiet enough that 100% on
   laptop speakers is still too soft — a GainNode has no such ceiling. And
   nothing in the element evens out a file that whispers for a minute then
   shouts, which a compressor does.

   The catch is that routing an element into a graph is one-way and permanent,
   and a suspended AudioContext then means silence rather than merely no boost.
   So the graph is built only when something actually asks for it — volume past
   100%, or the leveller — which by definition happens under a click, where
   resume() is allowed. Below that the elements keep their own volume and no
   graph ever exists.

   Chain: element → per-element gain → master (volume) → [compressor → makeup] →
   speakers. The per-element gain is how the picture is silenced while an
   alternate soundtrack plays; the master is the single volume the user sees. */

let ctx     = null;
let master  = null;   // the one volume control, free to go past 1
let comp    = null;   // leveller, bypassed unless asked for
let makeup  = null;   // a compressor only takes away, this puts it back
let level   = false;
let broken  = false;  // WebAudio refused; callers fall back to element volume

const nodes = new WeakMap();   // element → { src, gain }

/** True once anything has been routed through the graph. */
export function live() { return !!ctx && !broken; }

function route() {
  if (!master || !ctx) return;
  try { master.disconnect(); } catch { /* never connected yet */ }
  master.connect(level ? comp : ctx.destination);
}

/** Build (or reuse) the graph. False means this browser will not play along. */
export function ensure() {
  if (ctx) return true;
  if (broken) return false;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { broken = true; return false; }
  try {
    ctx    = new AC();
    master = ctx.createGain();
    comp   = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value      = 30;
    comp.ratio.value     = 8;
    comp.attack.value    = 0.004;
    comp.release.value   = 0.25;
    makeup = ctx.createGain();
    makeup.gain.value = 2.2;
    comp.connect(makeup);
    makeup.connect(ctx.destination);
    route();
    return true;
  } catch { broken = true; ctx = null; return false; }
}

/** Autoplay policy suspends the context until a gesture; every play calls this. */
export function resume() { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); }

/** Route one element in. Safe to call again with the same element. */
export function attach(el) {
  if (!el || !ensure()) return false;
  if (nodes.has(el)) return true;
  try {
    const src  = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(master);
    nodes.set(el, { src, gain });
    el.volume = 1;          // loudness belongs to the graph from here on
    return true;
  } catch { return false; }
}

/** An <audio> element dies with its track; unhook it so the graph stays tidy. */
export function detach(el) {
  const n = el && nodes.get(el);
  if (!n) return;
  try { n.src.disconnect(); n.gain.disconnect(); } catch { /* already gone */ }
  nodes.delete(el);
}

export function attached(el) { return !!el && nodes.has(el); }

/** 0 silences one source without touching the master volume. */
export function elementGain(el, value) {
  const n = el && nodes.get(el);
  if (n) n.gain.gain.value = value;
}

export function setVolume(v) {
  if (!master) return;
  // A ramp rather than a jump: stepping gain with the arrow keys clicks audibly.
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(Math.max(0, v), t, 0.015);
}

export function setLevelling(on) {
  if (level === on) return;
  level = on;
  route();
}
