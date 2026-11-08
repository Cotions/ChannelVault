import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { artistsOf } from "../lib/artists";
import { videoMatches } from "../lib/sort";
import { isYouTube } from "../lib/source";
import { useRememberedPage, useRememberedState } from "../lib/usePagination";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import MarkRow from "../components/MarkRow";
import DownloadButton from "../components/DownloadButton";
import Icon from "../components/Icon";

const SORTS = [
  { value: "marked",  label: "Date marked" },
  { value: "channel", label: "Channel" },
  { value: "length",  label: "Length" },
  { value: "title",   label: "Title" },
];

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

// "3h 12m" for a total; minutes only under an hour.
function fmtTotal(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sortMarks(list, sort, dir) {
  const sign = dir === "asc" ? 1 : -1;
  const out = [...list];
  out.sort((a, b) => {
    let c;
    if (sort === "channel") c = collator.compare(artistsOf(a)[0], artistsOf(b)[0]);
    else if (sort === "length") {
      // Unknown length sinks to the bottom either way.
      const da = a.duration_secs || 0, db = b.duration_secs || 0;
      if (!da !== !db) return da ? -1 : 1;
      c = da - db;
    }
    else if (sort === "title") c = collator.compare(a.title || "", b.title || "");
    else c = (a.downloaded_at || "").localeCompare(b.downloaded_at || "");
    // Ties (same channel) fall back to newest marked first.
    if (c === 0) return (b.downloaded_at || "").localeCompare(a.downloaded_at || "");
    return c * sign;
  });
  return out;
}

// Every wanted (or skipped) video across all artists, in one list.
export default function WantedPage({ wanted, ignored, query, onRemoveMark }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "skipped" ? "skipped" : "wanted";
  const [sort, setSort] = useRememberedState("wanted:sort", "marked");
  const [dir,  setDir]  = useRememberedState("wanted:dir", "desc");

  const source = tab === "skipped" ? ignored : wanted;
  const shown = useMemo(
    () => sortMarks(source.filter(v => videoMatches(v, query)), sort, dir),
    [source, query, sort, dir],
  );
  const [page, setPage] = useRememberedPage(`wanted:${tab}:page`, [query, sort, dir]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const known = shown.filter(v => v.duration_secs > 0);
  const totalSecs = known.reduce((s, v) => s + v.duration_secs, 0);
  const channels = new Set(shown.flatMap(artistsOf)).size;
  const perChannel = useMemo(() => {
    const m = new Map();
    for (const v of shown) { const ch = artistsOf(v)[0]; m.set(ch, (m.get(ch) || 0) + 1); }
    return m;
  }, [shown]);

  function openTab(next) {
    setParams(p => {
      const n = new URLSearchParams(p);
      if (next === "wanted") n.delete("tab"); else n.set("tab", next);
      return n;
    }, { replace: true });
  }

  // Sorted by channel: a header over each run of one channel's rows.
  const grouped = sort === "channel";

  return (
    <div className="card">
      <div className="page-head">
        <h2 className="page-title">{tab === "skipped" ? "Ignored" : "Wanted"}</h2>
        <span className="page-count">{shown.length.toLocaleString()}</span>
        <span className="page-head-spacer" />
        <div className="sort-controls">
          <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            className="sort-dir"
            onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
            title={dir === "desc" ? "Descending — click for ascending" : "Ascending — click for descending"}
          >
            <Icon name={dir === "desc" ? "arrowDown" : "arrowUp"} size={15} />
          </button>
        </div>
      </div>

      <div className="artist-tabs" role="tablist">
        {[["wanted", "Wanted", wanted.length], ["skipped", "Ignored", ignored.length]].map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
                  className={`artist-tab artist-tab-${k}${tab === k ? " is-on" : ""}`}
                  onClick={() => openTab(k)}>
            {label}<span className="artist-tab-n">{n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {shown.length > 0 && (
        <div className="wanted-summary">
          <span><b>{shown.length.toLocaleString()}</b> video{shown.length === 1 ? "" : "s"}</span>
          <span><b>{channels.toLocaleString()}</b> channel{channels === 1 ? "" : "s"}</span>
          {totalSecs > 0 && (
            <span title={known.length < shown.length ? `${(shown.length - known.length).toLocaleString()} with no known length` : undefined}>
              <b>{fmtTotal(totalSecs)}</b> total{known.length < shown.length ? "+" : ""}
            </span>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          {query?.trim()
            ? `No ${tab} videos match the search.`
            : tab === "skipped" ? "Nothing ignored." : "Nothing wanted yet. Mark videos on YouTube or from the Inbox."}
        </div>
      ) : (
        <>
          <div className="mark-list">
            {pageItems.map((v, idx) => {
              const ch = artistsOf(v)[0];
              const header = grouped && (idx === 0 || artistsOf(pageItems[idx - 1])[0] !== ch);
              return (
                <div key={v.video_id} className="wanted-item">
                  {header && (
                    <Link className={`wanted-group${idx === 0 ? " is-first" : ""}`} to={`/artist/${encodeURIComponent(ch)}?tab=${tab}`}>
                      <Icon name="users" size={13} />{ch}
                      <span className="wanted-group-n">{perChannel.get(ch)}</span>
                    </Link>
                  )}
                  <MarkRow video={v} onRemoveMark={onRemoveMark} showChannel={!grouped}>
                    {tab === "wanted" && isYouTube(v) && <DownloadButton video={v} className="btn-secondary" />}
                  </MarkRow>
                </div>
              );
            })}
          </div>
          <Pagination page={safePage} count={pageCount} onPage={setPage} />
        </>
      )}
    </div>
  );
}
