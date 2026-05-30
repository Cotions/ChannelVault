// ==UserScript==
// @name         ChannelVault
// @namespace    https://github.com/Cotions/channelvault
// @version      1.3.0
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

const API_BASE           = "http://localhost:3360";
const BADGE_ID           = "channelvault-badge";
const CARD_BADGE_CLASS   = "cv-card-badge";
const COLOR_DOWNLOADED   = "#2e7d32";
const COLOR_WANTED       = "#1565c0";
const COLOR_WANTED_TEXT  = "#90caf9";
const COLOR_IGNORED      = "#b71c1c";
const COLOR_IGNORED_TEXT = "#ef9a9a";

GM_addStyle(`
  ytd-watch-metadata #title,
  #above-the-fold #title {
    position: relative !important;
  }
  #${BADGE_ID} {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    background: #2e7d32;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    border-radius: 4px;
    line-height: 1.4;
    font-family: system-ui, sans-serif;
    z-index: 1;
    pointer-events: none;
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
let _wantedIds     = null;
let _ignoredIds    = null;
let _cardObserver  = null;

function gmFetchIds() {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: `${API_BASE}/videos/ids`,
      onload: (res) => {
        try {
          const data = JSON.parse(res.responseText);
          resolve({
            downloaded: new Set(data.ids || []),
            wanted:     new Set(data.wanted_ids || []),
            ignored:    new Set(data.ignored_ids || []),
          });
        }
        catch (_) { resolve({ downloaded: new Set(), wanted: new Set(), ignored: new Set() }); }
      },
      onerror: () => resolve({ downloaded: new Set(), wanted: new Set(), ignored: new Set() }),
    });
  });
}

function extractVideoIdFromHref(href) {
  const m = href && href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function annotateCards(downloaded, wanted, ignored) {
  document
    .querySelectorAll("a.ytLockupMetadataViewModelTitle[href*='watch?v=']")
    .forEach(link => {
      const videoId = extractVideoIdFromHref(link.getAttribute("href"));
      if (!videoId) return;

      const isDownloaded = downloaded.has(videoId);
      const isWanted     = !isDownloaded && wanted.has(videoId);
      const isIgnored    = !isDownloaded && !isWanted && ignored.has(videoId);
      if (!isDownloaded && !isWanted && !isIgnored) return;

      const card = link.closest(
        "yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, " +
        "ytd-grid-video-renderer, ytd-compact-video-renderer"
      ) || link.parentElement;
      if (!card || card.querySelector(`.${CARD_BADGE_CLASS}`)) return;

      let color, text, textColor;
      if (isDownloaded) { color = COLOR_DOWNLOADED; text = "✓ In Vault";  textColor = "#fff"; }
      else if (isWanted){ color = COLOR_WANTED;     text = "⬇ Wanted";    textColor = COLOR_WANTED_TEXT; }
      else              { color = COLOR_IGNORED;    text = "✕ Skip";       textColor = COLOR_IGNORED_TEXT; }

      link.style.color = color;

      const badge = document.createElement("div");
      badge.className = CARD_BADGE_CLASS;
      badge.textContent = text;

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
          `background:${color}dd`,
          `color:${textColor}`,
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
          `background:${color}`,
          `color:${textColor}`,
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
  const ids  = await gmFetchIds();
  _downloadedIds = ids.downloaded;
  _wantedIds     = ids.wanted;
  _ignoredIds    = ids.ignored;

  annotateCards(_downloadedIds, _wantedIds, _ignoredIds);

  _cardObserver = new MutationObserver(() => annotateCards(_downloadedIds, _wantedIds, _ignoredIds));
  _cardObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Menu injection — add CV items to the 3-dots dropdown
// ---------------------------------------------------------------------------

let _pendingMenuVideoId  = null;
let _pendingMenuVideoUrl = null;
let _pendingMenuTitle    = null;
let _pendingMenuChannel  = null;

function gmPost(url, body) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method:  "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data:    JSON.stringify(body),
      onload:  resolve,
      onerror: reject,
    });
  });
}

function el(tag, cls, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

function makeCVMenuItem(label, svgPath, onClick) {
  const ns = "http://www.w3.org/2000/svg";

  const item = el("yt-list-item-view-model", "ytListItemViewModelHost cv-menu-item", { role: "menuitem" });
  const wrapper = el("div", "ytListItemViewModelLayoutWrapper ytListItemViewModelContainer ytListItemViewModelCompact ytListItemViewModelTappable ytListItemViewModelInPopup ytListItemViewModelNoTrailingText");
  const main = el("div", "ytListItemViewModelMainContainer");

  // Icon
  const imgContainer = el("div", "ytListItemViewModelImageContainer ytListItemViewModelLeading");
  imgContainer.setAttribute("aria-hidden", "true");
  const iconSpan = el("span", "ytIconWrapperHost ytListItemViewModelAccessory ytListItemViewModelImage");
  iconSpan.setAttribute("role", "img");
  iconSpan.setAttribute("aria-hidden", "true");
  const iconInner = el("span", "yt-icon-shape ytSpecIconShapeHost");
  const iconDiv = el("div");
  iconDiv.style.cssText = "width:100%;height:100%;display:block;fill:currentcolor;";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("height", "24"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "24");
  svg.setAttribute("focusable", "false"); svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "pointer-events:none;display:inherit;width:100%;height:100%;";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", svgPath);
  svg.appendChild(path);
  iconDiv.appendChild(svg);
  iconInner.appendChild(iconDiv);
  iconSpan.appendChild(iconInner);
  imgContainer.appendChild(iconSpan);

  // Button
  const btn = el("button", "ytButtonOrAnchorHost ytButtonOrAnchorButton ytListItemViewModelButtonOrAnchor");
  const textWrapper = el("div", "ytListItemViewModelTextWrapper");
  const titleWrapper = el("div", "ytListItemViewModelTitleWrapper");
  const span = el("span", "ytAttributedStringHost ytListItemViewModelTitle ytAttributedStringWhiteSpacePreWrap");
  span.setAttribute("role", "text");
  span.textContent = label;
  titleWrapper.appendChild(span);
  textWrapper.appendChild(titleWrapper);
  btn.appendChild(textWrapper);
  btn.addEventListener("click", onClick);

  main.appendChild(imgContainer);
  main.appendChild(btn);
  wrapper.appendChild(main);
  item.appendChild(wrapper);
  return item;
}

function injectCVMenuItems(container) {
  // Remove stale items from previous open (YouTube reuses this node)
  container.querySelectorAll(".cv-menu-item").forEach(el => el.remove());

  const listView = container.querySelector("yt-list-view-model");
  console.log("[CV] injectCVMenuItems listView=", listView, "videoId=", _pendingMenuVideoId);
  if (!listView) return;

  const videoId  = _pendingMenuVideoId;
  const videoUrl = _pendingMenuVideoUrl;
  const title    = _pendingMenuTitle;
  const channel  = _pendingMenuChannel;
  if (!videoId) return;

  // Remove max-height so injected items aren't clipped
  const sheet = container.closest("yt-sheet-view-model");
  if (sheet) sheet.style.maxHeight = "none";

  const wantItem = makeCVMenuItem(
    "⬇ Add to Vault Wishlist",
    "M12 2a1 1 0 00-1 1v11.586l-4.293-4.293a1 1 0 10-1.414 1.414L12 18.414l6.707-6.707a1 1 0 10-1.414-1.414L13 14.586V3a1 1 0 00-1-1Zm7 18H5a1 1 0 000 2h14a1 1 0 000-2Z",
    async (e) => {
      e.stopPropagation();
      try {
        await gmPost(`${API_BASE}/want-to-download`, { video_id: videoId, url: videoUrl, title, channel_name: channel });
        const ids = await gmFetchIds();
        _downloadedIds = ids.downloaded; _wantedIds = ids.wanted; _ignoredIds = ids.ignored;
        annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
      } catch (_) {}
    }
  );

  const skipItem = makeCVMenuItem(
    "✕ Not Interested",
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    async (e) => {
      e.stopPropagation();
      try {
        await gmPost(`${API_BASE}/do-not-want`, { video_id: videoId, url: videoUrl, title, channel_name: channel });
        const ids = await gmFetchIds();
        _downloadedIds = ids.downloaded; _wantedIds = ids.wanted; _ignoredIds = ids.ignored;
        annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
      } catch (_) {}
    }
  );

  listView.appendChild(wantItem);
  listView.appendChild(skipItem);
}

function captureMenuContext(btn) {
  const card = btn.closest(
    "yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, " +
    "ytd-grid-video-renderer, ytd-compact-video-renderer"
  );
  if (!card) return;
  const link = card.querySelector("a.ytLockupMetadataViewModelTitle[href*='watch?v=']");
  if (!link) return;
  const videoId = extractVideoIdFromHref(link.getAttribute("href"));
  if (!videoId) return;
  _pendingMenuVideoId  = videoId;
  _pendingMenuVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  _pendingMenuTitle    = link.textContent.trim() || null;
  _pendingMenuChannel  = card.querySelector(
    "a.ytLockupMetadataViewModelSubtitle, .ytLockupMetadataViewModelChannelName, " +
    "ytd-channel-name a, .ytd-channel-name a"
  )?.textContent.trim() || null;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".ytLockupMetadataViewModelMenuButton button");
  if (!btn) return;
  console.log("[CV] 3-dots clicked, btn=", btn);
  captureMenuContext(btn);
  console.log("[CV] pending videoId=", _pendingMenuVideoId);
  setTimeout(() => {
    const container = document.querySelector(".ytContextualSheetLayoutContentContainer");
    console.log("[CV] container found=", container, "listView=", container?.querySelector("yt-list-view-model"));
    if (container) injectCVMenuItems(container);
  }, 80);
}, true);

// ---------------------------------------------------------------------------
// YouTube SPA navigation
// ---------------------------------------------------------------------------

function onNavigate() {
  checkAndAnnotate();
  initCardAnnotation();
}

window.addEventListener("yt-navigate-finish", onNavigate);
onNavigate();
