import { useEffect, useRef } from "react";

/* Esc closes a dialog, like every popover in the app. Menus inside it catch
   the key first (capture phase) and stop it, so one press closes one layer. */
export function useEscape(onClose) {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; });
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape" && !e.defaultPrevented) ref.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
