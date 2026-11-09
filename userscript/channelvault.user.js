// ==UserScript==
// @name         ChannelVault
// @namespace    https://github.com/Cotions/channelvault
// @version      1.14.0
// @description  Shows a badge on YouTube videos you've downloaded locally via ChannelVault
// @author       Cotions
// @match        https://www.youtube.com/*
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    http://localhost:3360/userscript/channelvault.user.js
// @downloadURL  http://localhost:3360/userscript/channelvault.user.js
// ==/UserScript==

const API_BASE           = "http://localhost:3360";
// Backend denies every API call without this header. Ordinary web pages cannot
// attach a custom header cross-origin; this privileged script can.
const CV_HEADERS         = { "X-ChannelVault": "1" };
const BADGE_ID           = "channelvault-badge";
const CARD_BADGE_CLASS   = "cv-card-badge";
const COLOR_DOWNLOADED   = "#2e7d32";
const COLOR_WANTED       = "#1565c0";
const COLOR_WANTED_TEXT  = "#90caf9";
const COLOR_IGNORED      = "#b71c1c";
const COLOR_IGNORED_TEXT = "#ef9a9a";
function makeVaultIcon(size) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "flex-shrink:0;margin-right:4px;vertical-align:middle;display:inline-block;fill:currentColor;";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M20 3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14zm-8-2c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0-6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm5-4h2v2h-2zm0 8h2v2h-2z");
  svg.appendChild(path);
  return svg;
}

GM_addStyle(`
  /* The title text sits in child elements that set their own color. */
  a.cv-title-downloaded, a.cv-title-downloaded:visited, a.cv-title-downloaded :not(.cv-card-badge) { color: #2e7d32 !important; }
  a.cv-title-wanted, a.cv-title-wanted:visited, a.cv-title-wanted :not(.cv-card-badge)             { color: #1565c0 !important; }
  a.cv-title-ignored, a.cv-title-ignored:visited, a.cv-title-ignored :not(.cv-card-badge)          { color: #b71c1c !important; }
  ytd-watch-metadata #title,
  #above-the-fold #title {
    position: relative !important;
  }
  ytd-menu-popup-renderer {
    max-height: none !important;
    max-width: none !important;
    min-width: 180px !important;
    overflow: visible !important;
  }
  div.cv-menu-item {
    display: flex !important;
    align-items: center !important;
    padding: 0 16px !important;
    min-height: 36px !important;
    cursor: pointer !important;
    gap: 16px !important;
    box-sizing: border-box !important;
    color: var(--yt-spec-text-primary, inherit) !important;
    overflow: hidden !important;
  }
  div.cv-menu-item:hover {
    background: var(--yt-spec-10-percent-layer, rgba(0,0,0,0.08)) !important;
  }
  div.cv-menu-item .cv-icon {
    flex-shrink: 0 !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 4px !important;
    color: inherit !important;
  }
  div.cv-menu-item .cv-label {
    color: inherit !important;
    font-size: 14px !important;
    font-family: Roboto, Arial, sans-serif !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
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
    /* bg/color overridden inline per status */
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
  if (params.get("v")) return params.get("v");
  const m = window.location.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function onShortsPage() {
  return window.location.pathname.startsWith("/shorts/");
}

function removeBadge() {
  const el = document.getElementById(BADGE_ID);
  if (el) el.remove();
}

function colorTitle(color) {
  const titleEl =
    document.querySelector("ytd-watch-metadata h1 yt-formatted-string") ||
    document.querySelector("ytd-watch-metadata h1") ||
    document.querySelector("#above-the-fold h1 yt-formatted-string") ||
    document.querySelector("#title h1 yt-formatted-string") ||
    document.querySelector("#title h1");
  if (!titleEl) return;
  titleEl.style.color = color || "";
}

function injectBadge(text, bg, fg) {
  document.getElementById(BADGE_ID)?.remove();

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
  badge.style.background = bg;
  badge.style.color = fg;
  badge.appendChild(document.createTextNode(text));
  titleEl.insertAdjacentElement("afterend", badge);
}

// ---------------------------------------------------------------------------
// GM_xmlhttpRequest wrappers (privileged: not bound by CORS, so the backend
// sends no CORS headers at all)
// ---------------------------------------------------------------------------

function gmFetch(url) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      headers: CV_HEADERS,
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
// Main check
// ---------------------------------------------------------------------------

async function checkAndAnnotate() {
  removeBadge();
  colorTitle(false);
  const videoId = getVideoId();
  // The Shorts player has no title to badge; its tiles elsewhere get one.
  if (!videoId || onShortsPage()) return;

  let status = null;
  try {
    const data = await gmFetch(`${API_BASE}/check-video/${videoId}`);
    status = data.status;
  } catch (_) {
    return;
  }
  // YouTube is a single-page app: by the time the answer arrives the user may
  // be on another video. Don't paint this one's badge on that one.
  if (getVideoId() !== videoId) return;

  if (status === "downloaded") {
    waitForTitle(() => { injectBadge("✓ In Vault", COLOR_DOWNLOADED, "#fff"); colorTitle(COLOR_DOWNLOADED); });
  } else if (status === "wanted") {
    waitForTitle(() => { injectBadge("⬇ Wanted", COLOR_WANTED, COLOR_WANTED_TEXT); colorTitle(COLOR_WANTED); });
  } else if (status === "ignored") {
    waitForTitle(() => { injectBadge("✕ Ignored", COLOR_IGNORED, COLOR_IGNORED_TEXT); colorTitle(COLOR_IGNORED); });
  }
}

function waitForTitle(cb, attempts = 0, videoId = getVideoId()) {
  // Retries span ~6s; the user may have moved to another video meanwhile.
  if (getVideoId() !== videoId) return;
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
    setTimeout(() => waitForTitle(cb, attempts + 1, videoId), 300);
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
      headers: CV_HEADERS,
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
  const m = href && href.match(/(?:[?&]v=|^\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

const CARD_SELECTOR =
  "yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, " +
  "ytd-grid-video-renderer, ytd-compact-video-renderer";

// Every video tile on the page, whatever YouTube draws it with: the newer
// lockups (home, channel pages, watch sidebar), the classic renderers (search
// results), and Shorts tiles. Each comes as its title link plus the card.
// A tile that isn't one video (a playlist or mix, which links to its first
// video) comes with videoId null, so a badge left from a recycled card goes.
function findCards() {
  const out = [], cards = new Set();
  const add = (link, card) => {
    if (!card || cards.has(card)) return;     // one title per card
    cards.add(card);
    const href = link.getAttribute("href") || "";
    out.push({ link, card, videoId: href.includes("list=") ? null : extractVideoIdFromHref(href) });
  };
  document.querySelectorAll(
    "a.ytLockupMetadataViewModelTitle[href*='watch?v='], " +
    "a#video-title[href*='watch?v='], a#video-title-link[href*='watch?v=']"
  ).forEach(link => add(link, link.closest(CARD_SELECTOR) || link.parentElement));
  document.querySelectorAll("ytm-shorts-lockup-view-model").forEach(card => {
    const link = card.querySelector("a.shortsLockupViewModelHostOutsideMetadataEndpoint[href^='/shorts/']") ||
                 card.querySelector("a[href^='/shorts/']");
    if (link) add(link, card);
  });
  return out;
}

function annotateCards(downloaded, wanted, ignored) {
  findCards().forEach(({ link, card, videoId }) => {
      const isDownloaded = downloaded.has(videoId);
      const isWanted     = !isDownloaded && wanted.has(videoId);
      const isIgnored    = !isDownloaded && !isWanted && ignored.has(videoId);
      const mark = isDownloaded ? "downloaded" : isWanted ? "wanted" : isIgnored ? "ignored" : "";

      // YouTube reuses card elements for other videos: a badge is only kept
      // when it still describes this card's video and mark.
      const old = card.querySelector(`.${CARD_BADGE_CLASS}`);
      if (old && old.dataset.cvKey === `${videoId}:${mark}`) return;
      if (old) {
        old.remove();
        card.querySelectorAll(".cv-title-downloaded, .cv-title-wanted, .cv-title-ignored")
          .forEach(a => a.classList.remove("cv-title-downloaded", "cv-title-wanted", "cv-title-ignored"));
      }
      if (!mark || !videoId) return;

      let color, text, textColor;
      if (isDownloaded) { color = COLOR_DOWNLOADED; text = "✓ In Vault";  textColor = "#fff"; }
      else if (isWanted){ color = COLOR_WANTED;     text = "⬇ Wanted";    textColor = COLOR_WANTED_TEXT; }
      else              { color = COLOR_IGNORED;    text = "✕ Ignored";       textColor = COLOR_IGNORED_TEXT; }

      const cvClass = isDownloaded ? "cv-title-downloaded" : isWanted ? "cv-title-wanted" : "cv-title-ignored";
      link.classList.add(cvClass);

      const badge = document.createElement("div");
      badge.className = CARD_BADGE_CLASS;
      badge.dataset.cvKey = `${videoId}:${mark}`;
      badge.appendChild(document.createTextNode(text));

      const thumb = card.querySelector(
        "a.ytLockupViewModelContentImage, yt-thumbnail-view-model, " +
        "yt-lockup-thumbnail, ytd-thumbnail, a.reel-item-endpoint, yt-image, a#thumbnail"
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

let _cardGeneration = 0;

async function initCardAnnotation() {
  stopCardObserver();
  // A newer navigation may start while this fetch is in flight; only the
  // latest call may install an observer, so they never pile up.
  const gen = ++_cardGeneration;
  const ids  = await gmFetchIds();
  if (gen !== _cardGeneration) return;
  stopCardObserver();
  _downloadedIds = ids.downloaded;
  _wantedIds     = ids.wanted;
  _ignoredIds    = ids.ignored;

  annotateCards(_downloadedIds, _wantedIds, _ignoredIds);

  // YouTube mutates the DOM constantly: annotate at most once per frame.
  let queued = false;
  _cardObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
    });
  });
  _cardObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Menu injection — add CV items to the 3-dots dropdown
// ---------------------------------------------------------------------------

let _pendingMenuVideoId  = null;
let _pendingMenuVideoUrl = null;
let _pendingMenuTitle    = null;
let _pendingMenuDuration = null;   // seconds, when the card or player shows it
let _pendingMenuChannel  = null;

function gmPost(url, body) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method:  "POST",
      url,
      // Backend rejects state-changing requests without this header. Random web
      // pages cannot attach a custom header cross-origin; this script can.
      headers: { "Content-Type": "application/json", ...CV_HEADERS },
      data:    JSON.stringify(body),
      // Only a 2xx with ok:true counts as saved; a refused write (403/400/500,
      // an HTML error page) must not show "Saved".
      onload:  (res) => {
        let data = null;
        try { data = JSON.parse(res.responseText); } catch (_) { /* not JSON */ }
        if (res.status >= 200 && res.status < 300 && data && data.ok !== false) resolve(data);
        else reject(new Error((data && data.error) || `HTTP ${res.status}`));
      },
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
  svg.setAttribute("fill", "currentColor");
  svg.style.cssText = "pointer-events:none;display:inherit;width:100%;height:100%;fill:currentColor;";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", svgPath);
  path.setAttribute("fill", "currentColor");
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

function closeMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
}

function injectCVMenuItems(container) {
  // Remove stale items from previous open (YouTube reuses this node)
  container.querySelectorAll(".cv-menu-item").forEach(el => el.remove());

  const listView = container.querySelector("yt-list-view-model");
  if (!listView) return;

  const videoId  = _pendingMenuVideoId;
  const videoUrl = _pendingMenuVideoUrl;
  const title    = _pendingMenuTitle;
  const duration_secs = _pendingMenuDuration;
  const channel  = _pendingMenuChannel;
  if (!videoId) return;

  // Remove max-height so injected items aren't clipped
  const sheet = container.closest("yt-sheet-view-model");
  if (sheet) sheet.style.maxHeight = "none";

  const wantItem = makeCVMenuItemPopup(
    "Wanted",
    "M12 2a1 1 0 00-1 1v11.586l-4.293-4.293a1 1 0 10-1.414 1.414L12 18.414l6.707-6.707a1 1 0 10-1.414-1.414L13 14.586V3a1 1 0 00-1-1Zm7 18H5a1 1 0 000 2h14a1 1 0 000-2Z",
    async (e) => {
      e.stopPropagation();
      closeMenu();
      try {
        await gmPost(`${API_BASE}/want-to-download`, { video_id: videoId, url: videoUrl, title, channel_name: channel, duration_secs });
        const ids = await gmFetchIds();
        _downloadedIds = ids.downloaded; _wantedIds = ids.wanted; _ignoredIds = ids.ignored;
        annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
      } catch (_) {}
    }
  );

  const skipItem = makeCVMenuItemPopup(
    "Ignored",
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    async (e) => {
      e.stopPropagation();
      closeMenu();
      try {
        await gmPost(`${API_BASE}/do-not-want`, { video_id: videoId, url: videoUrl, title, channel_name: channel, duration_secs });
        const ids = await gmFetchIds();
        _downloadedIds = ids.downloaded; _wantedIds = ids.wanted; _ignoredIds = ids.ignored;
        annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
      } catch (_) {}
    }
  );

  listView.appendChild(wantItem);
  listView.appendChild(skipItem);
  if (!_downloadedIds?.has(videoId)) {
    listView.appendChild(makeCVMenuItemPopup("Download", DOWNLOAD_PATH, downloadAction(videoId, title, channel)));
  }
}

// Queue the video in ChannelVault's download queue (yt-dlp on the user's own
// machine). The app shows the progress; here the badge turns Wanted→In Vault
// on the next refresh once it lands.
const DOWNLOAD_PATH = "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z";

function cvToast(text, bad) {
  document.querySelectorAll(".cv-toast").forEach(t => t.remove());
  const t = el("div", "cv-toast");
  t.textContent = text;
  t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;"
    + "padding:9px 16px;border-radius:8px;font:500 13px/1.3 Roboto,Arial,sans-serif;"
    + "box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none;"
    + (bad ? "background:#3a1416;color:#ffb3b5;" : "background:#0f2a1c;color:#9ff0bf;");
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function downloadAction(videoId, title, channel) {
  return async (e) => {
    e.stopPropagation();
    closeMenu();
    try {
      await gmPost(`${API_BASE}/downloads`, { video_id: videoId, title, channel_name: channel });
      cvToast("ChannelVault: download queued");
    } catch (err) {
      cvToast(`ChannelVault: ${err.message || "could not queue the download"}`, true);
    }
  };
}

const VAULT_PATH = "M20 3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14zm-8-2c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0-6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm5-4h2v2h-2zm0 8h2v2h-2z";

function makeMenuSvg(ns, d) {
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18"); svg.setAttribute("height", "18"); svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("fill", "currentColor");
  svg.style.cssText = "display:block;fill:currentColor;flex-shrink:0;";
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d); p.setAttribute("fill", "currentColor");
  svg.appendChild(p);
  return svg;
}

function makeCVMenuItemPopup(label, actionPath, onClick) {
  const ns = "http://www.w3.org/2000/svg";
  const item = el("div", "cv-menu-item");
  item.setAttribute("role", "menuitem");
  item.setAttribute("tabindex", "0");

  const iconWrap = el("span", "cv-icon");
  iconWrap.appendChild(makeMenuSvg(ns, VAULT_PATH));
  iconWrap.appendChild(makeMenuSvg(ns, actionPath));

  const textSpan = el("span", "cv-label");
  textSpan.textContent = label;

  item.appendChild(iconWrap);
  item.appendChild(textSpan);
  item.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  item.addEventListener("click", onClick);
  return item;
}

function injectCVMenuItemsPopup(popup) {
  popup.querySelectorAll(".cv-menu-item").forEach(el => el.remove());
  const videoId  = _pendingMenuVideoId;
  const videoUrl = _pendingMenuVideoUrl;
  const title    = _pendingMenuTitle;
  const duration_secs = _pendingMenuDuration;
  const channel  = _pendingMenuChannel;
  if (!videoId) return;
  // Inject into the listbox so items are inside the Polymer event/scroll context
  const target = popup.querySelector("tp-yt-paper-listbox") || popup;

  const wantItem = makeCVMenuItemPopup(
    "Wanted",
    "M12 2a1 1 0 00-1 1v11.586l-4.293-4.293a1 1 0 10-1.414 1.414L12 18.414l6.707-6.707a1 1 0 10-1.414-1.414L13 14.586V3a1 1 0 00-1-1Zm7 18H5a1 1 0 000 2h14a1 1 0 000-2Z",
    async (e) => {
      e.stopPropagation();
      closeMenu();
      try {
        await gmPost(`${API_BASE}/want-to-download`, { video_id: videoId, url: videoUrl, title, channel_name: channel, duration_secs });
        const ids = await gmFetchIds();
        _downloadedIds = ids.downloaded; _wantedIds = ids.wanted; _ignoredIds = ids.ignored;
        annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
      } catch (_) {}
    }
  );
  const skipItem = makeCVMenuItemPopup(
    "Ignored",
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    async (e) => {
      e.stopPropagation();
      closeMenu();
      try {
        await gmPost(`${API_BASE}/do-not-want`, { video_id: videoId, url: videoUrl, title, channel_name: channel, duration_secs });
        const ids = await gmFetchIds();
        _downloadedIds = ids.downloaded; _wantedIds = ids.wanted; _ignoredIds = ids.ignored;
        annotateCards(_downloadedIds, _wantedIds, _ignoredIds);
      } catch (_) {}
    }
  );
  target.appendChild(wantItem);
  target.appendChild(skipItem);
  if (!_downloadedIds?.has(videoId)) {
    target.appendChild(makeCVMenuItemPopup("Download", DOWNLOAD_PATH, downloadAction(videoId, title, channel)));
  }

  setTimeout(() => {
    popup.style.setProperty("max-width", "220px", "important");
    const drop = popup.closest("tp-yt-iron-dropdown");
    if (!drop) return;
    const rect = popup.getBoundingClientRect();
    const dropLeft  = parseFloat(drop.style.left) || 0;
    const dropTop   = parseFloat(drop.style.top)  || 0;
    const rightOver  = rect.right  - (window.innerWidth  - 8);
    const bottomOver = rect.bottom - (window.innerHeight - 8);
    if (rightOver  > 0) drop.style.left = (dropLeft - rightOver)  + "px";
    if (bottomOver > 0) drop.style.top  = (dropTop  - bottomOver) + "px";
  }, 100);
}

// A channel name never reads like a view/subscriber/time stat. The newer card
// layout shows the view count bare ("15K", "1.8K") next to a play icon.
function looksLikeStat(s) {
  return /\b(views?|subscribers?|watching|waiting|streamed|premieres?)\b/i.test(s)
      || /\bago\b/i.test(s)
      || /^\d[\d.,\s]*[KMB]?$/i.test(s);
}

// The page-side twin of an element: the userscript may run in an isolated
// world, where YouTube's own properties on its elements aren't visible.
function pageElement(el) {
  if (pageWin === window) return el;
  if (el.wrappedJSObject) return el.wrappedJSObject;
  el.setAttribute("data-cv-pick", "");
  try { return pageWin.document.querySelector("[data-cv-pick]") || el; }
  finally { el.removeAttribute("data-cv-pick"); }
}

// The channel name from the data YouTube drew the card with, which doesn't
// move when its markup and class names change. Newer lockups hold it as the
// first part of the first metadata row; classic renderers as the byline.
function channelFromCardData(card) {
  try {
    const el = pageElement(card);
    let lvm = el.componentProps && el.componentProps.data;
    if (typeof lvm === "function") lvm = lvm();          // newer lockups hand it out as a signal
    const d = el.data;
    if (!(lvm && lvm.metadata)) lvm = d && d.content && d.content.lockupViewModel;
    let name = null;
    if (lvm && lvm.metadata) {
      if (lvm.contentType && lvm.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
      const rows = lvm.metadata.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
      name = rows[0]?.metadataParts?.[0]?.text?.content;
    } else {
      const v = (d && d.content && d.content.videoRenderer) || d;
      name = (v && (v.ownerText || v.longBylineText || v.shortBylineText))?.runs?.[0]?.text;
    }
    name = (name || "").trim();
    return name && !looksLikeStat(name) ? name : null;
  } catch (_) {
    return null;   // page data out of reach
  }
}

function extractChannelFromCard(card) {
  // A channel-link anchor is the reliable source — try it first.
  const anchor = (card.querySelector("a[href*='/@'], a[href*='/channel/'], a[href*='/user/']")?.textContent || "").trim();
  if (anchor && !looksLikeStat(anchor)) return anchor;

  // Then the card's own data, which survives YouTube reshuffling its markup.
  const fromData = channelFromCardData(card);
  if (fromData) return fromData;

  // A channel's own Videos/Shorts/Live grid leaves the name off its cards:
  // they're all that channel's, so take the page's. Not on a watch page,
  // where the page's channel is the one playing, not the sidebar card's.
  if (!getVideoId()) {
    const page = channelFromPage();
    if (page && page.channel_name) return page.channel_name;
  }

  // Fallbacks: reject anything that reads like a stat row (was the "34K views" bug).
  const fallbacks = [
    card.querySelector("a.ytLockupMetadataViewModelSubtitle")?.textContent,
    card.querySelector(".ytLockupMetadataViewModelChannelName")?.textContent,
    card.querySelector("ytd-channel-name a")?.textContent,
    card.querySelector(".ytd-channel-name a")?.textContent,
    card.querySelector("#channel-name a")?.textContent,
    card.querySelector("yt-formatted-string.ytd-channel-name")?.textContent,
  ];
  const metaText = card.querySelector(".ytContentMetadataViewModelMetadataRow .ytContentMetadataViewModelMetadataText");
  if (metaText) fallbacks.push(metaText.firstChild?.nodeValue || metaText.textContent);

  for (const c of fallbacks) {
    const v = (c || "").trim();
    if (v && !looksLikeStat(v)) return v;
  }
  return null;
}

// "30:40" or "1:02:03" -> seconds.
function parseClock(t) {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec((t || "").trim());
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
}

// The length badge on a card's thumbnail. Read from the text, not class
// names: YouTube renames those, but the badge is always a bare clock.
function extractDurationFromCard(card) {
  const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const secs = parseClock(n.nodeValue);
    if (secs) return secs;
  }
  return null;
}

// The playing video's length, from the player's own data (an ad playing
// first would make the <video> element's length wrong).
function watchPageDuration(videoId) {
  try {
    const player = pageWin.document.getElementById("movie_player");
    const d = player && player.getPlayerResponse && player.getPlayerResponse()?.videoDetails;
    if (d && d.videoId === videoId && +d.lengthSeconds > 0) return +d.lengthSeconds;
  } catch (_) { /* page data out of reach */ }
  return null;
}

function captureMenuContext(btn) {
  // Never let a previous card's context leak into this menu.
  _pendingMenuVideoId = _pendingMenuVideoUrl = _pendingMenuTitle = _pendingMenuChannel = _pendingMenuDuration = null;
  const card = btn.closest(CARD_SELECTOR);
  if (!card) return;
  const link = card.querySelector(
    "a.ytLockupMetadataViewModelTitle[href*='watch?v='], " +
    "a#video-title[href*='watch?v='], a#video-title-link[href*='watch?v=']"
  );
  if (!link || link.getAttribute("href").includes("list=")) return;
  const videoId = extractVideoIdFromHref(link.getAttribute("href"));
  if (!videoId) return;
  _pendingMenuVideoId  = videoId;
  _pendingMenuVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  _pendingMenuTitle    = link.textContent.trim() || null;
  _pendingMenuChannel  = extractChannelFromCard(card);
  _pendingMenuDuration = extractDurationFromCard(card);
}

document.addEventListener("click", (e) => {
  const cardBtn = e.target.closest(".ytLockupMetadataViewModelMenuButton button");
  // Classic cards (search results) open the older popup menu.
  const classicBtn = !cardBtn && e.target.closest(
    "ytd-video-renderer #menu button, ytd-grid-video-renderer #menu button, ytd-compact-video-renderer #menu button"
  );
  // The overflow (⋯) button under the player. Matched by position as well as
  // by its English label, so the menu works in any YouTube UI language.
  const videoBtn = e.target.closest(
    "ytd-watch-metadata ytd-menu-renderer > yt-button-shape#button-shape button, " +
    "#button-shape button[aria-label='More actions']"
  );

  if (cardBtn) {
    captureMenuContext(cardBtn);
    setTimeout(() => {
      const container = document.querySelector(".ytContextualSheetLayoutContentContainer");
      if (container) injectCVMenuItems(container);
    }, 80);
  } else if (classicBtn) {
    captureMenuContext(classicBtn);
    if (!_pendingMenuVideoId) return;
    setTimeout(() => {
      const popup = document.querySelector("ytd-menu-popup-renderer");
      if (popup) injectCVMenuItemsPopup(popup);
    }, 80);
  } else if (videoBtn && !onShortsPage()) {
    _pendingMenuVideoId = _pendingMenuVideoUrl = _pendingMenuTitle = _pendingMenuChannel = _pendingMenuDuration = null;
    const videoId = getVideoId();
    if (!videoId) return;
    _pendingMenuVideoId  = videoId;
    _pendingMenuVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    _pendingMenuTitle    = document.querySelector(
      "ytd-watch-metadata h1 yt-formatted-string, #above-the-fold h1 yt-formatted-string"
    )?.textContent.trim() || null;
    // The player's own record of the video first: it names the channel even
    // when the page around it is an age gate or a changed layout.
    _pendingMenuChannel  = channelFromPage()?.channel_name || document.querySelector(
      "#owner ytd-channel-name a, " +
      "ytd-video-owner-renderer ytd-channel-name a, " +
      "#upload-info ytd-channel-name a, " +
      "ytd-channel-name a, " +
      "#channel-name a"
    )?.textContent.trim() || null;
    _pendingMenuDuration = watchPageDuration(videoId);
    setTimeout(() => {
      const popup = document.querySelector("ytd-menu-popup-renderer");
      if (popup) injectCVMenuItemsPopup(popup);
    }, 80);
  } else {
    // Any other menu (comments, playlists, Shorts) may reuse the popup: it
    // must not keep Wanted/Skipped bound to the last video's id.
    _pendingMenuVideoId = null;
    setTimeout(() => document.querySelectorAll("ytd-menu-popup-renderer .cv-menu-item").forEach(x => x.remove()), 80);
  }
}, true);

// ---------------------------------------------------------------------------
// Creator capture — "About this channel" panel
// ---------------------------------------------------------------------------

GM_addStyle(`
  .cv-save-creator {
    font-family: "Roboto","Arial",sans-serif;
    font-size: 1.4rem; font-weight: 500;
    color: #fff; background: #2e7d32;
    border: none; border-radius: 18px;
    padding: 0 16px; height: 36px; line-height: 36px;
    margin-right: 8px; cursor: pointer; white-space: nowrap;
  }
  .cv-save-creator:hover { background: #388e3c; }
  .cv-save-creator:disabled { opacity: .7; cursor: default; }
  .cv-save-creator.cv-saved { background: #1b5e20; }
`);

// Count multipliers as YouTube abbreviates them across UI languages.
const COUNT_MULTIPLIERS = {
  k: 1e3, tsd: 1e3, mil: 1e3, tys: 1e3, "тыс": 1e3, "千": 1e3, "万": 1e4, "億": 1e8,
  m: 1e6, mio: 1e6, mln: 1e6, mn: 1e6, mi: 1e6, "млн": 1e6,
  b: 1e9, md: 1e9, mrd: 1e9, mld: 1e9, "млрд": 1e9,
};

// Locale-aware: "1.2K", "1,2 k", "1.234", "12 345 678", "1,2 Mio." all parse.
// Returns null when the number is ambiguous so a stored value isn't replaced
// with a wrong one.
function parseAbbrevCount(text) {
  if (!text) return null;
  const m = text.match(/\d+(?:[.,'\u00a0\u202f\u2009 ]\d+)*/);
  if (!m) return null;
  const word = (text.slice(m.index + m[0].length).trim().match(/^[^\s\d.,]+/) || [""])[0];
  const mult = COUNT_MULTIPLIERS[word.replace(/\.$/, "").toLowerCase()] || 1;

  let num = m[0].replace(/['\u00a0\u202f\u2009 ]/g, "");
  const seps = num.match(/[.,]/g) || [];
  if (seps.length) {
    const last = num.lastIndexOf(seps[seps.length - 1]);
    const tail = num.slice(last + 1);
    const mixed = new Set(seps).size > 1;
    // One kind repeated, or a lone separator before 3 digits with no
    // multiplier, groups thousands; otherwise the last one is the decimal point.
    const grouping = !mixed && (seps.length > 1 || (mult === 1 && tail.length === 3));
    num = grouping
      ? num.replace(/[.,]/g, "")
      : num.slice(0, last).replace(/[.,]/g, "") + "." + tail;
  }
  const n = parseFloat(num);
  if (!Number.isFinite(n)) return null;
  // A fraction without a known multiplier means an unknown abbreviation.
  if (mult === 1 && !Number.isInteger(n)) return null;
  return Math.round(n * mult);
}

function scrapeCreator(renderer) {
  const dialog = renderer.closest("ytd-engagement-panel-section-list-renderer") || document;
  const name = (dialog.querySelector("#title-text, h2#title")?.textContent || "").trim();
  const description = (renderer.querySelector("#description-container")?.textContent || "").trim();

  const data = {
    channel_name: name,
    description: description || null,
    country: null, joined_date: null,
    subscriber_count: null, subscribers_text: null,
    video_count: null, total_views: null,
    handle: null, channel_url: null, email: null,
    links: [],
  };

  renderer.querySelectorAll("tr.description-item").forEach((tr) => {
    if (tr.hidden) return;
    const icon  = tr.querySelector("yt-icon")?.getAttribute("icon") || "";
    const valTd = tr.querySelector("td:last-child");
    const text  = (valTd?.textContent || "").trim();
    switch (icon) {
      case "privacy_public": data.country = text || null; break;
      case "info_outline":   data.joined_date = text.replace(/^Joined\s+/i, "") || null; break;
      case "person_radar":
        data.subscribers_text = text || null;
        data.subscriber_count = parseAbbrevCount(text);
        break;
      case "my_videos":  data.video_count = parseAbbrevCount(text); break;
      case "trending_up": data.total_views = parseAbbrevCount(text); break;
      case "youtube": {
        const a = tr.querySelector("a");
        const href = a?.getAttribute("href") || a?.textContent || "";
        if (href) data.channel_url = href.startsWith("http") ? href : "https://" + href.replace(/^\/+/, "");
        const hm = href.match(/@[\w.-]+/);
        if (hm) data.handle = hm[0];
        break;
      }
      case "mail": {
        const a = tr.querySelector("a#email, a[href^='mailto']");
        const v = (a?.textContent || a?.getAttribute("href") || "").replace(/^mailto:/, "").trim();
        if (v) data.email = v;
        break;
      }
    }
  });

  renderer.querySelectorAll("#link-list-container a, #links-container a").forEach((a) => {
    const url = a.getAttribute("href");
    if (!url) return;
    data.links.push({ title: (a.textContent || "").trim() || url, url });
  });

  return data;
}

function injectCreatorButton() {
  document.querySelectorAll("ytd-about-channel-renderer").forEach((renderer) => {
    if (renderer.querySelector(".cv-save-creator")) return;
    const container = renderer.querySelector("#button-container");
    if (!container) return;
    const btn = document.createElement("button");
    btn.className = "cv-save-creator";
    btn.type = "button";
    btn.textContent = "Save to Vault";
    btn.addEventListener("click", async () => {
      const data = scrapeCreator(renderer);
      if (!data.channel_name) { btn.textContent = "No name found"; return; }
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        await gmPost(`${API_BASE}/creator`, data);
        btn.textContent = "✓ Saved to Vault";
        btn.classList.add("cv-saved");
        // YouTube reuses this panel for the next channel's About: the button
        // must come back usable, not stay on "Saved".
        setTimeout(() => {
          btn.textContent = "Save to Vault";
          btn.classList.remove("cv-saved");
          btn.disabled = false;
        }, 3000);
      } catch (_) {
        btn.textContent = "Save failed";
        btn.disabled = false;
      }
    });
    container.insertBefore(btn, container.firstChild);
  });
}

let _creatorScheduled = false;
function scheduleCreatorInject() {
  if (_creatorScheduled) return;
  _creatorScheduled = true;
  requestAnimationFrame(() => { _creatorScheduled = false; injectCreatorButton(); });
}
new MutationObserver(scheduleCreatorInject).observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------------------
// Channel ids — the dashboard's Inbox follows a channel's uploads through its
// public feed, which is keyed by the channel's YouTube id ("UC…"). The backend
// never loads YouTube pages itself; it learns ids from the pages you open here.
// ---------------------------------------------------------------------------

const pageWin = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
let _lastChannelReport = "";

// YouTube hands every in-app navigation's data to this event: the player
// response on a watch page, the channel metadata on a channel page.
function channelFromNavigate(detail) {
  try {
    const r  = detail && detail.response;
    const vd = r && r.playerResponse && r.playerResponse.videoDetails;
    if (vd && vd.channelId && vd.videoId === getVideoId()) {
      return { channel_id: vd.channelId, video_id: vd.videoId, channel_name: vd.author };
    }
    const cm = r && r.response && r.response.metadata && r.response.metadata.channelMetadataRenderer;
    if (cm && cm.externalId) return { channel_id: cm.externalId, channel_name: cm.title };
  } catch (_) { /* page data out of reach (sandbox): the fallback below covers it */ }
  return null;
}

// First page load, or a sandbox that can't read the event: ask the page.
// Meta tags are not used: they keep the first page's values across navigation.
function channelFromPage() {
  try {
    const videoId = getVideoId();
    if (videoId) {
      const player = pageWin.document.getElementById("movie_player");
      const vd = player && player.getPlayerResponse && player.getPlayerResponse();
      const d  = vd && vd.videoDetails;
      if (d && d.channelId && d.videoId === videoId) {
        return { channel_id: d.channelId, video_id: videoId, channel_name: d.author };
      }
      return null;
    }
    const browse = pageWin.document.querySelector("ytd-browse[page-subtype='channels']");
    const cm = browse && browse.data && browse.data.metadata && browse.data.metadata.channelMetadataRenderer;
    if (cm && cm.externalId) return { channel_id: cm.externalId, channel_name: cm.title };
  } catch (_) { /* nothing to report */ }
  return null;
}

function reportChannel(info) {
  if (!info || !/^UC[A-Za-z0-9_-]{22}$/.test(info.channel_id || "")) return;
  const key = `${info.channel_id}:${info.video_id || ""}`;
  if (key === _lastChannelReport) return;
  _lastChannelReport = key;
  gmPost(`${API_BASE}/channel-id`, {
    channel_id:   info.channel_id,
    video_id:     info.video_id || null,
    channel_name: info.channel_name || null,
  }).catch(() => { _lastChannelReport = ""; });
}

// ---------------------------------------------------------------------------
// Channel scan — on a channel's Videos / Shorts / Live tab, one click scrolls
// the grid to its end (the page loading its own next batches, as a user
// scrolling would) and sends every tile's id, title and view count to the vault.
// The vault keeps every link, updates view counts and checks whether its videos of that
// channel that weren't on the tab still exist.
// ---------------------------------------------------------------------------

const SCAN_TAB_RE = /^\/(?:@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)\/(videos|shorts|streams)\/?$/;
const SCAN_BTN_ID = "cv-scan-btn";
const SCAN_PANEL_ID = "cv-scan-panel";
let _scan = null;          // { stop: bool } while a scan runs
// YouTube keeps earlier pages' grids in the DOM, hidden.
const ACTIVE_GRID = "ytd-browse:not([hidden]) ytd-rich-grid-renderer";

GM_addStyle(`
  #${SCAN_BTN_ID} {
    position: fixed; right: 24px; bottom: 24px; z-index: 9999;
    font: 500 13px/1 Roboto, Arial, sans-serif; color: #fff; background: #2e7d32;
    border: none; border-radius: 18px; padding: 11px 16px; cursor: pointer;
    box-shadow: 0 6px 20px rgba(0,0,0,.4);
  }
  #${SCAN_BTN_ID}:hover { background: #388e3c; }
  #${SCAN_BTN_ID}.cv-running { background: #1b5e20; }
  #${SCAN_PANEL_ID} {
    position: fixed; right: 24px; bottom: 72px; z-index: 9999; width: 340px; max-height: 50vh; overflow: auto;
    font: 400 13px/1.45 Roboto, Arial, sans-serif; color: #e6f4ea; background: #0f2a1c;
    border-radius: 10px; padding: 12px 14px; box-shadow: 0 6px 20px rgba(0,0,0,.45);
  }
  #${SCAN_PANEL_ID} b { color: #9ff0bf; font-weight: 500; }
  #${SCAN_PANEL_ID} .cv-bad { color: #ffb3b5; }
  #${SCAN_PANEL_ID} ul { margin: 4px 0 8px 18px; padding: 0; }
  #${SCAN_PANEL_ID} a { color: inherit; }
  #${SCAN_PANEL_ID} .cv-close { float: right; cursor: pointer; opacity: .7; margin-left: 8px; }
`);

function scanTab() {
  const m = window.location.pathname.match(SCAN_TAB_RE);
  return m ? m[1] : null;
}

// The view count of one grid tile, from the data YouTube drew it with: the
// newer layout shows a bare "918K" next to a play icon, so the text alone
// can't be told apart from other numbers in the row.
function tileFromData(d) {
  const c = d && d.content;
  const lvm = c && c.lockupViewModel;
  if (lvm) {
    if (lvm.contentType && lvm.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
    const rows = lvm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
    const parts = rows.flatMap(r => r.metadataParts || []);
    const part = parts.find(p => p.leadingIcon && /\d/.test(p.text?.content || "")) ||
                 parts.find(p => /view/i.test(p.accessibilityLabel || p.text?.content || ""));
    return { video_id: lvm.contentId, views: part ? parseAbbrevCount(part.text?.content) : null,
             title: lvm.metadata?.lockupMetadataViewModel?.title?.content || null };
  }
  const s = c && c.shortsLockupViewModel;
  if (s) {
    const id = s.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
               (s.entityId || "").replace(/^shorts-shelf-item-/, "");
    return { video_id: id, views: parseAbbrevCount(s.overlayMetadata?.secondaryText?.content),
             title: s.overlayMetadata?.primaryText?.content || null };
  }
  return null;
}

function collectTiles() {
  const out = new Map();
  pageWin.document.querySelectorAll(`${ACTIVE_GRID} ytd-rich-item-renderer`).forEach(r => {
    let t = null;
    try { t = tileFromData(r.data); } catch (_) { /* page data out of reach */ }
    // Fallback without page data: the id from the link, no count.
    if (!t) {
      const a = r.querySelector("a[href*='watch?v='], a[href^='/shorts/']");
      const id = a && extractVideoIdFromHref(a.getAttribute("href"));
      if (id) t = { video_id: id, views: null, title: (a.getAttribute("title") || a.textContent || "").trim() || null };
    }
    if (t && /^[\w-]{11}$/.test(t.video_id || "") && !out.has(t.video_id)) out.set(t.video_id, t);
  });
  return [...out.values()];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Scroll until the grid stops offering more. True when it reached the end.
async function loadWholeGrid(state, onProgress) {
  const grid = () => document.querySelector(ACTIVE_GRID);
  const path = window.location.pathname;
  let last = -1, stuck = 0;
  while (!state.stop && window.location.pathname === path) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(1200);
    const g = grid();
    const n = g ? g.querySelectorAll("ytd-rich-item-renderer").length : 0;
    onProgress(n);
    const more = g && g.querySelector("ytd-continuation-item-renderer");
    if (n === last) {
      stuck++;
      if (!more && stuck >= 2) return true;
      if (stuck >= 12) return false;          // still a spinner after ~15 s
    } else {
      stuck = 0;
      last = n;
    }
  }
  return false;
}

function showScanResult(r, tab) {
  document.getElementById(SCAN_PANEL_ID)?.remove();
  const p = el("div", null, { id: SCAN_PANEL_ID });
  const close = el("span", "cv-close");
  close.textContent = "✕";
  close.addEventListener("click", () => p.remove());
  p.appendChild(close);
  const line = (text, cls) => { const d = el("div", cls); d.textContent = text; p.appendChild(d); return d; };
  const title = el("b");
  title.textContent = `Vault sync — ${tab}`;
  p.appendChild(title);
  line(`${r.seen} on this tab · ${r.in_vault} in vault · ${r.updated} view counts updated`);
  if (r.kept) line(`${r.kept} links kept` + (r.gone ? ` · ${r.gone} no longer on this tab (link kept, marked gone)` : ""));
  if (r.restored) line(`${r.restored} marked available again (they're on the channel)`);
  if (!r.complete) {
    line("Didn't reach the end of the tab (or couldn't read the channel id): missing-video check skipped.");
  } else if (!r.artist) {
    line("This channel isn't linked to an artist in the vault yet: missing-video check skipped.");
  } else {
    line(`${r.missing} of ${r.artist}'s vault videos aren't on this tab` +
         (r.missing ? ` — checked ${r.checked}, ${r.still_up} still up (unlisted, other tab or channel)` : ""));
    const list = (label, items, cls) => {
      if (!items.length) return;
      line(label, cls);
      const ul = el("ul");
      items.forEach(v => {
        const li = el("li");
        const a = el("a", null, { href: `/watch?v=${v.video_id}`, target: "_blank" });
        a.textContent = v.title || v.video_id;
        li.appendChild(a);
        ul.appendChild(li);
      });
      p.appendChild(ul);
    };
    list(`Gone from YouTube, marked Deleted (${r.deleted.length}):`, r.deleted, "cv-bad");
    list(`Private or embed-blocked (${r.not_public.length}) — card fetch tells which:`, r.not_public);
    if (r.missing > r.checked) line(`${r.missing - r.checked} left unchecked; scan again to check more.`);
  }
  document.body.appendChild(p);
}

async function runScan(btn) {
  if (_scan) { _scan.stop = true; return; }     // second click stops early
  const tab = scanTab();
  const state = _scan = { stop: false };
  btn.classList.add("cv-running");
  document.getElementById(SCAN_PANEL_ID)?.remove();
  try {
    const complete = await loadWholeGrid(state, n => { btn.textContent = `Loading… ${n} (click to stop)`; });
    if (scanTab() !== tab) return;                 // navigated away mid-scan
    const info = channelFromPage();
    const items = collectTiles();
    btn.textContent = `Checking ${items.length}…`;
    window.scrollTo(0, 0);
    const r = await gmPost(`${API_BASE}/channel-scan`, {
      channel_id: info && info.channel_id, tab, complete, items,
    });
    showScanResult(r, tab);
  } catch (e) {
    cvToast(`Vault sync failed: ${e.message || e}`, true);
  } finally {
    _scan = null;
    btn.classList.remove("cv-running");
    btn.textContent = "Sync channel to Vault";
  }
}

function updateScanButton() {
  const btn = document.getElementById(SCAN_BTN_ID);
  if (!scanTab()) {
    btn?.remove();
    document.getElementById(SCAN_PANEL_ID)?.remove();
    if (_scan) _scan.stop = true;
    return;
  }
  if (btn) return;
  const b = el("button", null, { id: SCAN_BTN_ID, type: "button",
    title: "Scroll this whole tab and send every video's view count to ChannelVault" });
  b.textContent = "Sync channel to Vault";
  b.addEventListener("click", () => runScan(b));
  document.body.appendChild(b);
}

// ---------------------------------------------------------------------------
// YouTube SPA navigation
// ---------------------------------------------------------------------------

function onNavigate() {
  checkAndAnnotate();
  initCardAnnotation();
  injectCreatorButton();
  updateScanButton();
}

window.addEventListener("yt-navigate-finish", (e) => {
  onNavigate();
  const info = channelFromNavigate(e.detail);
  if (info) reportChannel(info);
  else setTimeout(() => reportChannel(channelFromPage()), 1500);
});
onNavigate();
setTimeout(() => reportChannel(channelFromPage()), 2500);
