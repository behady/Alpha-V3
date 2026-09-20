"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Bell,
  BellRing,
  Calendar,
  CheckCheck,
  CreditCard,
  MessageSquareWarning,
  Package,
  Sunrise,
  UserPlus,
  WifiOff,
  X,
} from "lucide-react";
import { query, orderBy, limit, onSnapshot, where, writeBatch, arrayUnion } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { enableFcmPushForUser } from "@/lib/fcmClient";
import { notifyEvent, type NotifyGroup } from "@/lib/notificationCatalog";

/**
 * The notification centre, in the corner of the top bar.
 *
 * What it used to be: every row in `clinics/{id}/notifications`, ordered by date, shown to
 * everyone at the clinic. One writer existed — lab cases — so it was almost always empty while
 * thirty other kinds of alert went straight to people's phones and were never recorded anywhere.
 * Opening it marked every row read *for the whole clinic*, because "read" was one boolean on a
 * shared document, so whoever looked first hid the badge from everybody else.
 *
 * What it is now: this person's own feed. Every alert in the catalogue writes a row here (subject
 * to the clinic's settings), each row names its audience, and read and dismissed are per person.
 * The query is `audience array-contains me`, which is why a receptionist never sees the owner's
 * evening money figure even though both live in one clinic-wide collection.
 *
 * Dismissing hides a row for the person who dismissed it and nobody else — a shared row cannot be
 * deleted by one reader without deleting somebody else's copy of it. Old rows are swept up by a
 * daily Cloud Function rather than by anybody's Clear button.
 */

interface AppNotification {
  id: string;
  title: string;
  body: string;
  eventType: string;
  group?: NotifyGroup | null;
  actionUrl?: string | null;
  audience?: string[];
  readBy?: string[];
  dismissedBy?: string[];
  /** The pre-catalogue shape: one shared boolean. Read so old rows still look sane. */
  read?: boolean;
  createdAt?: { toMillis?: () => number } | null;
}

/** One icon per group, so a glance at the list reads as categories rather than a wall of text. */
const GROUP_ICON: Record<NotifyGroup, typeof Bell> = {
  unanswered: MessageSquareWarning,
  frontdesk: Calendar,
  leads: UserPlus,
  briefs: Sunrise,
  money: CreditCard,
  clinic: Package,
  delivery: WifiOff,
};

function timeAgo(ms: number, isAr: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return isAr ? "الآن" : "now";
  if (mins < 60) return isAr ? `${mins} دقيقة` : `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isAr ? `${hours} ساعة` : `${hours}h`;
  const days = Math.round(hours / 24);
  return isAr ? `${days} يوم` : `${days}d`;
}

/**
 * `variant="dark"` is the form that sits on the black top bar. The default white-card button is
 * for anywhere else — on black it reads as a hole punched in the bar.
 */
export default function NotificationBell({ variant = "default" }: { variant?: "default" | "dark" } = {}) {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const isAr = language === "ar";
  const uid = user?.uid || null;

  const [rows, setRows] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /**
   * Device push registration. Historically only the reception-summon overlay ever asked for
   * notification permission, so admins and dentists silently had zero registered devices and
   * every push went nowhere. Two repairs: already-granted browsers re-register their token
   * quietly on load, and everyone else gets a visible "enable" button inside the bell.
   */
  const [pushState, setPushState] = useState<"unknown" | "needed" | "enabling" | "on" | "blocked">(() => {
    // Read at mount rather than in an effect. The browser's answer is available synchronously and
    // never changes without a user gesture, so an effect would only add a render for nothing.
    if (typeof window === "undefined" || !("Notification" in window)) return "unknown";
    if (Notification.permission === "denied") return "blocked";
    return Notification.permission === "granted" ? "on" : "needed";
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    // Permission exists but the token may never have been saved — self-heal silently. This is the
    // repair for a browser that said yes months ago to a feature that never registered it.
    if (Notification.permission !== "granted") return;
    void enableFcmPushForUser().then((r) => setPushState(r.ok ? "on" : "needed"));
  }, []);

  const enablePush = async () => {
    setPushState("enabling");
    const r = await enableFcmPushForUser();
    if (r.ok) setPushState("on");
    else if (r.reason === "denied") setPushState("blocked");
    else setPushState("needed");
  };

  useEffect(() => {
    if (!uid) return;
    // Addressed to me. Rows written before the catalogue existed carry no `audience` and so are
    // not returned — deliberately: nobody can say who they were for, and inventing an answer
    // would show one person's alert to the whole clinic all over again.
    const q = query(
      getClinicCollection("notifications"),
      where("audience", "array-contains", uid),
      orderBy("createdAt", "desc"),
      limit(40),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AppNotification)),
      () => {
        // A missing composite index is the one predictable failure here, and it must not take the
        // top bar down with it — an empty bell is survivable, a crashing nav bar is not.
        setRows([]);
      },
    );
    return unsubscribe;
  }, [uid]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visible = useMemo(
    () => rows.filter((n) => !(n.dismissedBy || []).includes(uid || "")),
    [rows, uid],
  );
  const unread = useMemo(
    () => visible.filter((n) => !(n.readBy || []).includes(uid || "")),
    [visible, uid],
  );

  const markAllAsRead = async () => {
    if (!uid || unread.length === 0) return;
    const batch = writeBatch(db);
    // arrayUnion, not a rewrite: two people opening the bell at the same moment must not erase
    // each other from the list of who has read it.
    unread.forEach((n) => batch.update(getClinicDoc("notifications", n.id), { readBy: arrayUnion(uid) }));
    await batch.commit().catch(() => {});
  };

  const dismissAll = async () => {
    if (!uid || visible.length === 0) return;
    const batch = writeBatch(db);
    visible.forEach((n) =>
      batch.update(getClinicDoc("notifications", n.id), { dismissedBy: arrayUnion(uid), readBy: arrayUnion(uid) }),
    );
    await batch.commit().catch(() => {});
    setIsOpen(false);
  };

  const dismissOne = async (id: string) => {
    if (!uid) return;
    const batch = writeBatch(db);
    batch.update(getClinicDoc("notifications", id), { dismissedBy: arrayUnion(uid), readBy: arrayUnion(uid) });
    await batch.commit().catch(() => {});
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    if (!isOpen && unread.length > 0) void markAllAsRead();
  };

  const open = (n: AppNotification) => {
    if (n.actionUrl) {
      router.push(n.actionUrl);
      setIsOpen(false);
    }
  };

  if (!uid) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        aria-label={isAr ? "الإشعارات" : "Notifications"}
        className={
          variant === "dark"
            ? "relative grid size-9 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            : "relative p-2.5 bg-white hover:bg-gray-50 rounded-xl text-gray-600 transition-colors border border-gray-200 shadow-sm"
        }
      >
        <Bell size={variant === "dark" ? 17 : 18} />
        {unread.length > 0 && (
          /* `-end-1.5`, not `-right-1.5`: in Arabic the whole bar mirrors and a hard-coded right
             put the count on the wrong side of the bell. */
          <span className="absolute -top-1.5 -end-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white shadow-sm animate-in zoom-in">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute end-0 mt-3 w-80 md:w-96 bg-surface rounded-3xl shadow-2xl border border-line overflow-hidden z-[200] animate-in slide-in-from-top-4"
          dir={isRTL ? "rtl" : "ltr"}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-subtle px-5 py-3.5">
            <h3 className="font-black text-ink">{isAr ? "الإشعارات" : "Notifications"}</h3>
            {visible.length > 0 && (
              <button
                onClick={() => void dismissAll()}
                className="flex items-center gap-1 text-xs font-bold text-ink-faint transition-colors hover:text-ink"
              >
                <CheckCheck size={14} /> {isAr ? "خلصت من دي" : "Clear mine"}
              </button>
            )}
          </div>

          {pushState === "needed" && (
            <button
              onClick={enablePush}
              className="flex w-full items-center gap-2.5 border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-start transition-colors hover:bg-emerald-100"
            >
              <BellRing size={16} className="shrink-0 text-emerald-600" />
              <span className="text-xs font-black text-emerald-800">
                {isAr
                  ? "فعّل الإشعارات على الجهاز ده — التنبيهات توصلك هنا"
                  : "Enable notifications on this device — alerts arrive here"}
              </span>
            </button>
          )}
          {pushState === "blocked" && (
            <p className="border-b border-line bg-surface-subtle px-5 py-3 text-[11.5px] font-bold text-ink-muted">
              {isAr
                ? "الإشعارات مرفوضة في المتصفح ده. افتح إعدادات الموقع واسمح بالإشعارات."
                : "Notifications are blocked in this browser. Allow them in the site settings to get alerts here."}
            </p>
          )}

          <div className="max-h-[22rem] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] font-medium text-ink-faint">
                {isAr ? "مفيش حاجة جديدة." : "Nothing new."}
              </p>
            ) : (
              visible.map((n) => {
                const meta = notifyEvent(n.eventType);
                const Icon = GROUP_ICON[(n.group || meta?.group || "clinic") as NotifyGroup] || Bell;
                const isUnread = !(n.readBy || []).includes(uid);
                const ms = n.createdAt?.toMillis ? n.createdAt.toMillis() : 0;
                return (
                  <div
                    key={n.id}
                    className={`group flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 ${
                      isUnread ? "bg-accent/[0.06]" : ""
                    }`}
                  >
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted text-ink-body">
                      <Icon size={14} />
                    </span>
                    <button
                      onClick={() => open(n)}
                      disabled={!n.actionUrl}
                      className="min-w-0 flex-1 text-start disabled:cursor-default"
                    >
                      <p className="text-[13px] font-black leading-snug text-ink">{n.title}</p>
                      <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">{n.body}</p>
                      {ms > 0 && (
                        <p className="mt-1 font-figure text-[10.5px] tracking-tight text-ink-faint">
                          {timeAgo(ms, isAr)}
                        </p>
                      )}
                    </button>
                    <button
                      onClick={() => void dismissOne(n.id)}
                      aria-label={isAr ? "إخفاء" : "Dismiss"}
                      title={isAr ? "إخفاء" : "Dismiss"}
                      className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <Link
            href="/settings/alerts"
            className="block border-t border-line bg-surface-subtle px-5 py-2.5 text-center text-[11.5px] font-black text-ink-muted transition-colors hover:text-ink"
          >
            {isAr ? "اظبط إشعاراتك" : "Choose what you get"}
          </Link>
        </div>
      )}
    </div>
  );
}
