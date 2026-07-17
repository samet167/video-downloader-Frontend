/**
 * js/api.js — Backend API Client
 * =================================
 * All communication with the Flask backend lives here.
 * app.js calls these functions and never uses fetch() directly.
 *
 * Exposed as window.API:
 *   API.checkHealth()                       → { ok, message }
 *   API.fetchInfo(url)                      → info data object
 *   API.startDownload(url, quality, dir)    → { task_id, save_dir, os_type }
 *   API.openProgressStream(task_id, cb)     → EventSource (call .close() to stop)
 *   API.openFolder(path)                    → { success }
 *   API.getDefaultSaveDir()                 → { save_dir, os_type }
 */

"use strict";

(function (window) {

  // ── Base URL ────────────────────────────────────────────────────────────
  function _base() {
    return (window.CONFIG && window.CONFIG.BACKEND_URL)
      ? window.CONFIG.BACKEND_URL.replace(/\/$/, "")
      : "https://video-downloader-backend-1-5oer.onrender.com";
  }

  // ── Timeout-aware fetch ─────────────────────────────────────────────────
  async function _fetch(url, options, timeoutMs) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parse a user-friendly error message from a non-OK Response. */
  async function _parseError(res) {
    try {
      const j = await res.json();
      return j.error || `Server error ${res.status}`;
    } catch {
      return `Server error ${res.status}`;
    }
  }

  /**
   * Classify fetch errors into user-friendly messages.
   * Handles: AbortError (timeout), TypeError (network/CORS), and generic errors.
   */
  function _classifyFetchError(err) {
    if (err.name === "AbortError") {
      return "Request timed out — the backend may be waking up (free tier cold start). Please try again in 30 seconds.";
    }
    if (err instanceof TypeError) {
      // TypeError from fetch() typically means network failure or CORS block
      return "Cannot connect to backend — possible network issue or CORS error. Please check your connection and try again.";
    }
    return err.message || "An unexpected network error occurred.";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // checkHealth — GET /health
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Ping the backend liveness endpoint.
   * @returns {Promise<{ ok: boolean, message: string }>}
   */
  async function checkHealth() {
    try {
      const res = await _fetch(`${_base()}/health`, { method: "GET" }, 8000);
      if (res.ok) return { ok: true,  message: "● API Online" };
      return        { ok: false, message: `● API Error ${res.status}` };
    } catch (err) {
      if (err.name === "AbortError") return { ok: false, message: "● API Timeout" };
      return { ok: false, message: "● API Offline" };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // fetchInfo — POST /api/info
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Fetch video metadata without downloading.
   * @param {string} url  video page URL
   * @returns {Promise<object>}  JSON from backend
   * @throws {Error} user-readable message
   */
  async function fetchInfo(url) {
    const timeout = (window.CONFIG && window.CONFIG.REQUEST_TIMEOUT_MS) || 30000;
    let res;
    try {
      res = await _fetch(
        `${_base()}/api/info`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ url }),
        },
        timeout,
      );
    } catch (err) {
      throw new Error(_classifyFetchError(err));
    }

    if (!res.ok) throw new Error(await _parseError(res));
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Unknown error from server.");
    return json;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // startDownload — POST /api/download/start
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Start a background download. Returns task_id for SSE progress polling.
   *
   * @param {string} url      video URL
   * @param {string} quality  "auto"|"1080p"|"720p"|"480p"|"360p"
   * @param {string} saveDir  custom save directory path (or "" for default)
   * @returns {Promise<{ task_id: string, save_dir: string, os_type: string }>}
   * @throws {Error}
   */
  async function startDownload(url, quality, saveDir) {
    let res;
    try {
      res = await _fetch(
        `${_base()}/api/download/start`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ url, quality, save_dir: saveDir || "" }),
        },
        60000,
      );
    } catch (err) {
      throw new Error(_classifyFetchError(err));
    }

    if (!res.ok) throw new Error(await _parseError(res));
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Cannot start download.");
    return { task_id: json.task_id, save_dir: json.save_dir, os_type: json.os_type };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // openProgressStream — GET /api/progress/<task_id>  (SSE)
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Open a Server-Sent Events stream for download progress.
   *
   * @param {string}   taskId   task_id returned by startDownload
   * @param {Function} onEvent  callback(progressObject) — called on each SSE event
   * @returns {EventSource}     caller must call .close() when done
   */
  function openProgressStream(taskId, onEvent) {
    const url = `${_base()}/api/progress/${encodeURIComponent(taskId)}`;
    const es  = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEvent(data);
      } catch {
        // Malformed JSON — ignore silently
      }
    };

    es.onerror = () => {
      // Notify the caller that the stream died unexpectedly
      onEvent({ status: "error", error: "SSE connection lost. The backend may have restarted." });
      es.close();
    };

    return es;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // openFolder — POST /api/open-folder
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Ask the backend to reveal the downloaded file in the OS file manager.
   * Only works when the browser and server are on the same machine (local dev).
   *
   * @param {string} path  absolute path to the file or folder
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async function openFolder(path) {
    try {
      const res = await _fetch(
        `${_base()}/api/open-folder`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ path }),
        },
        10000,
      );
      const json = await res.json();
      return json;
    } catch {
      return { success: false, error: "Cannot reach backend." };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // getDefaultSaveDir — GET /api/default-save-dir
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Retrieve the server's default save directory and OS type.
   * @returns {Promise<{ save_dir: string, os_type: string }>}
   */
  async function getDefaultSaveDir() {
    try {
      const res  = await _fetch(`${_base()}/api/default-save-dir`, { method: "GET" }, 8000);
      const json = await res.json();
      return { save_dir: json.save_dir || "", os_type: json.os_type || "unknown" };
    } catch {
      return { save_dir: "", os_type: "unknown" };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // downloadFile — POST /api/download  (Direct binary download)
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Download video file directly to user's device.
   * Server downloads the video then streams the MP4 binary to the client.
   *
   * @param {string} url      video URL
   * @param {string} quality  "auto"|"1080p"|"720p"|"480p"|"360p"
   * @param {Function} onProgress  optional callback(percent) — 0-100
   * @returns {Promise<{ blob: Blob, filename: string }>}
   * @throws {Error}
   */
  async function downloadFile(url, quality, onProgress) {
    let res;
    try {
      res = await fetch(`${_base()}/api/download`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url, quality: quality || "auto" }),
      });
    } catch (err) {
      throw new Error(_classifyFetchError(err));
    }

    if (!res.ok) {
      // Try to parse JSON error from server
      let errMsg = `Server error ${res.status}`;
      try {
        const json = await res.json();
        errMsg = json.error || errMsg;
      } catch { /* response wasn't JSON */ }
      throw new Error(errMsg);
    }

    // Extract filename from Content-Disposition header
    const filename = _extractFilename(res) || "video.mp4";

    // Stream the response body with progress tracking
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.length;

      if (onProgress && contentLength > 0) {
        const pct = Math.min((received / contentLength) * 100, 100);
        onProgress(pct);
      }
    }

    const blob = new Blob(chunks, { type: "video/mp4" });
    return { blob, filename };
  }

  /**
   * Extract filename from Content-Disposition header.
   * Handles both filename*=UTF-8'' and filename="" formats.
   */
  function _extractFilename(response) {
    const cd = response.headers.get("content-disposition") || "";
    // Try RFC 5987 encoded filename first
    let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (m) return decodeURIComponent(m[1].trim());
    // Fallback to basic filename
    m = cd.match(/filename="?([^";]+)"?/i);
    if (m) return m[1].trim();
    return null;
  }

  // ── Expose ───────────────────────────────────────────────────────────────
  window.API = {
    checkHealth,
    fetchInfo,
    startDownload,
    downloadFile,
    openProgressStream,
    openFolder,
    getDefaultSaveDir,
  };

}(window));
