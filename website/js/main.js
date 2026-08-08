// ============================================================
// LottoIQ — main.js
// Entry point. Loaded last, after all other JS files.
// Auth runs first — Standard content is public, so the page
// renders for anonymous visitors too, with Insider-only
// features left locked. initAuth() only returns null on a
// genuine account error (session present but no profile row).
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth gate ─────────────────────────────────────────────
  const memberData = await initAuth();
  if (!memberData) return; // rare: broken session/profile — already redirected to /signin

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
