import { SORT_OPTIONS } from "../lib/sort";
import Icon from "./Icon";

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
        <Icon name={dir === "desc" ? "arrowDown" : "arrowUp"} size={15} />
      </button>
    </>
  );
}
