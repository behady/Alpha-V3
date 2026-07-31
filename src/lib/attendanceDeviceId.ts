const STORAGE_KEY = "alpha_device_fingerprint";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000;SameSite=Lax`;
}

/** Keep device id in localStorage, sessionStorage, and a cookie so clears are less likely to break attendance. */
export function persistDeviceId(id: string) {
  if (!id || typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  try {
    writeCookie(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getStoredDeviceId(): string {
  if (typeof window === "undefined") return "";

  let id =
    localStorage.getItem(STORAGE_KEY) ||
    sessionStorage.getItem(STORAGE_KEY) ||
    readCookie(STORAGE_KEY) ||
    "";

  if (!id) {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 12);
    id = `dev_${uuid}_${Date.now()}`;
  }

  persistDeviceId(id);
  return id;
}
