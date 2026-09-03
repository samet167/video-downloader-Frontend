/**
 * js/app.js — VideoDown UI Controller
 * ======================================
 * Handles all DOM interactions, state management, and backend communication.
 * Backend URL is configured via js/config.js (window.CONFIG.BACKEND_URL).
 *
 * Flow:
 *  INIT     → health check → show API badge + default save dir
 *  STEP 1   → hero URL bar → btnFetch → API.fetchInfo()
 *               → show card-info (title, thumb, quality pills, save-dir)
 *  STEP 2   → user picks quality, clicks Download
 *               → API.startDownload() → gets task_id
 *               → SSE via API.openProgressStream() → live progress card
 *  SUCCESS  → card-success with filename/path, Open Folder/File (desktop)
 *  ERROR    → card-error with message, retry / new
 *
 * Extra features:
 *  – Dark / Light mode toggle (persisted to localStorage)
 *  – Clipboard paste button
 *  – Platform auto-detection from URL
 *  – Scroll-reveal IntersectionObserver
 *  – Navbar scroll effect
 *  – Mobile hamburger drawer
 */

"use strict";

/* ══════════════════════════════════════════════════════════════════════════
   § 1 — DOM helpers
   ══════════════════════════════════════════════════════════════════════════ */
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/* ══════════════════════════════════════════════════════════════════════════
   § 2 — Application state
   ══════════════════════════════════════════════════════════════════════════ */
const state = {
  currentUrl:   null,
  lastFilePath: null,
  lastSaveDir:  null,
  serverOsType: null,
  clientDevice: null,
  sseSource:    null,
  cancelled:    false,
};

/* Cards managed by showCard() */
const CARDS = ["card-info", "card-progress", "card-success", "card-error"];

/* ══════════════════════════════════════════════════════════════════════════
   § 3 — Device detection
   ══════════════════════════════════════════════════════════════════════════ */
function detectDevice() {
  const ua     = navigator.userAgent;
  let os       = "Unknown";
  let type     = "desktop";

  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if      (isIPad)               { os = "iPadOS";  type = "tablet"; }
  else if (/iPhone/.test(ua))    { os = "iOS";     type = "mobile"; }
  else if (/Android/.test(ua))   { os = "Android"; type = /Mobile/.test(ua) ? "mobile" : "tablet"; }
  else if (/Windows/.test(ua))   { os = "Windows"; }
  else if (/Macintosh/.test(ua)) { os = "macOS";   }
  else if (/Linux/.test(ua))     { os = "Linux";   }

  return {
    os, type,
    canCustomDir:  type === "desktop",
    canOpenFolder: type === "desktop",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   § 4 — Platform detection from URL
   ══════════════════════════════════════════════════════════════════════════ */
const PLATFORMS = [
  { key: "youtube",   pattern: /youtube\.com|youtu\.be/i,  name: "YouTube",   icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>` },
  { key: "tiktok",    pattern: /tiktok\.com/i,              name: "TikTok",    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.9 4.9 0 0114.8 0h-3.5v16.4a2.4 2.4 0 01-2.4 2.1 2.4 2.4 0 01-2.4-2.4 2.4 2.4 0 012.4-2.4c.2 0 .5 0 .7.1V10a6 6 0 00-.7 0 5.9 5.9 0 00-5.9 5.9 5.9 5.9 0 005.9 5.9 5.9 5.9 0 005.9-5.9V8.1a8.4 8.4 0 004.9 1.6V6.2a4.9 4.9 0 01-3.1-2.9z"/></svg>` },
  { key: "instagram", pattern: /instagram\.com/i,           name: "Instagram", icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>` },
  { key: "facebook",  pattern: /facebook\.com|fb\.watch/i,  name: "Facebook",  icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.1C24 5.5 18.6 0 12 0S0 5.5 0 12.1C0 18 4.4 22.9 10.1 23.9V15.6H7.1v-3.5h3V9.5c0-3 1.8-4.6 4.5-4.6 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-1.9.9-1.9 1.9v2.2h3.3l-.5 3.5h-2.8v8.3C19.6 23 24 18 24 12.1z"/></svg>` },
  { key: "twitter",   pattern: /twitter\.com|x\.com/i,      name: "X / Twitter", icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 1.6h3.3l-7.2 8.3 8.5 11.2h-6.6l-5.2-6.8-5.9 6.8H2l7.7-8.8L1.5 1.6h6.8l4.7 6.2 5.3-6.2zm-1.2 17.4h1.8L7.1 3.4H5.2l11.9 15.6z"/></svg>` },
  { key: "vimeo",     pattern: /vimeo\.com/i,               name: "Vimeo",     icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.09 7.42c-.52 2.78-2.6 6.13-6.25 10.05-3.8 4.09-7.15 6.13-10.05 6.13-1.68 0-3.08-1.28-4.22-3.84L0 7.82C0 5 1.13 3.59 3.39 3.59c2 0 3.75 1.35 5.25 4.05L9 8.23c1.36-2.5 3-3.75 4.92-3.75 1.6 0 2.7 1.1 3.33 3.3 1.68-2.4 3.4-3.6 5.16-3.6 1.63 0 2.5 1.13 2.61 3.4z"></path></svg>` },
  { key: "twitch",    pattern: /twitch\.tv/i,               name: "Twitch",    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"></path></svg>` },
];

function detectPlatform(url) {
  for (const p of PLATFORMS) {
    if (p.pattern.test(url)) return p;
  }
  return { key: "other", name: "Video", icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>` };
}

/* ══════════════════════════════════════════════════════════════════════════
   § 5 — Utility helpers
   ══════════════════════════════════════════════════════════════════════════ */
function showCard(id) {
  CARDS.forEach(c => $(c)?.classList.add("hidden"));
  if (id) $(id)?.classList.remove("hidden");
  if (id) $(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return null;
  let v = bytes;
  for (const u of ["B", "KB", "MB", "GB"]) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TB`;
}

function fmtPath(path, max = 58) {
  if (!path || path.length <= max) return path || "";
  const h = Math.floor((max - 3) / 2);
  return path.slice(0, h) + "…" + path.slice(-h);
}

function setHeroError(msg) {
  const el = $("hero-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
  $("hero-url").style.setProperty("--err", msg ? "1" : "0");
}
function clearHeroError() { setHeroError(""); }

/* Button loading / restore */
function btnLoad(btn, label) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span class="btn-label">${label}</span>`;
}
function btnRestore(btn, innerHtml) {
  btn.disabled  = false;
  btn.innerHTML = innerHtml;
}

/* ══════════════════════════════════════════════════════════════════════════
   § 6 — Dark / Light mode
   ══════════════════════════════════════════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem("vd-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next    = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("vd-theme", next);
}

/* ══════════════════════════════════════════════════════════════════════════
   § 7 — Navbar scroll effect
   ══════════════════════════════════════════════════════════════════════════ */
function initNavbar() {
  const nav = $("navbar");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ══════════════════════════════════════════════════════════════════════════
   § 8 — Mobile hamburger
   ══════════════════════════════════════════════════════════════════════════ */
function initHamburger() {
  const btn    = $("nav-hamburger");
  const drawer = $("nav-drawer");
  if (!btn || !drawer) return;

  btn.addEventListener("click", () => {
    const open = btn.classList.toggle("open");
    drawer.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden",  String(!open));
  });

  // Close on link click
  drawer.querySelectorAll(".nav-drawer-link").forEach(a => {
    a.addEventListener("click", () => {
      btn.classList.remove("open");
      drawer.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      drawer.setAttribute("aria-hidden",  "true");
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   § 9 — Scroll-reveal IntersectionObserver
   ══════════════════════════════════════════════════════════════════════════ */
function initReveal() {
  // Make platform and feature cards individually revealable
  $$(".platform-card, .feature-card").forEach(el => el.classList.add("reveal"));

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  $$(".reveal").forEach(el => io.observe(el));
}

/* ══════════════════════════════════════════════════════════════════════════
   § 10 — Init: health check + default save dir
   ══════════════════════════════════════════════════════════════════════════ */
async function init() {
  initTheme();
  initNavbar();
  initHamburger();
  initReveal();

  state.clientDevice = detectDevice();

  // Health check
  const badge = $("api-status-badge");
  const { ok, message } = await API.checkHealth();
  badge.textContent = ok ? "● API Online" : "● API Offline";
  badge.className   = `api-badge ${ok ? "api-badge--ok" : "api-badge--err"}`;
  badge.classList.remove("hidden");

  // Footer API status link text
  const footerStatus = $("footer-api-status");
  if (footerStatus) {
    footerStatus.textContent = ok ? "API Status: Online" : "API Status: Offline";
    footerStatus.style.color = ok ? "var(--green)" : "var(--red)";
  }

  if (!ok) {
    setHeroError("Backend is offline or waking up (free tier cold start ~30s). Please refresh shortly.");
    return;
  }

  // Pre-fill save dir for desktop users
  if (state.clientDevice.canCustomDir) {
    const { save_dir, os_type } = await API.getDefaultSaveDir();
    state.serverOsType = os_type;
    if (save_dir) {
      const inp = $("save-dir-input");
      if (inp) inp.value = save_dir;
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   § 11 — Paste button
   ══════════════════════════════════════════════════════════════════════════ */
async function handlePaste() {
  const inp = $("hero-url");
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      inp.value = text.trim();
      clearHeroError();
      inp.focus();
    }
  } catch {
    // Permission denied or no text — try focusing input so browser prompts
    inp.focus();
    inp.select();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   § 12 — Fetch video info
   ══════════════════════════════════════════════════════════════════════════ */
async function fetchVideoInfo() {
  const rawUrl = $("hero-url").value.trim();
  clearHeroError();

  if (!rawUrl) {
    setHeroError("Please paste a video URL first.");
    $("hero-url").focus();
    return;
  }

  const testUrl = rawUrl.startsWith("www.") ? "https://" + rawUrl : rawUrl;
  try {
    const p = new URL(testUrl);
    if (!["http:", "https:"].includes(p.protocol)) throw new Error();
  } catch {
    setHeroError("Invalid URL — must start with https://");
    return;
  }

  state.currentUrl = rawUrl;
  const fetchBtn   = $("hero-fetch-btn");
  const origHtml   = fetchBtn.innerHTML;
  btnLoad(fetchBtn, "Analyzing…");
  showCard(null);

  try {
    const data = await API.fetchInfo(rawUrl);
    renderInfoCard(data, rawUrl);
  } catch (err) {
    setHeroError(err.message.replace(/\n/g, "  "));
  } finally {
    btnRestore(fetchBtn, origHtml);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   § 13 — Render info card
   ══════════════════════════════════════════════════════════════════════════ */
function renderInfoCard(data, originalUrl) {
  // Platform badge
  const platform = detectPlatform(originalUrl);
  $("dl-platform-icon").innerHTML = platform.icon;
  $("dl-platform-name").textContent = platform.name;

  // Thumbnail
  const thumb = $("info-thumb");
  thumb.src   = data.thumbnail || "";
  thumb.alt   = data.title     || "Video thumbnail";

  $("info-duration").textContent = data.duration || "";
  $("info-title").textContent    = data.title    || "N/A";

  const uploader = data.uploader || "";
  $("info-uploader").innerHTML = uploader ? `<svg style="display:inline;margin-right:4px;vertical-align:text-bottom" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg> ${uploader}` : "";

  const best = data.formats && data.formats[0];
  $("info-filesize").innerHTML = (best && best.filesize)
    ? `<svg style="display:inline;margin-right:4px;vertical-align:text-bottom" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> Approx. ${fmtBytes(best.filesize)}`
    : "";

  // Preselect best available quality radio
  if (best && best.quality) {
    const radio = document.querySelector(`input[name="quality"][value="${best.quality}"]`);
    if (radio) radio.checked = true;
  }

  // Store URL on download button
  $("btn-download").dataset.url = originalUrl;

  // Save-dir row — hidden in production (direct download to device)
  const saveDirRow = $("save-dir-row");
  saveDirRow.classList.add("hidden");

  showCard("card-info");

  // Scroll downloader section into view
  $("downloader").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ══════════════════════════════════════════════════════════════════════════
   § 14 — Start download (Direct to device)
   ══════════════════════════════════════════════════════════════════════════ */
async function startDownload() {
  const url     = $("btn-download").dataset.url;
  const quality = (document.querySelector('input[name="quality"]:checked') || {}).value || "720p";

  if (!url) return;

  state.cancelled = false;
  const dlBtn     = $("btn-download");
  const origHtml  = dlBtn.innerHTML;
  btnLoad(dlBtn, "Starting…");

  // Show progress card
  resetProgressUI();
  showCard("card-progress");
  setProgressStatus("starting", "Connecting to server… (may take a moment)");
  setProgressIndeterminate(true);

  try {
    // Use the direct download endpoint — downloads to /tmp on server,
    // then streams the file as a blob to the client's device.
    const { blob, filename } = await API.downloadFile(url, quality, (pct) => {
      // Progress callback — called as the binary streams in
      if (state.cancelled) return;
      setProgressIndeterminate(false);
      setProgressStatus("downloading", "Downloading to your device…");
      const fill = $("progress-fill");
      fill.style.width = `${pct.toFixed(1)}%`;
      $("progress-track").setAttribute("aria-valuenow", pct.toFixed(0));
      $("progress-pct").textContent = `${pct.toFixed(1)}%`;
    });

    if (state.cancelled) {
      showCard("card-info");
      btnRestore(dlBtn, origHtml);
      return;
    }

    // Download complete — trigger save to device
    setProgressIndeterminate(false);
    $("progress-fill").style.width = "100%";
    $("progress-pct").textContent  = "100%";
    setProgressStatus("done", "Saving to device…");

    // Save blob to device — cross-browser including iOS Safari
    saveBlobToDevice(blob, filename);

    // Show success card
    setTimeout(() => {
      showSuccessCard(filename, "", "");
    }, 800);

  } catch (err) {
    setProgressIndeterminate(false);
    setProgressStatus("error", "Download failed.");

    if (state.cancelled || err.name === "AbortError") {
      showCard("card-info");
    } else {
      setTimeout(() => showErrorCard(err.message), 400);
    }
  } finally {
    btnRestore(dlBtn, origHtml);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   § 14b — Save Blob to Device (cross-browser, Android & iOS compatible)
   ══════════════════════════════════════════════════════════════════════════ */
function saveBlobToDevice(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = blobUrl;
  a.download    = filename || "video.mp4";
  a.rel         = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  // Also bind "Download Again" to immediately re-save the cached blob
  const btnAgain = $("btn-download-again");
  if (btnAgain) {
    btnAgain.onclick = (e) => {
      e.preventDefault();
      const a2 = document.createElement("a");
      a2.href = blobUrl;
      a2.download = filename || "video.mp4";
      a2.style.display = "none";
      document.body.appendChild(a2);
      a2.click();
      setTimeout(() => document.body.removeChild(a2), 1000);
    };
  }

  // Cleanup after user has had plenty of time to save
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (_) {}
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  }, 1000);
}

/* ══════════════════════════════════════════════════════════════════════════
   § 15 — SSE progress handler
   ══════════════════════════════════════════════════════════════════════════ */
function handleProgressEvent(progress, resolvedSaveDir) {
  const status = progress.status;

  if (status === "connecting" || status === "starting") {
    setProgressIndeterminate(true);
    setProgressStatus("starting", "Analyzing video…");
    return;
  }

  if (status === "downloading") {
    if (state.cancelled) return;
    setProgressIndeterminate(false);
    setProgressStatus("downloading", "Downloading…");

    const pct  = typeof progress.percent === "number" ? progress.percent : 0;
    const fill = $("progress-fill");
    fill.style.width = `${pct.toFixed(1)}%`;
    $("progress-track").setAttribute("aria-valuenow", pct.toFixed(0));
    $("progress-pct").textContent = `${pct.toFixed(1)}%`;

    $("stat-speed").textContent = progress.speed    || "—";
    $("stat-eta").textContent   = progress.eta      || "—";
    $("stat-total").textContent = progress.filesize  || "—";

    if (progress.total_bytes && progress.downloaded_bytes) {
      $("progress-size").textContent =
        `${fmtBytes(progress.downloaded_bytes) || "?"} / ${fmtBytes(progress.total_bytes) || "?"}`;
    } else {
      $("progress-size").textContent = progress.filesize || "—";
    }

    if (progress.filename) {
      $("progress-filename").innerHTML = `<svg style="display:inline;margin-right:4px;vertical-align:text-bottom" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> ${progress.filename}`;
    }
    return;
  }

  if (status === "processing") {
    if (state.cancelled) return;
    setProgressIndeterminate(false);
    $("progress-fill").style.width = "99%";
    $("progress-pct").textContent  = "99%";
    setProgressStatus("processing", "Processing video…");
    $("stat-eta").textContent = "—";
    return;
  }

  if (status === "done") {
    setProgressIndeterminate(false);
    $("progress-fill").style.width = "100%";
    $("progress-pct").textContent  = "100%";
    setProgressStatus("done", "Download completed!");

    const delay = (window.CONFIG && window.CONFIG.SSE_CLOSE_DELAY_MS) || 1500;
    setTimeout(() => {
      if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
    }, delay);

    state.lastFilePath = progress.filepath || "";
    state.lastSaveDir  = progress.save_dir || resolvedSaveDir || "";

    setTimeout(() => {
      showSuccessCard(progress.filename, state.lastFilePath, state.lastSaveDir);
    }, 600);
    return;
  }

  if (status === "error") {
    if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
    setProgressIndeterminate(false);
    setProgressStatus("error", "Download failed.");

    if (!state.cancelled) {
      setTimeout(() => showErrorCard(progress.error || "Unknown error."), 400);
    } else {
      showCard("card-info");
    }
    return;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   § 16 — Progress UI helpers
   ══════════════════════════════════════════════════════════════════════════ */
function resetProgressUI() {
  const fill = $("progress-fill");
  fill.style.width = "0%";
  fill.classList.remove("indeterminate");
  $("progress-track").setAttribute("aria-valuenow", "0");
  $("progress-pct").textContent  = "0%";
  $("progress-size").textContent = "—";
  $("stat-speed").textContent    = "—";
  $("stat-eta").textContent      = "—";
  $("stat-total").textContent    = "—";
  $("progress-filename").textContent = "";
}

function setProgressIndeterminate(on) {
  const fill = $("progress-fill");
  if (on) {
    fill.classList.add("indeterminate");
    $("progress-pct").textContent = "…";
  } else {
    fill.classList.remove("indeterminate");
  }
}

function setProgressStatus(type, text) {
  const dot  = $("progress-dot");
  const txt  = $("progress-status-text");
  txt.textContent = text;
  dot.className   = "progress-status-dot";
  if (type === "done")  dot.classList.add("done");
  if (type === "error") dot.classList.add("error");
}

/* ══════════════════════════════════════════════════════════════════════════
   § 17 — Success card
   ══════════════════════════════════════════════════════════════════════════ */
function showSuccessCard(filename, filepath, saveDir) {
  $("success-filename").textContent = filename || "video.mp4";

  const rowDir  = $("row-save-dir");
  const rowPath = $("row-filepath");

  // In production (direct download), files go to the user's device
  // so server-side paths are not relevant — hide them.
  if (saveDir) {
    $("success-save-dir").textContent = fmtPath(saveDir, 60);
    $("success-save-dir").title       = saveDir;
    rowDir.classList.remove("hidden");
  } else {
    rowDir.classList.add("hidden");
  }

  if (filepath) {
    $("success-path").textContent = fmtPath(filepath, 60);
    $("success-path").title       = filepath;
    rowPath.classList.remove("hidden");
  } else {
    rowPath.classList.add("hidden");
  }

  // Open Folder / Open File buttons — hide in production (file is on user's device)
  const btnFolder = $("btn-open-folder");
  const btnFile   = $("btn-open-file");
  btnFolder.classList.add("hidden");
  btnFile.classList.add("hidden");

  showCard("card-success");
}

/* ══════════════════════════════════════════════════════════════════════════
   § 18 — Error card
   ══════════════════════════════════════════════════════════════════════════ */
function showErrorCard(msg) {
  $("error-message").textContent = (msg || "An unexpected error occurred.").replace(/\n/g, " ");
  showCard("card-error");
}

/* ══════════════════════════════════════════════════════════════════════════
   § 19 — Cancel & Reset
   ══════════════════════════════════════════════════════════════════════════ */
function cancelDownload() {
  state.cancelled = true;
  if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
  setProgressIndeterminate(false);
  showCard("card-info");
}

function resetAll() {
  if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
  state.cancelled    = false;
  state.currentUrl   = null;
  state.lastFilePath = null;
  state.lastSaveDir  = null;

  $("hero-url").value = "";
  clearHeroError();
  showCard(null);
  resetProgressUI();
  $("hero-url").focus();
}

/* ══════════════════════════════════════════════════════════════════════════
   § 20 — Open folder / file via backend
   ══════════════════════════════════════════════════════════════════════════ */
async function handleOpenPath(btn) {
  const path = btn.dataset.path;
  if (!path) return;
  const orig    = btn.innerHTML;
  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner"></span><span class="btn-label">Opening…</span>`;

  const result = await API.openFolder(path);
  btn.innerHTML = orig;
  btn.disabled  = false;

  if (!result.success) {
    const note       = document.createElement("span");
    note.style.cssText = "font-size:.8rem;color:var(--red);margin-left:.5rem;";
    note.textContent = result.error || "Cannot open.";
    btn.after(note);
    setTimeout(() => note.remove(), 4000);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   § 21 — Event listeners
   ══════════════════════════════════════════════════════════════════════════ */

// Theme toggle
$("theme-toggle").addEventListener("click", toggleTheme);

// Paste button
$("hero-paste-btn").addEventListener("click", handlePaste);

// Hero URL input
$("hero-fetch-btn").addEventListener("click", fetchVideoInfo);
$("hero-url").addEventListener("keydown", e => {
  if (e.key === "Enter") fetchVideoInfo();
});
$("hero-url").addEventListener("input", clearHeroError);

// Auto-paste on focus if empty
$("hero-url").addEventListener("focus", async () => {
  if ($("hero-url").value.trim()) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text && (text.startsWith("http") || text.startsWith("www."))) {
      $("hero-url").value = text.trim();
    }
  } catch { /* permission denied — silent */ }
});

// Download
$("btn-download").addEventListener("click", startDownload);

// Cancel
$("btn-cancel").addEventListener("click", cancelDownload);

// Card: "New URL" button (inside info card)
$("btn-get-info-again").addEventListener("click", resetAll);

// Success buttons
$("btn-new").addEventListener("click", resetAll);
$("btn-open-folder").addEventListener("click", function() { handleOpenPath(this); });
$("btn-open-file").addEventListener("click",   function() { handleOpenPath(this); });

// Error buttons
$("btn-retry").addEventListener("click", () => {
  showCard("card-info");
});
$("btn-error-new").addEventListener("click", resetAll);

// Smooth-scroll nav links
$$(".nav-link, .nav-drawer-link").forEach(a => {
  a.addEventListener("click", e => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("#")) {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Mobile Bottom Navigation Tabs
const bottomNavTabs = $$(".mobile-bottom-nav .nav-tab");
bottomNavTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const targetId = tab.dataset.target;
    bottomNavTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    if (targetId === "status-action") {
      // Refresh API check and scroll to top badge or show toast
      checkApiHealth();
      const badge = $("api-status-badge");
      if (badge) {
        badge.classList.remove("hidden");
        badge.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Quick Platform Chips
$$(".qp-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const p = chip.dataset.platform;
    const input = $("hero-url");
    if (input) {
      input.focus();
      input.placeholder = `Paste ${chip.getAttribute("title") || p} link here…`;
      input.parentElement.classList.add("pulse-focus");
      setTimeout(() => input.parentElement.classList.remove("pulse-focus"), 800);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   § 22 — Boot
   ══════════════════════════════════════════════════════════════════════════ */
init();

