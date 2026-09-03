/**
 * js/config.js — Frontend Configuration
 * ========================================
 * Single source of truth for runtime settings.
 * Loaded first (see index.html script order) and exposed as window.CONFIG.
 *
 * Production:
 *   BACKEND_URL = "https://video-downloader-backend-1-5oer.onrender.com"
 *
 * Local development (override):
 *   Change BACKEND_URL to "http://127.0.0.1:5000"
 */

"use strict";

const CONFIG = {
  /** Base URL of the Flask backend — NO trailing slash */
  BACKEND_URL: (function() {
    if (typeof window !== "undefined" && window.ENV && window.ENV.API_BASE) {
      return window.ENV.API_BASE.replace(/\/api\/?$/, "");
    }
    const isLocal = typeof window !== "undefined" && 
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "");
    return isLocal 
      ? "http://127.0.0.1:5000"
      : "https://video-downloader-backend-1-5oer.onrender.com";
  })(),

  /** Milliseconds before an /api/info request is considered timed out */
  REQUEST_TIMEOUT_MS: 30000,

  /**
   * Milliseconds between SSE keep-alive checks.
   * SSE itself is push-based; this guards against stale connections.
   */
  SSE_HEARTBEAT_MS: 500,

  /**
   * How long (ms) to wait after a "done" event before auto-closing the SSE.
   * Gives the browser time to receive the final event.
   */
  SSE_CLOSE_DELAY_MS: 1500,
};

window.CONFIG = CONFIG;
