import { Link } from "react-router-dom";
import Icon from "./Icon";

/* Hex colours come from the backend palette as #rrggbb, so a two-digit alpha
   suffix tints them without a colour library. */
export function tagStyle(color) {
  const c = color || "#4ade80";
  return { background: `${c}22`, borderColor: `${c}66`, color: c };
}

export default function TagChip({ tag, onRemove, link = false, size = "md", title }) {
  const cls = `tag-chip tag-chip-${size}`;
  const body = (
    <>
      <span className="tag-chip-dot" style={{ background: tag.color || "#4ade80" }} />
      <span className="tag-chip-name">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          className="tag-chip-x"
          title={`Remove ${tag.name}`}
          onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(tag); }}
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </>
  );
  if (link && tag.id != null) {
    return (
      <Link to={`/tag/${tag.id}`} className={cls} style={tagStyle(tag.color)} title={title || `All videos tagged ${tag.name}`}>
        {body}
      </Link>
    );
  }
  return <span className={cls} style={tagStyle(tag.color)} title={title}>{body}</span>;
}
