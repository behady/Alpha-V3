const SUMMON_TAG = "alpha-reception-summon";

export type SummonNotificationPermission = "granted" | "denied" | "default" | "unsupported";

export function getSummonNotificationPermission(): SummonNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as SummonNotificationPermission;
}

/** Must be called from a user gesture (button click). */
export async function requestSummonNotificationPermission(): Promise<SummonNotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result as SummonNotificationPermission;
  } catch {
    return Notification.permission as SummonNotificationPermission;
  }
}

export function showSummonNotification(args: {
  title: string;
  body: string;
  summonId: string;
  onClickFocus?: () => void;
}): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const n = new Notification(args.title, {
      body: args.body,
      tag: SUMMON_TAG,
      requireInteraction: true,
      silent: false,
    });

    n.onclick = () => {
      window.focus();
      args.onClickFocus?.();
      n.close();
    };
  } catch {
    /* ignore */
  }
}
