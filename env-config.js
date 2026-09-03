/**
 * env-config.js — Runtime Environment Configuration
 * ====================================================
 * This file provides the backend API base URL at runtime.
 *
 * LOCAL DEV:  Change API_BASE to "http://127.0.0.1:5000/api"
 * PRODUCTION: Points to Render backend.
 *
 * On VERCEL: the Build Command overwrites this file:
 *   echo "window.ENV={API_BASE:'$API_BASE'};" > env-config.js
 *
 * See README.md → Deploy to Vercel → Step 5.
 */
window.ENV = {
  API_BASE: "https://everything-attending-proceeding-dictionary.trycloudflare.com/api"
};
