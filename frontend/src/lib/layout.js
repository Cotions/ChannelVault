export function readLayout() {
  try {
    return localStorage.getItem("cv:layout") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function saveLayout(next) {
  try { localStorage.setItem("cv:layout", next); } catch {}
}
