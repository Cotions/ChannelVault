const API_BASE = "http://localhost:3360";
const BADGE_ID = "channelvault-badge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVideoId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("v") || null;
}

function removeBadge() {
  const el = document.getElementById(BADGE_ID);
  if (el) el.remove();
}

function injectBadge() {
  if (document.getElementById(BADGE_ID)) return;

  // Target the video title heading
  const titleEl =
    document.querySelector("h1.ytd-video-primary-info-renderer") ||
    document.querySelector("ytd-video-primary-info-renderer h1") ||
    document.querySelector("#above-the-fold #title h1");

  if (!titleEl) return;

  const badge = document.createElement("span");
  badge.id = BADGE_ID;
  badge.textContent = "✓ Downloaded";
  badge.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "margin-left:10px",
    "padding:3px 10px",
    "background:#2e7d32",
    "color:#fff",
    "font-size:13px",
    "font-weight:600",
    "border-radius:4px",
    "vertical-align:middle",
    "line-height:1.4",
  ].join(";");

  titleEl.appendChild(badge);
}

// ---------------------------------------------------------------------------
// Stats scraping
// ---------------------------------------------------------------------------

function parseCount(text) {
  if (!text) return null;
  // "1,234,567 views" → 1234567; "12K likes" won't appear but handle digits
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function scrapeStats() {
  const viewEl = document.querySelector(
    "ytd-video-view-count-renderer span.view-count, span.view-count"
  );
  const viewCount = viewEl ? parseCount(viewEl.textContent) : null;

  // Like count lives in the aria-label of the like button: "like this video along with 12,345 other people"
  const likeBtn = document.querySelector(
    "ytd-segmented-like-dislike-button-renderer #segmented-like-button button, " +
    "ytd-toggle-button-renderer[is-icon-button] button[aria-label*='like']"
  );
  let likeCount = null;
  if (likeBtn) {
    const label = likeBtn.getAttribute("aria-label") || "";
    const match = label.match(/([\d,]+)/);
    if (match) likeCount = parseInt(match[1].replace(/,/g, ""), 10);
    // Fallback: text content of the formatted string beside the button
    if (!likeCount) {
      const countEl = likeBtn.closest("ytd-toggle-button-renderer, ytd-segmented-like-dislike-button-renderer")
        ?.querySelector("yt-formatted-string, span.yt-core-attributed-string");
      if (countEl) likeCount = parseCount(countEl.textContent);
    }
  }

  return { view_count: viewCount, like_count: likeCount };
}

async function postStats(videoId) {
  const stats = scrapeStats();
  if (stats.view_count === null && stats.like_count === null) return;
  try {
    await fetch(`${API_BASE}/update-stats/${videoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stats),
    });
  } catch (_) {
    // Backend not running — silent fail
  }
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

async function checkAndAnnotate() {
  removeBadge();
  const videoId = getVideoId();
  if (!videoId) return;

  let downloaded = false;
  try {
    const res = await fetch(`${API_BASE}/check-video/${videoId}`);
    const data = await res.json();
    downloaded = data.downloaded === true;
  } catch (_) {
    return; // Backend not running
  }

  if (downloaded) {
    // Wait for the title element to be present (YouTube renders async)
    waitForTitle(() => {
      injectBadge();
      // Delay stats scrape slightly so view count renders
      setTimeout(() => postStats(videoId), 2000);
    });
  }
}

function waitForTitle(cb, attempts = 0) {
  const titleEl =
    document.querySelector("h1.ytd-video-primary-info-renderer") ||
    document.querySelector("ytd-video-primary-info-renderer h1") ||
    document.querySelector("#above-the-fold #title h1");

  if (titleEl) {
    cb();
  } else if (attempts < 20) {
    setTimeout(() => waitForTitle(cb, attempts + 1), 300);
  }
}

// ---------------------------------------------------------------------------
// YouTube SPA navigation handling
// ---------------------------------------------------------------------------

// YouTube fires this custom event on each client-side navigation
window.addEventListener("yt-navigate-finish", checkAndAnnotate);

// Initial load
checkAndAnnotate();
