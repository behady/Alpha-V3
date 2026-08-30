/**
 * Painted before React runs, so a themed clinic does not flash the default palette on every load.
 *
 * This is a string, not code. It is stringified into the document, so it may not reference
 * anything from a module — no imports, no shared constants. The token-name list and the storage
 * key are duplicated here on purpose; that duplication is the price of running before the bundle.
 *
 * Placement matters and is not a matter of taste: this must render as the FIRST CHILD OF <body>,
 * never before it. React 19 does not hoist a classic inline script, so a script emitted outside
 * <body> gets relocated into <head> by the HTML parser — giving <html> children React did not
 * render, which is a structural hydration mismatch that suppressHydrationWarning cannot cover.
 *
 * It deliberately does NOT read `?clinic=` or `superAdminClinicId`. Those are superadmin
 * impersonation channels, and the script cannot know synchronously whether the viewer is a
 * superadmin — so honouring them would let any link of the form `/?clinic=<someone-else's-id>`
 * paint a stranger's branding for a normal user.
 */
export const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var NAMES = ["surface-page","surface","surface-subtle","surface-muted","surface-accent","line","line-strong","ink","ink-slab","ink-strong","ink-body","ink-muted","ink-faint","ink-on-accent","accent","accent-soft","accent-strong","accent-tint","ok","ok-tint","warn","warn-tint","danger","danger-tint","info","info-tint"];
    var raw = null;
    try { raw = localStorage.getItem("alpha.theme.v1"); } catch (e) { return; }
    if (!raw) return;
    var cache = JSON.parse(raw);
    if (!cache || cache.v !== 1 || !cache.byClinic) return;

    var id = null;
    try { id = sessionStorage.getItem("preferredClinicId"); } catch (e) {}
    if (!id || !cache.byClinic[id]) id = cache.clinicId;
    var entry = id ? cache.byClinic[id] : null;
    if (!entry || !entry.tokens) return;

    var ok = /^#[0-9A-Fa-f]{3,8}$|^rgba?\\([\\d\\s.,%\\/]+\\)$|^hsla?\\([\\d\\s.,%\\/]+\\)$/;
    var root = document.documentElement;
    for (var i = 0; i < NAMES.length; i++) {
      var n = NAMES[i];
      var v = entry.tokens[n];
      if (typeof v === "string" && v.length <= 40 && ok.test(v)) {
        root.style.setProperty("--" + n, v);
      }
    }
  } catch (e) {
    /* a theme is never worth a blank page */
  }
})();
`.trim();
