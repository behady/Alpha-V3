/**
 * The client side of the Excel backup.
 *
 * One call: ask the route for the workbook with the signed-in user's token, then hand the bytes
 * to the browser as a download. A temporary anchor rather than a hidden iframe or `window.open`:
 * the iframe trick fails on mobile (see printSrcDoc.ts), and a popup is blocked by default.
 */

import { auth } from "@/lib/firebase";

export class BackupError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BackupError";
    this.status = status;
  }
}

/** Downloads the clinic's Excel backup. Resolves once the browser has been handed the file. */
export async function downloadClinicBackup(clinicId: string, language: "en" | "ar"): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new BackupError("You are signed out. Sign in and try again.", 401);

  const params = new URLSearchParams({ clinicId, lang: language });
  const response = await fetch(`/api/records/backup?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });

  if (!response.ok) {
    let message = "Could not build the backup";
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error) message = payload.error;
    } catch {
      // A route that died before writing JSON — the status is all there is to go on.
    }
    throw new BackupError(message, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  const filename = named || `alpha-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a tick to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
