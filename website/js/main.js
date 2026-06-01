// ============================================================
// LottoIQ — main.js
// Entry point. Loaded last, after all other JS files.
// Auth runs first — page only renders if member is logged in.
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth gate ─────────────────────────────────────────────
  // initAuth() redirects to /signin if not logged in.
  // If it returns null, a redirect is already in progress.
  const memberData = await initAuth();
  if (!memberData) return;

  // ── Determine active game from URL ────────────────────────
  const path       = window.location.pathname;
  let   activeGame = 'lotto649';

  for (const [slug, key] of Object.entries(GAME_URL_MAP)) {
    if (path.includes(slug)) {
      activeGame = key;
      break;
    }
  }

  // ── Wire all UI event listeners ───────────────────────────
  initUI();

  // ── Load the active game ──────────────────────────────────
  switchGame(activeGame);

});
