"use client";

import { useState, useEffect } from "react";
import { UserPlus, Check, X, Loader2, Inbox } from "lucide-react";
import { auth } from "@/lib/firebase";
import { setDoc, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { countedNoun } from "@/lib/arabicCount";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { ASSIGNABLE_ROLES } from "@/lib/permissions";
import { canAddStaff } from "@/lib/subscriptions";

type JoinRequest = {
  id: string;
  userId: string;
  email: string;
  name: string;
  clinicId: string;
  status: "pending" | "approved" | "rejected";
  createdAt?: { toDate?: () => Date } | string;
  // What the onboarding screen historically wrote. Requests filed before the field names were
  // aligned still use these, and showing a blank card is worse than reading both.
  userEmail?: string;
  userName?: string;
  requestedAt?: { toDate?: () => Date } | string;
};

/** Firestore Timestamp, ISO string, or nothing — the collection has all three. */
function formatRequestDate(req: JoinRequest): string {
  const raw = req.createdAt ?? req.requestedAt;
  if (!raw) return "";
  const date =
    typeof raw === "object" && typeof raw.toDate === "function" ? raw.toDate() : new Date(raw as string);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export default function JoinRequests() {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { clinicId, clinic } = useClinic();
  const txt = useSettingsText("joinRequests");
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [staffCount, setStaffCount] = useState(0);
  /**
   * The role each waiting person will be approved as.
   *
   * This screen used to send "Assistant" for everyone, hardcoded — so a dentist who asked to join
   * arrived as an assistant and the admin had to go to Users and change it, which re-deals their
   * switches from the new role's preset. The decision belongs where it is being made.
   */
  const [roleFor, setRoleFor] = useState<Record<string, string>>({});

  const isAr = language === "ar";

  useEffect(() => {
    if (!clinicId) return;

    // Listen to the global join_requests collection where clinicId matches this clinic.
    // Both spellings of the status are matched: the onboarding screen used to file requests as
    // "Pending" while this query only ever asked for "pending", so every request anyone sent was
    // stored correctly and never shown to the admin who was supposed to approve it.
    const q = query(
      getClinicCollection("join_requests"),
      where("clinicId", "==", clinicId),
      where("status", "in", ["pending", "Pending"])
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => {
          const data = doc.data() as JoinRequest;
          return {
            ...data,
            id: doc.id,
            name: data.name || data.userName || "",
            email: data.email || data.userEmail || "",
          } as JoinRequest;
        });
        setRequests(docs);
      },
      (err) => console.error("Join requests listener failed", err)
    );

    const fetchStaffCount = async () => {
      try {
        const snap = await getDocs(getClinicCollection("staff"));
        setStaffCount(snap.size);
      } catch (err) {
        console.error("Error fetching staff count", err);
      }
    };
    void fetchStaffCount();

    return () => unsubscribe();
  }, [clinicId]);

  const roleLabel = (role: string) =>
    ({
      Admin: txt.roleAdmin,
      Dentist: txt.roleDentist,
      Receptionist: txt.roleReceptionist,
      Assistant: txt.roleAssistant,
    })[role] ?? role;

  const handleApprove = async (req: JoinRequest) => {
    if (!clinicId) return;

    if (!canAddStaff(clinic, staffCount)) {
      showToast(txt.limitToast, "error");
      return;
    }

    setProcessingId(req.id);
    try {
      /**
       * Staff record, role grant and status change all happen in one server call.
       * firestore.rules never let a Clinic Admin write another user's `clinicRoles` — roles are
       * granted with the Admin SDK — so doing this from the browser could only ever fail.
       */
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Session expired");

      const res = await fetch("/api/join-requests/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ requestId: req.id, clinicId, role: roleFor[req.id] || "Assistant" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Approve failed");

      setStaffCount((prev) => prev + 1);
      showToast(txt.approved, "success");
    } catch (error) {
      console.error(error);
      const detail = error instanceof Error ? error.message : "";
      showToast(txt.approveFailed + (detail ? `: ${detail}` : ""), "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (req: JoinRequest) => {
    setProcessingId(req.id);
    try {
      await setDoc(getClinicDoc("join_requests", req.id), { status: "rejected" }, { merge: true });
      showToast(txt.rejected, "success");
    } catch (error) {
      console.error(error);
      showToast(txt.rejectFailed, "error");
    } finally {
      setProcessingId(null);
    }
  };

  const atLimit = !canAddStaff(clinic, staffCount);

  // One person is waiting; two are. The noun takes the Arabic count shape, the verb takes the
  // number, and neither is spliced into the other.
  const waitingSentence = `${countedNoun(requests.length, isAr, {
    one: txt.requestOne,
    two: txt.requestTwo,
    few: txt.requestFew,
    many: txt.requestMany,
  })} ${requests.length === 1 ? txt.waitingOne : txt.waitingMany}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* Where these come from, which is the question an admin looking at an empty screen has. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <UserPlus size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {requests.length === 0 ? txt.noneWaiting : waitingSentence}
            </p>
            <p className="max-w-xl text-[11px] font-semibold leading-relaxed text-white/45">
              {txt.howTheyArrive}
            </p>
          </div>

          {atLimit && (
            <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-amber-400/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {txt.atLimit}
            </span>
          )}
        </div>
      </div>

      {atLimit && (
        <p className="rounded-2xl border border-warn/25 bg-warn-tint px-5 py-4 text-[12px] font-semibold leading-relaxed text-warn">
          {txt.limitNote}
        </p>
      )}

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-subtle p-12 text-center">
          <Inbox size={40} className="mb-4 text-ink-muted" strokeWidth={1.5} />
          <p className="text-sm font-bold text-ink-body">{txt.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-md text-xs font-semibold text-ink-muted">{txt.emptyHint}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {requests.map((req) => {
            const busy = processingId === req.id;
            return (
              <li
                key={req.id}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-ink">{req.name || txt.unnamed}</p>
                  <p className="truncate text-[11px] font-medium text-ink-muted">
                    {[req.email, formatRequestDate(req)].filter(Boolean).join(" · ")}
                  </p>
                </div>

                {/* The role is chosen here, not fixed at Assistant and corrected on another screen. */}
                <label className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-ink-muted">
                    {txt.joinAs}
                  </span>
                  <select
                    value={roleFor[req.id] || "Assistant"}
                    onChange={(e) => setRoleFor((prev) => ({ ...prev, [req.id]: e.target.value }))}
                    disabled={busy}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink outline-none transition-colors focus:border-accent disabled:opacity-50"
                  >
                    {ASSIGNABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleApprove(req)}
                    disabled={busy || atLimit}
                    title={atLimit ? txt.limitToast : undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11px] font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {txt.approve}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReject(req)}
                    disabled={busy}
                    aria-label={txt.reject}
                    className="rounded-lg p-2 text-ink-muted transition-all hover:bg-danger-tint hover:text-danger disabled:opacity-50"
                  >
                    <X size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
