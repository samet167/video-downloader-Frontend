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
  BACKEND_URL: "http://127.0.0.1:8080",

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
