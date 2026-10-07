import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { CHANNEL_STATUS } from "../lib/channelStatus";

/* Header button on the artist page for marking what became of the channel.
   The menu reuses the tag picker's list styling. */
export default function ChannelStatusMenu({ status, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next) {
    setOpen(false);
    if (next !== status) onChange(next);
  }

  const options = [
    { value: null, label: "Active", hint: "Still up and uploading" },
    ...Object.entries(CHANNEL_STATUS).map(([value, s]) => ({ value, ...s })),
  ];

  return (
    <div className="channel-status-wrap" ref={wrapRef}>
      <button
        className="btn-secondary btn-export"
        onClick={() => setOpen(o => !o)}
        title="Mark this channel abandoned, deleted or banned"
      >
        <Icon name="warn" size={13} />Channel status
      </button>
      {open && (
        <div className="tag-picker-menu channel-status-menu">
          {options.map(o => (
            <button
              key={o.value || "active"}
              className={`tag-picker-option${o.value === status ? " is-on" : ""}`}
              onClick={() => pick(o.value)}
            >
              <span className="channel-status-check">{o.value === status && <Icon name="check" size={12} />}</span>
              <span className="channel-status-option">
                <span className={o.value ? `channel-status-text is-${o.value}` : undefined}>{o.label}</span>
                <span className="channel-status-hint">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
