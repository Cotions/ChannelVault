export const PAGE_SIZE = 50;

// Windowed page numbers: 1 … 4 5 [6] 7 8 … 20
function pageItems(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const items = [1];
  const start = Math.max(2, page - 1);
  const end   = Math.min(count - 1, page + 1);
  if (start > 2) items.push("…");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < count - 1) items.push("…");
  items.push(count);
  return items;
}

export default function Pagination({ page, count, onPage }) {
  if (count <= 1) return null;
  const go = (p) => { onPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <div className="pagination">
      <button className="page-btn" onClick={() => go(page - 1)} disabled={page === 1} title="Previous">‹</button>
      {pageItems(page, count).map((it, i) =>
        it === "…" ? (
          <span key={`gap${i}`} className="page-gap">…</span>
        ) : (
          <button
            key={it}
            className={`page-btn${it === page ? " active" : ""}`}
            onClick={() => go(it)}
          >
            {it}
          </button>
        )
      )}
      <button className="page-btn" onClick={() => go(page + 1)} disabled={page === count} title="Next">›</button>
    </div>
  );
}
