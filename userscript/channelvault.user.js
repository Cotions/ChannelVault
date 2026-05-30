// ==UserScript==
// @name         ChannelVault
// @namespace    https://github.com/Cotions/channelvault
// @version      1.1.0
// @description  Shows a badge on YouTube videos you've downloaded locally via ChannelVault
// @author       Cotions
// @match        https://www.youtube.com/*
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    http://localhost:3360/userscript/channelvault.user.js
// @downloadURL  http://localhost:3360/userscript/channelvault.user.js
// ==/UserScript==

const API_BASE = "http://localhost:3360";
const BADGE_ID = "channelvault-badge";
const CARD_BADGE_CLASS = "cv-card-badge";

GM_addStyle(`
  #${BADGE_ID} {
    display: inline-flex;
    align-items: center;
    margin-top: 8px;
    padding: 3px 10px;
    background: #2e7d32;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    border-radius: 4px;
    line-height: 1.4;
    font-family: system-ui, sans-serif;
  }
`);

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

function colorTitle(green) {
  const titleEl =
    document.querySelector("ytd-watch-metadata h1 yt-formatted-string") ||
    document.querySelector("ytd-watch-metadata h1") ||
    document.querySelector("#above-the-fold h1 yt-formatted-string") ||
    document.querySelector("#title h1 yt-formatted-string") ||
    document.querySelector("#title h1");
  if (!titleEl) return;
  titleEl.style.color = green ? "#2e7d32" : "";
}

function injectBadge() {
  if (document.getElementById(BADGE_ID)) return;

  const titleEl =
    document.querySelector("ytd-watch-metadata h1") ||
    document.querySelector("h1.ytd-watch-metadata") ||
    document.querySelector("#above-the-fold h1") ||
    document.querySelector("h1.ytd-video-primary-info-renderer") ||
    document.querySelector("ytd-video-primary-info-renderer h1") ||
    document.querySelector("#title h1");

  if (!titleEl) return;

  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.textContent = "✓ Downloaded";
  titleEl.insertAdjacentElement("afterend", badge);
}

// ---------------------------------------------------------------------------
// GM_xmlhttpRequest wrappers (bypasses CORS, no flask-cors needed)
// ---------------------------------------------------------------------------

function gmFetch(url) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      onload: (res) => {
        try {
          resolve(JSON.parse(res.responseText));
        } catch (e) {
          reject(e);
        }
      },
      onerror: reject,
    });
  });
}

function gmPost(url, body) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(body),
      onload: (res) => {
        try {
          resolve(JSON.parse(res.responseText));
        } catch (e) {
          reject(e);
        }
      },
      onerror: reject,
    });
  });
}

// ---------------------------------------------------------------------------
// Stats scraping
// ---------------------------------------------------------------------------

function parseCount(text) {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function scrapeStats() {
  const viewEl = document.querySelector(
    "ytd-video-view-count-renderer span.view-count, span.view-count"
  );
  const viewCount = viewEl ? parseCount(viewEl.textContent) : null;

  const likeBtn = document.querySelector(
    "ytd-segmented-like-dislike-button-renderer #segmented-like-button button, " +
    "ytd-toggle-button-renderer[is-icon-button] button[aria-label*='like']"
  );
  let likeCount = null;
  if (likeBtn) {
    const label = likeBtn.getAttribute("aria-label") || "";
    const match = label.match(/([\d,]+)/);
    if (match) likeCount = parseInt(match[1].replace(/,/g, ""), 10);
    if (!likeCount) {
      const countEl = likeBtn
        .closest("ytd-toggle-button-renderer, ytd-segmented-like-dislike-button-renderer")
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
    await gmPost(`${API_BASE}/update-stats/${videoId}`, stats);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

async function checkAndAnnotate() {
  removeBadge();
  colorTitle(false);
  const videoId = getVideoId();
  if (!videoId) return;

  let downloaded = false;
  try {
    const data = await gmFetch(`${API_BASE}/check-video/${videoId}`);
    downloaded = data.downloaded === true;
  } catch (_) {
    return;
  }

  if (downloaded) {
    waitForTitle(() => {
      injectBadge();
      colorTitle(true);
      setTimeout(() => postStats(videoId), 2000);
    });
  }
}

function waitForTitle(cb, attempts = 0) {
  const titleEl =
    document.querySelector("ytd-watch-metadata h1") ||
    document.querySelector("h1.ytd-watch-metadata") ||
    document.querySelector("#above-the-fold h1") ||
    document.querySelector("h1.ytd-video-primary-info-renderer") ||
    document.querySelector("ytd-video-primary-info-renderer h1") ||
    document.querySelector("#title h1");

  if (titleEl) {
    cb();
  } else if (attempts < 20) {
    setTimeout(() => waitForTitle(cb, attempts + 1), 300);
  }
}

// ---------------------------------------------------------------------------
// Channel page — annotate video cards
// ---------------------------------------------------------------------------

let _downloadedIds = null;
let _cardObserver  = null;

function gmFetchIds() {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: `${API_BASE}/videos/ids`,
      onload: (res) => {
        try { resolve(new Set(JSON.parse(res.responseText).ids || [])); }
        catch (_) { resolve(new Set()); }
      },
      onerror: () => resolve(new Set()),
    });
  });
}

function extractVideoIdFromHref(href) {
  const m = href && href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function annotateCards(ids) {
  document
    .querySelectorAll("a.ytLockupMetadataViewModelTitle[href*='watch?v=']")
    .forEach(link => {
      const videoId = extractVideoIdFromHref(link.getAttribute("href"));
      if (!videoId || !ids.has(videoId)) return;

      const card = link.closest(
        "yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, " +
        "ytd-grid-video-renderer, ytd-compact-video-renderer"
      ) || link.parentElement;
      if (!card || card.querySelector(`.${CARD_BADGE_CLASS}`)) return;

      const badge = document.createElement("div");
      badge.className = CARD_BADGE_CLASS;
      badge.textContent = "✓ In Vault";

      const thumb = card.querySelector(
        "a.ytLockupViewModelContentImage, yt-thumbnail-view-model, " +
        "yt-lockup-thumbnail, ytd-thumbnail, yt-image, a#thumbnail"
      );

      if (thumb) {
        if (getComputedStyle(thumb).position === "static") {
          thumb.style.position = "relative";
        }
        badge.style.cssText = [
          "position:absolute",
          "top:6px",
          "left:6px",
          "z-index:10",
          "padding:2px 8px",
          "background:#2e7d32dd",
          "color:#ffeb3b",
          "font-size:11px",
          "font-weight:700",
          "border-radius:3px",
          "pointer-events:none",
          "font-family:system-ui,sans-serif",
          "line-height:1.6",
        ].join(";");
        thumb.appendChild(badge);
      } else {
        const h3 = link.closest("h3") || link.parentElement;
        badge.style.cssText = [
          "display:inline-block",
          "margin-left:6px",
          "padding:1px 6px",
          "background:#2e7d32",
          "color:#ffeb3b",
          "font-size:10px",
          "font-weight:700",
          "border-radius:3px",
          "vertical-align:middle",
          "font-family:system-ui,sans-serif",
          "line-height:1.6",
        ].join(";");
        (h3 || link).insertAdjacentElement("afterend", badge);
      }
    });
}

function stopCardObserver() {
  if (_cardObserver) { _cardObserver.disconnect(); _cardObserver = null; }
}

async function initCardAnnotation() {
  stopCardObserver();
  _downloadedIds = await gmFetchIds();
  if (_downloadedIds.size === 0) return;

  annotateCards(_downloadedIds);

  _cardObserver = new MutationObserver(() => annotateCards(_downloadedIds));
  _cardObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// YouTube SPA navigation
// ---------------------------------------------------------------------------

function onNavigate() {
  checkAndAnnotate();
  initCardAnnotation();
}

window.addEventListener("yt-navigate-finish", onNavigate);
onNavigate();
