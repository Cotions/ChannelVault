import { useEffect, useRef, useState } from "react";
import { effectById } from "./effects";

// Decorative overlay on the creator profile panel, after Discord's profile
// effects. Measures the panel and hands its size to the chosen effect.
export default function ProfileEffect({ effect, seed }) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);

  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth, height = el.clientHeight;
      // Span of the avatar + name + handle, so effects can keep pendants off it.
      const box = el.getBoundingClientRect();
      const id = el.parentElement.querySelector(".creator-profile-id")?.getBoundingClientRect();
      const avoid = id && { x1: 0, x2: Math.round(id.right - box.left + 16) };
      // Snap so small reflows don't reshuffle (and replay) the whole effect.
      setSize(s => (s && Math.abs(s.w - width) < 40 && Math.abs(s.h - height) < 40 && s.avoid?.x2 === avoid?.x2
        ? s : { w: width, h: height, avoid }));
    });
    ro.observe(el);
    // The name only arrives with the creator data; re-measure when it does.
    const id = el.parentElement.querySelector(".creator-profile-id");
    if (id) ro.observe(id);
    return () => ro.disconnect();
  }, []);

  const Effect = effectById(effect)?.Component;
  return (
    <div className="pfx" ref={ref} aria-hidden="true">
      {Effect && size && <Effect key={effect} seed={seed} w={size.w} h={size.h} avoid={size.avoid} />}
    </div>
  );
}
