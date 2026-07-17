/**
 * script.js — VideoDL Frontend (Production)
 * ============================================
 * Talks to Flask backend via CONFIG.BACKEND_URL
 *
 * Flow:
 *  1. init()         → GET /health → show backend status pill
 *  2. fetchVideoInfo → POST /api/info → render video preview
 *  3. startDownload  → POST /api/download → stream MP4 → save dialog
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════
   CONFIG  — reads BACKEND_URL from js/config.js (window.CONFIG)
   ═══════════════════════════════════════════════════════════════ */
const BACKEND_URL = (window.CONFIG && window.CONFIG.BACKEND_URL)
  ? window.CONFIG.BACKEND_URL.replace(/\/$/, "")
  : "https://video-downloader-backend-1-5oer.onrender.com";

/* ═══════════════════════════════════════════════════════════════
   DOM REFS — must match id="" in index.html exactly
   ═══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const el = {
  // Header
  backendStatus:   $("backend-status"),
  // Input card
  urlInput:        $("url-input"),
  btnFetch:        $("btn-fetch"),
  urlError:        $("url-error"),
  // Info card
  secInfo:         $("section-info"),
  infoThumb:       $("info-thumb"),
  infoDuration:    $("info-duration"),
  infoTitle:       $("info-title"),
  infoUploader:    $("info-uploader"),
  infoFilesize:    $("info-filesize"),
  qualitySelect:   $("quality-select"),
  btnDownload:     $("btn-download"),
  // Progress card
  secProgress:     $("section-progress"),
  progressFill:    $("progress-fill"),       // ← id="progress-fill" in HTML
  progressPct:     $("progress-pct"),        // ← id="progress-pct"  in HTML
  progressSize:    $("progress-size"),
  statSpeed:       $("stat-speed"),
  statEta:         $("stat-eta"),
  statTotal:       $("stat-total"),
  progressFname:   $("progress-filename"),
  btnCancel:       $("btn-cancel"),
  // Success card
  secSuccess:      $("section-success"),
  successFilename: $("success-filename"),
  btnNew:          $("btn-new"),
  // Error card
  secError:        $("section-error"),
  errorMessage:    $("error-message"),
  btnRetry:        $("btn-retry"),
  btnErrorNew:     $("btn-error-new"),
};

/* ═══════════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════════ */
let state = {
  currentUrl:    null,
  downloadCtrl:  null,   // AbortController for active download
  cancelled:     false,
};

/* ═══════════════════════════════════════════════════════════════
   SECTION VISIBILITY
   ═══════════════════════════════════════════════════════════════ */
const SECTIONS = ["section-info", "section-progress",
                  "section-success", "section-error"];

function showSection(id) {
  SECTIONS.forEach(s => $(s).classList.add("hidden"));
  if (id) $(id).classList.remove("hidden");
}

/* ═══════════════════════════════════════════════════════════════
   URL ERROR
   ═══════════════════════════════════════════════════════════════ */
function setUrlError(msg) {
  el.urlError.textContent = msg;
  el.urlError.classList.toggle("hidden", !msg);
  el.urlInput.style.borderColor = msg ? "var(--c-danger)" : "";
}
function clearUrlError() { setUrlError(""); }

/* ═══════════════════════════════════════════════════════════════
   BUTTON HELPERS
   ═══════════════════════════════════════════════════════════════ */
function btnLoading(btn, label) {
  btn.disabled = true;
  btn.innerHTML =
    `<span class="spinner"></span><span class="btn-label">${label}</span>`;
}
function btnRestore(btn, icon, label) {
  btn.disabled = false;
  btn.innerHTML =
    `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>`;
}

/* ═══════════════════════════════════════════════════════════════
   FORMAT HELPERS
   ═══════════════════════════════════════════════════════════════ */
function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return null;
  let v = bytes;
  for (const u of ["B", "KB", "MB", "GB"]) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TB`;
}

function fmtEta(received, total, speedStr) {
  if (!speedStr || !total || !received) return "";
  const m = speedStr.match(/([\d.]+)\s*(B|KB|MB|GB)\/s/i);
  if (!m) return "";
  const mult = { B: 1, KB: 1024, MB: 1_048_576, GB: 1_073_741_824 };
  const bps  = parseFloat(m[1]) * (mult[m[2].toUpperCase()] || 1);
  if (bps <= 0) return "";
  const secs = Math.round((total - received) / bps);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h`;
}

/* ═══════════════════════════════════════════════════════════════
   FETCH WITH TIMEOUT
   ═══════════════════════════════════════════════════════════════ */
function fetchWithTimeout(url, options = {}, ms = 20000, ctrl = null) {
  const controller = ctrl || new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/* ═══════════════════════════════════════════════════════════════
   INIT — check backend health on page load
   ═══════════════════════════════════════════════════════════════ */
async function init() {
  console.log("[VideoDL] init — backend:", BACKEND_URL);

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/health`, {}, 8000);
    if (res.ok) {
      el.backendStatus.textContent = "🟢 Backend Online";
      el.backendStatus.className   = "status-pill status-pill--ok";
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("[VideoDL] backend health check failed:", err.message);
    el.backendStatus.textContent = "🔴 Backend Offline";
    el.backendStatus.className   = "status-pill status-pill--err";
    if (err.name === "AbortError") {
      setUrlError("⚠ Backend is waking up (cold start). Please wait ~30s and refresh.");
    } else if (err instanceof TypeError) {
      setUrlError("⚠ Cannot reach backend — check your network connection.");
    } else {
      setUrlError("⚠ Backend is temporarily unavailable. Please try again shortly.");
    }
  }

  el.backendStatus.classList.remove("hidden");
}

/* ═══════════════════════════════════════════════════════════════
   STEP 1 — POST /api/info
   ═══════════════════════════════════════════════════════════════ */
async function fetchVideoInfo() {
  const rawUrl = el.urlInput.value.trim();
  clearUrlError();

  if (!rawUrl) {
    setUrlError("សូមបញ្ចូល URL វីដេអូ។");
    return;
  }

  // Client-side URL format check
  const testUrl = rawUrl.startsWith("www.") ? "https://" + rawUrl : rawUrl;
  try {
    const p = new URL(testUrl);
    if (!["http:", "https:"].includes(p.protocol)) throw new Error();
  } catch {
    setUrlError("URL មិនត្រឹមត្រូវ — ត្រូវចាប់ផ្ដើមដោយ https://");
    return;
  }

  // Debug: log URL before sending
  console.log("[VideoDL] fetchVideoInfo — sending URL:", rawUrl);

  state.currentUrl = rawUrl;
  btnLoading(el.btnFetch, "កំពុងវិភាគ…");
  showSection(null);

  try {
    const endpoint = `${BACKEND_URL}/api/info`;
    console.log("[VideoDL] POST", endpoint);

    const res = await fetchWithTimeout(
      endpoint,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url: rawUrl }),
      },
      20000,
    );

    console.log("[VideoDL] /api/info response status:", res.status);

    // Parse response body
    const json = await res.json();
    console.log("[VideoDL] /api/info response body:", json);

    if (!res.ok || !json.success) {
      throw new Error(json.error || json.message || `Server error ${res.status}`);
    }

    // Backend returns flat structure: { success, title, duration, thumbnail, quality, formats }
    renderVideoInfo(json, rawUrl);

  } catch (err) {
    console.error("[VideoDL] fetchVideoInfo error:", err);
    if (err.name === "AbortError") {
      setUrlError("❌ Request timed out — backend may be waking up. Please try again in 30s.");
    } else if (err instanceof TypeError) {
      setUrlError("❌ Network error — cannot reach backend. Check your connection.");
    } else {
      setUrlError(`❌ ${err.message}`);
    }
  } finally {
    btnRestore(el.btnFetch, "🔍", "វិភាគ");
  }
}

/* ═══════════════════════════════════════════════════════════════
   RENDER VIDEO INFO CARD
   Backend response: { success, title, duration, thumbnail, quality, formats }
   ═══════════════════════════════════════════════════════════════ */
function renderVideoInfo(data, originalUrl) {
  console.log("[VideoDL] renderVideoInfo:", data);

  // Thumbnail
  el.infoThumb.src = data.thumbnail || "";
  el.infoThumb.alt = data.title     || "";

  // Duration badge — backend field is "duration" (already string like "4:05")
  el.infoDuration.textContent = data.duration || "";

  // Title & uploader
  el.infoTitle.textContent    = data.title || "N/A";
  el.infoUploader.textContent = data.quality ? `🎬 Best quality: ${data.quality}` : "";

  // File size from first format
  const best = data.formats && data.formats[0];
  el.infoFilesize.textContent =
    best && best.filesize ? `📦 ប៉ាន់ ~${fmtBytes(best.filesize)}` : "";

  // Store URL for download button
  el.btnDownload.dataset.url = originalUrl;

  showSection("section-info");
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2 — POST /api/download
   ═══════════════════════════════════════════════════════════════ */
async function startDownload() {
  const url     = el.btnDownload.dataset.url;
  const quality = el.qualitySelect.value || "auto";

  if (!url) return;

  console.log("[VideoDL] startDownload — url:", url, "quality:", quality);

  state.cancelled  = false;
  state.downloadCtrl = new AbortController();

  btnLoading(el.btnDownload, "ចាប់ផ្ដើម…");
  resetProgressUI();
  showSection("section-progress");
  startIndeterminate();

  try {
    const endpoint = `${BACKEND_URL}/api/download`;
    console.log("[VideoDL] POST", endpoint);

    const res = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      // Backend expects "quality" field (not "format_id")
      body:    JSON.stringify({ url, quality }),
      signal:  state.downloadCtrl.signal,
    });

    console.log("[VideoDL] /api/download status:", res.status);

    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try {
        const json = await res.json();
        errMsg = json.error || json.message || errMsg;
      } catch { /* ignore */ }
      throw new Error(errMsg);
    }

    // Stream MP4 body with progress
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    const filename      = extractFilename(res) || "video.mp4";

    stopIndeterminate();
    const blob = await streamWithProgress(res.body, contentLength);

    saveBlob(blob, filename);
    showSuccessCard(filename);

  } catch (err) {
    stopIndeterminate();
    btnRestore(el.btnDownload, "⬇", "ទាញយក MP4");
    console.error("[VideoDL] download error:", err);

    if (state.cancelled || err.name === "AbortError") {
      showSection("section-info");
    } else if (err instanceof TypeError) {
      showErrorCard("Network error — cannot reach backend. Check your connection.");
    } else {
      showErrorCard(err.message);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   STREAM WITH PROGRESS
   ═══════════════════════════════════════════════════════════════ */
async function streamWithProgress(body, total) {
  const reader  = body.getReader();
  const chunks  = [];
  let received  = 0;
  let lastTime  = Date.now();
  let lastBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (state.cancelled) {
      reader.cancel();
      throw new DOMException("Cancelled", "AbortError");
    }

    chunks.push(value);
    received += value.length;

    // Speed every 600 ms
    const now   = Date.now();
    const delta = now - lastTime;
    let speed   = "";
    if (delta >= 600) {
      const bps = (received - lastBytes) / (delta / 1000);
      speed     = formatSpeed(bps);
      lastTime  = now;
      lastBytes = received;
    }

    // Update progress bar
    if (total > 0) {
      const pct = Math.min(received / total * 100, 100);
      el.progressFill.style.width = `${pct.toFixed(1)}%`;
      el.progressPct.textContent  = `${pct.toFixed(1)}%`;
      el.progressSize.textContent =
        `${fmtBytes(received) || "?"} / ${fmtBytes(total) || "?"}`;
      el.statTotal.textContent = fmtBytes(total) || "—";
    } else {
      el.progressSize.textContent = fmtBytes(received) || "";
    }

    if (speed) el.statSpeed.textContent = speed;
    const eta = fmtEta(received, total, speed);
    if (eta) el.statEta.textContent = eta;
  }

  return new Blob(chunks, { type: "video/mp4" });
}

function formatSpeed(bps) {
  if (bps <= 0)        return "";
  if (bps < 1024)      return `${bps.toFixed(0)} B/s`;
  if (bps < 1_048_576) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1_048_576).toFixed(1)} MB/s`;
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS UI
   ═══════════════════════════════════════════════════════════════ */
function resetProgressUI() {
  el.progressFill.style.width  = "0%";
  el.progressPct.textContent   = "0%";
  el.progressSize.textContent  = "";
  el.statSpeed.textContent     = "—";
  el.statEta.textContent       = "—";
  el.statTotal.textContent     = "—";
  el.progressFname.textContent = "";
  el.progressFill.classList.remove("progress-fill--indeterminate");
}

let _indTimer = null;

function startIndeterminate() {
  el.progressFill.classList.add("progress-fill--indeterminate");
  el.progressPct.textContent = "…";
}
function stopIndeterminate() {
  el.progressFill.classList.remove("progress-fill--indeterminate");
  clearInterval(_indTimer);
  _indTimer = null;
}

/* ═══════════════════════════════════════════════════════════════
   SAVE BLOB — triggers browser file-save dialog
   ═══════════════════════════════════════════════════════════════ */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/* Extract filename from Content-Disposition header */
function extractFilename(response) {
  const cd = response.headers.get("content-disposition") || "";
  let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) return decodeURIComponent(m[1].trim());
  m = cd.match(/filename="?([^";]+)"?/i);
  if (m) return m[1].trim();
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   SUCCESS / ERROR CARDS
   ═══════════════════════════════════════════════════════════════ */
function showSuccessCard(filename) {
  el.successFilename.textContent = filename || "video.mp4";
  showSection("section-success");
  btnRestore(el.btnDownload, "⬇", "ទាញយក MP4");
}

function showErrorCard(msg) {
  el.errorMessage.textContent = msg || "Unknown error.";
  showSection("section-error");
  btnRestore(el.btnDownload, "⬇", "ទាញយក MP4");
}

/* ═══════════════════════════════════════════════════════════════
   CANCEL
   ═══════════════════════════════════════════════════════════════ */
function cancelDownload() {
  state.cancelled = true;
  if (state.downloadCtrl) {
    state.downloadCtrl.abort();
    state.downloadCtrl = null;
  }
  stopIndeterminate();
}

/* ═══════════════════════════════════════════════════════════════
   RESET
   ═══════════════════════════════════════════════════════════════ */
function resetAll() {
  cancelDownload();
  state.currentUrl = null;
  state.cancelled  = false;
  el.urlInput.value = "";
  clearUrlError();
  showSection(null);
  btnRestore(el.btnFetch,    "🔍", "វិភាគ");
  btnRestore(el.btnDownload, "⬇",  "ទាញយក MP4");
}

/* ═══════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════════════════════ */
el.btnFetch.addEventListener("click", fetchVideoInfo);
el.urlInput.addEventListener("keydown", e => {
  if (e.key === "Enter") fetchVideoInfo();
});
el.urlInput.addEventListener("input", () => {
  if (el.urlError.textContent) clearUrlError();
});

el.btnDownload.addEventListener("click", startDownload);
el.btnCancel.addEventListener("click",   cancelDownload);
el.btnNew.addEventListener("click",      resetAll);
el.btnErrorNew.addEventListener("click", resetAll);
el.btnRetry.addEventListener("click", () => {
  showSection("section-info");
  btnRestore(el.btnDownload, "⬇", "ទាញយក MP4");
});

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */
init();
