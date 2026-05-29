// ==UserScript==
// @name         ChannelVault
// @namespace    https://creativetrnd.com
// @version      1.0.0
// @description  Shows a badge on YouTube videos you've downloaded locally via ChannelVault
// @author       TRND
// @match        https://www.youtube.com/*
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

const API_BASE = "http://localhost:5000";
const BADGE_ID = "channelvault-badge";

GM_addStyle(`
  #${BADGE_ID} {
    display: inline-flex;
    align-items: center;
    margin-left: 10px;
    padding: 3px 10px;
    background: #2e7d32;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    border-radius: 4px;
    vertical-align: middle;
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

function injectBadge() {
  if (document.getElementById(BADGE_ID)) return;

  const titleEl =
    document.querySelector("h1.ytd-video-primary-info-renderer") ||
    document.querySelector("ytd-video-primary-info-renderer h1") ||
    document.querySelector("#above-the-fold #title h1");

  if (!titleEl) return;

  const badge = document.createElement("span");
  badge.id = BADGE_ID;
  badge.textContent = "✓ Downloaded";
  titleEl.appendChild(badge);
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
// YouTube SPA navigation
// ---------------------------------------------------------------------------

window.addEventListener("yt-navigate-finish", checkAndAnnotate);
checkAndAnnotate();
