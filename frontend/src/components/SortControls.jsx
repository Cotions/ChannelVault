import { SORT_OPTIONS } from "../lib/sort";

export default function SortControls({ sort, dir, onSort, onDir }) {
  return (
    <>
      <select className="sort-select" value={sort} onChange={e => onSort(e.target.value)}>
        {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button
        className="sort-dir"
        onClick={() => onDir(dir === "desc" ? "asc" : "desc")}
        title={dir === "desc" ? "Descending — click for ascending" : "Ascending — click for descending"}
      >
        {dir === "desc" ? "↓" : "↑"}
      </button>
    </>
  );
}
