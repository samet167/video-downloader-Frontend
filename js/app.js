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
  { key: "youtube",   pattern: /youtube\.com|youtu\.be/i,  name: "YouTube",   icon: "▶" },
  { key: "tiktok",    pattern: /tiktok\.com/i,              name: "TikTok",    icon: "🎵" },
  { key: "instagram", pattern: /instagram\.com/i,           name: "Instagram", icon: "📸" },
  { key: "facebook",  pattern: /facebook\.com|fb\.watch/i,  name: "Facebook",  icon: "👥" },
  { key: "twitter",   pattern: /twitter\.com|x\.com/i,      name: "X / Twitter", icon: "✖" },
  { key: "vimeo",     pattern: /vimeo\.com/i,               name: "Vimeo",     icon: "🎬" },
  { key: "twitch",    pattern: /twitch\.tv/i,               name: "Twitch",    icon: "🟣" },
];

function detectPlatform(url) {
  for (const p of PLATFORMS) {
    if (p.pattern.test(url)) return p;
  }
  return { key: "other", name: "Video", icon: "🎬" };
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
    setHeroError("⚠ Backend is offline or waking up (free tier cold start ~30s). Please refresh shortly.");
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
    setHeroError("❌ " + err.message.replace(/\n/g, "  "));
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
  $("dl-platform-icon").textContent = platform.icon;
  $("dl-platform-name").textContent = platform.name;

  // Thumbnail
  const thumb = $("info-thumb");
  thumb.src   = data.thumbnail || "";
  thumb.alt   = data.title     || "Video thumbnail";

  $("info-duration").textContent = data.duration || "";
  $("info-title").textContent    = data.title    || "N/A";

  const uploader = data.uploader || "";
  $("info-uploader").textContent = uploader ? `📺 ${uploader}` : "";

  const best = data.formats && data.formats[0];
  $("info-filesize").textContent = (best && best.filesize)
    ? `📦 Approx. ${fmtBytes(best.filesize)}`
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
   § 14b — Save Blob to Device (cross-browser, iOS Safari compatible)
   ══════════════════════════════════════════════════════════════════════════ */
function saveBlobToDevice(blob, filename) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  if (isIOS && navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome")) {
    // iOS Safari: window.open with blob URL works better than <a> click
    // because Safari on iOS blocks programmatic <a> downloads.
    // The user will see the video in a new tab and can use "Share → Save to Files".
    const blobUrl = URL.createObjectURL(blob);
    const newTab  = window.open(blobUrl, "_blank");
    if (!newTab) {
      // Popup blocked — fallback to <a> tag method
      _triggerAnchorDownload(blob, filename);
    }
    // Revoke after a delay to allow iOS to process
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } else {
    // All other browsers: use <a download> method
    _triggerAnchorDownload(blob, filename);
  }
}

function _triggerAnchorDownload(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = blobUrl;
  a.download    = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 15000);
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
      $("progress-filename").textContent = `📄 ${progress.filename}`;
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

/* ══════════════════════════════════════════════════════════════════════════
   § 22 — Boot
   ══════════════════════════════════════════════════════════════════════════ */
init();
