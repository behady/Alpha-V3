import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Without SENTRY_AUTH_TOKEN the wrapper skips source-map upload and changes nothing else, so a
// build with no Sentry account behind it (CI, a fresh clone) stays identical to before. The
// token, when added, is what turns minified browser stack traces back into readable code.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  widenClientFileUpload: true,
});
