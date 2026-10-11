import type { MetadataRoute } from "next";

/**
 * What a phone shows when the site is added to the home screen.
 *
 * Android and desktop Chrome read this file for the icon, the name under it and the fact that it
 * should open full-screen rather than as a browser tab. iPhone ignores most of it and takes the
 * icon from app/apple-icon.png and the title from `appleWebApp` in app/layout.tsx; both are kept
 * in step with this file. The icons themselves are the Alpha mark alone — the wordmark is
 * unreadable at 180 pixels. The maskable copy keeps the mark inside the inner 80% so Android's
 * circle and squircle crops do not clip it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alpha Dental System",
    short_name: "Alpha Dental",
    description: "Advanced Dental Management",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
