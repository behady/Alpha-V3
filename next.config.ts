import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */

  /**
   * The three screens that became tabs of /ai — the brief, the WhatsApp send queue and patient
   * no-shows. Old links land on the right tab instead of a 404.
   *
   * Done here rather than with a `redirect()` in a page: those routes prerender to static HTML, so
   * the redirect only fires once the client router has hydrated — the visitor watches the dashboard
   * shell paint and then jump. A config redirect is answered before anything renders.
   *
   * Not permanent (308): a permanent redirect is cached by the browser forever, and these paths
   * are worth being able to take back.
   */
  async redirects() {
    return [
      { source: "/messages", destination: "/ai?tab=messages", permanent: false },
      { source: "/ai/briefing", destination: "/ai?tab=brief", permanent: false },
      { source: "/ai/attendance", destination: "/ai?tab=noshows", permanent: false },
    ];
  },
};

// Without SENTRY_AUTH_TOKEN the wrapper skips source-map upload and changes nothing else, so a
// build with no Sentry account behind it (CI, a fresh clone) stays identical to before. The
// token, when added, is what turns minified browser stack traces back into readable code.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  widenClientFileUpload: true,
});
