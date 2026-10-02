// Checks run after every render of the self-tests (trmnlp-test.config.js `checks`).
// Each named export gets the Screen and returns a problem, a list of them, or nothing.

// an element marked data-forbidden must never be on the screen
exports.forbidden = async (screen) => {
  const n = await screen.locator('[data-forbidden]').count();
  return n ? `${n} element(s) marked data-forbidden` : null;
};
