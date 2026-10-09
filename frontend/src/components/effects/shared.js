// Helpers shared by the profile effects.

// Small seeded PRNG so an artist always gets the same arrangement.
export function rng(str) {
  let s = 1;
  for (const c of str) s = (s * 31 + c.charCodeAt(0)) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// 4-point sparkle centred on 0,0
export function starPath(s) {
  const k = s * 0.12;
  return `M0 ${-s}C${k} ${-k} ${k} ${-k} ${s} 0C${k} ${k} ${k} ${k} 0 ${s}C${-k} ${k} ${-k} ${k} ${-s} 0C${-k} ${-k} ${-k} ${-k} 0 ${-s}Z`;
}
