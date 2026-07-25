import { useEffect, useRef } from "react";

/* Fixed backdrop behind everything. Replaces the static grid lines: two glow
   fields chase the cursor while a slow aurora drifts on its own, so the page
   has depth without anything moving under the content.

   The pointer position lives in CSS custom properties written straight to the
   node (never React state) — a mousemove at 120 Hz must not re-render the app.
   Writes are coalesced into one rAF frame and the layers are transform/opacity
   only, so the compositor handles them. */
export default function CyberBackground() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let x = 0.5, y = 0.35, frame = 0;

    function paint() {
      frame = 0;
      el.style.setProperty("--mx", `${(x * 100).toFixed(2)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(2)}%`);
      // Parallax: the far layer drifts against the cursor, the near one with it.
      el.style.setProperty("--px", `${((x - 0.5) * -40).toFixed(1)}px`);
      el.style.setProperty("--py", `${((y - 0.5) * -28).toFixed(1)}px`);
    }

    function onMove(e) {
      x = e.clientX / window.innerWidth;
      y = e.clientY / window.innerHeight;
      if (!frame) frame = requestAnimationFrame(paint);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="cyber-bg" ref={ref} aria-hidden="true">
      <div className="cyber-aurora" />
      <div className="cyber-cursor" />
      <div className="cyber-haze" />
    </div>
  );
}
