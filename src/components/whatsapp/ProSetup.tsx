"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Send, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import type { ClinicLayer, DroppedLine, ReplaySummary } from "@/lib/botPro/layer";
import { replayLimit, replayShortfalls } from "@/lib/botPro/replayVerdict";

const API = "/api/whatsapp/pro-onboarding";
const OWNER_TEXT_MAX = 2000;
const BUSY_WAIT_MS = 3000;
/** A failed step is tried again this many times before the screen offers Continue. */
const STEP_RETRIES = 2;

type ScanState = { status: "idle" | "running" | "summarizing" | "done" | "failed"; total: number; done: number; chatsRead: number; error?: string };
type PublicState = { scan: ScanState; learned: string[]; questions: string[]; draft: ClinicLayer; hasPreviousDraft?: boolean; liveVersion: string | null };
type ChatRow = { role: "ai" | "owner"; text: string; at: number };
type VersionRow = { id: string; version: number; createdAt: number; createdBy: string; passed: boolean; breaks: number };
type Loaded = { state: PublicState; chat: ChatRow[]; versions: VersionRow[] };
type Boxes = { rules: string; handoff: string; never: string; prompt: string };
type Api = { ok?: boolean; error?: string; [k: string]: unknown };

const EMPTY_BOXES: Boxes = { rules: "", handoff: "", never: "", prompt: "" };
const lines = (s: string): string[] => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const boxesOf = (l: ClinicLayer): Boxes => ({
  rules: (l.rules ?? []).join("\n"),
  handoff: (l.handoffWhen ?? []).join("\n"),
  never: (l.neverSay ?? []).join("\n"),
  prompt: l.promptSection ?? "",
});
const layerOf = (b: Boxes): ClinicLayer => ({ rules: lines(b.rules), handoffWhen: lines(b.handoff), neverSay: lines(b.never), promptSection: b.prompt.trim() });
const draftKey = (l: ClinicLayer): string => JSON.stringify([l.rules, l.handoffWhen, l.neverSay, l.promptSection]);

/** A call to one of the four routes: the clinic and the Firebase ID token go with every one. */
async function call(url: string, init: { method: "GET" | "POST" | "PUT"; body?: Record<string, unknown> }): Promise<{ status: number; body: Api }> {
  const u = auth.currentUser;
  if (!u) throw Object.assign(new Error("auth"), { status: 401 });
  const token = await u.getIdToken();
  const res = await fetch(url, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Api;
  return { status: res.status, body };
}

/**
 * "Teach Pro your clinic": Pro reads the old chats, the owner talks to it, the draft layer is
 * edited, tested and put live. Every call goes to the four admin routes; the screen holds no
 * secrets and decides nothing the server does not check again.
 */
export default function ProSetup({ open, onClose, clinicId }: { open: boolean; onClose: () => void; clinicId: string }) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";

  const [data, setData] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [boxes, setBoxes] = useState<Boxes>(EMPTY_BOXES);
  const [stale, setStale] = useState(false);
  const [dropped, setDropped] = useState<DroppedLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatNote, setChatNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [test, setTest] = useState<{ published: boolean; madeLive: boolean; versionId: string; summary: ReplaySummary } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Whether a step loop is running right now, and why the last one gave up: a scan that is
  // running with no loop active needs the Continue button.
  const [loopActive, setLoopActive] = useState(false);
  const [stepError, setStepError] = useState("");
  // The owner's message, shown while Pro's reply is on its way.
  const [pending, setPending] = useState<string | null>(null);

  // The step loop and the late replies stop here: set on close and on unmount, checked every turn.
  const abortedRef = useRef(true);
  // Two loops would read the same chats twice and fight over the lock.
  const loopRunning = useRef(false);
  const dirtyRef = useRef(false);
  // The same fact as dirtyRef, kept as state so the buttons follow it on screen.
  const [dirty, setDirtyState] = useState(false);
  const setDirty = useCallback((v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  }, []);
  const syncedKey = useRef(draftKey({ rules: [], handoffWhen: [], neverSay: [], promptSection: "" }));
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const t = {
    title: isAr ? "علّم Pro عيادتك" : "Teach Pro your clinic",
    sub: isAr ? "Pro بيقرا محادثاتك القديمة، وانت بتعدّل طريقته. مفيش حاجة بتشتغل مع المرضى غير لما تنشر." : "Pro reads your old chats and you shape how it talks. Nothing reaches patients until you publish.",
    close: isAr ? "إغلاق" : "Close",
    p1: isAr ? "١. قراءة محادثاتك القديمة" : "1. Reading your old chats",
    p2: isAr ? "٢. اتكلم مع Pro" : "2. Chat with Pro",
    p3: isAr ? "٣. طبقة عيادتك" : "3. Your clinic layer",
    cont: isAr ? "كمّل" : "Continue",
    stalled: isAr ? "القراءة وقفت في النص." : "Reading paused partway.",
    unsavedClose: isAr ? "فيه تعديلات مش متحفظة. تقفل برضه؟" : "You have unsaved changes. Close anyway?",
    start: isAr ? "ابدأ" : "Start",
    startAgain: isAr ? "ابدأ من جديد" : "Start again",
    idle: isAr ? "Pro هيقرا آخر محادثات عيادتك ويتعلم منها طريقتكم." : "Pro will read your latest chats and learn how your clinic talks.",
    reading: isAr ? "بيقرا... سيب الشاشة مفتوحة." : "Reading... keep this screen open.",
    chatsRead: (n: number) => (isAr ? `${n.toLocaleString("ar-EG")} محادثة اتقرت` : `${n} chats read`),
    scanDone: isAr ? "خلّص القراءة. كمّل في الشات." : "Done reading. Carry on in the chat.",
    scanFailed: isAr ? "القراءة وقفت." : "Reading stopped.",
    chatEmpty: isAr ? "الشات هيتفتح بعد ما القراءة تخلص." : "The chat opens when reading is done.",
    chatLocked: isAr ? "ابدأ القراءة الأول." : "Start reading first.",
    placeholder: isAr ? "قول لـ Pro إزاي تحب يتكلم..." : "Tell Pro how you want it to talk...",
    send: isAr ? "إرسال" : "Send",
    cap: isAr ? "وصلت لـ ٦٠ رسالة النهارده — كمّل بكرة." : "You've reached today's 60 messages — continue tomorrow.",
    notReady: isAr ? "Pro لسه بيقرا. استنى لحد ما يخلّص." : "Pro is still reading. Wait until it finishes.",
    tooLong: isAr ? "الرسالة طويلة. اختصرها." : "That message is too long. Shorten it.",
    emptyMsg: isAr ? "اكتب رسالة الأول." : "Write a message first.",
    modelDown: isAr ? "Pro مردّش. جرّب تاني." : "Pro did not answer. Try again.",
    proThinking: isAr ? "Pro بيفكّر..." : "Pro is thinking...",
    reload: isAr ? "Pro عدّل المسودة — حمّلها" : "Pro updated the draft — reload",
    reloadBtn: isAr ? "حمّل" : "Reload",
    rules: isAr ? "قواعد الكلام والبيع (سطر لكل قاعدة)" : "How to talk and sell (one rule per line)",
    handoff: isAr ? "حالات التحويل للفريق (سطر لكل حالة)" : "When to hand over to your team (one per line)",
    never: isAr ? "عبارات ممنوع تتقال (سطر لكل عبارة)" : "Never say (one phrase per line)",
    section: isAr ? "كلمة عن أسلوب العيادة" : "A note on your clinic's style",
    save: isAr ? "حفظ المسودة" : "Save draft",
    unsaved: isAr ? "فيه تعديلات لسه متحفظتش." : "You have changes that are not saved.",
    dropNote: isAr ? "الأسطر دي ما اتحفظتش:" : "These lines were not kept:",
    price: isAr ? "الأسعار مكانها قايمة الأسعار" : "prices belong in the price list",
    medicine: isAr ? "الأدوية مش جزء من الرد الآلي" : "medicines aren't part of auto-reply",
    number: isAr ? "الأرقام زي المواعيد والأعداد مش بتتحفظ في القواعد — اكتبها من غير الرقم" : "numbers like times and counts aren't kept in the rules — reword without the number",
    undo: isAr ? "رجّع آخر تعديل" : "Undo last change",
    undone: isAr ? "رجعت المسودة زي ما كانت قبل آخر تعديل." : "The draft is back to how it was before the last change.",
    nothingToUndo: isAr ? "مفيش تعديل نرجّعه." : "There is no change to undo.",
    undoHint: isAr ? "احفظ أو الغِ تعديلاتك الأول." : "Save your edits first.",
    saved: isAr ? "اتحفظت المسودة" : "Draft saved",
    saveFailed: isAr ? "المسودة ما اتحفظتش. جرّب تاني." : "Could not save the draft. Try again.",
    publish: isAr ? "انشر" : "Publish",
    publishing: isAr ? "بنجرّب... حوالي ٢–٣ دقايق" : "Testing ~2–3 minutes",
    publishHint: isAr ? "الاختبار بيشتغل على المسودة المحفوظة. احفظ الأول." : "The test runs on the saved draft. Save first.",
    passed: isAr ? "عدّى الاختبار واتنشر." : "Passed and published.",
    passedNotLive: (id: string) =>
      isAr
        ? `عدّى الاختبار واتحفظ كنسخة ${id}، بس مش شغّالة: النسخة الشغّالة اتغيّرت وانت بتجرّب، فسبناها زي ما اخترتها. تقدر تشغّلها من النسخ تحت.`
        : `Passed and saved as ${id}, but not made live: the live version was changed while the test ran, so it was left as you set it. You can make it live from Versions below.`,
    failedTest: isAr ? "ما عدّاش الاختبار، فمتنشرش." : "Did not pass, so nothing was published.",
    whyFailed: isAr ? "ليه ما عدّاش:" : "Why it did not pass:",
    turnsLbl: isAr ? "رسايل اتجرّبت" : "Turns tested",
    unavailableLbl: isAr ? "Pro ما ردّش" : "Pro could not answer",
    handoffsLbl: isAr ? "اتحوّلت للفريق من غير داعي" : "Handed to the team unexpectedly",
    offLbl: isAr ? "تصرّف غير المتوقع" : "Off expectation",
    noTurns: isAr ? "مفيش ولا محادثة اتجرّبت." : "No conversation was tested.",
    breaksWhy: (n: number) => (isAr ? `${n.toLocaleString("ar-EG")} ردود كسرت قاعدة من القواعد المقفولة.` : `${n} replies broke a locked rule.`),
    unavailableWhy: (n: number, of: number, max: number) =>
      isAr
        ? `Pro ما قدرش يرد في ${n.toLocaleString("ar-EG")} من ${of.toLocaleString("ar-EG")} رسالة (المسموح ${max.toLocaleString("ar-EG")}).`
        : `Pro could not answer ${n} of ${of} turns (at most ${max} allowed).`,
    handoffsWhy: (n: number, of: number, max: number) =>
      isAr
        ? `Pro حوّل ${n.toLocaleString("ar-EG")} من ${of.toLocaleString("ar-EG")} رسالة للفريق وكان المفروض يرد (المسموح ${max.toLocaleString("ar-EG")}). غالباً قاعدة أو عبارة ممنوعة بتوقف ردود عادية.`
        : `Pro handed ${n} of ${of} turns to the team where it should have answered (at most ${max} allowed). A rule or never-say phrase is probably stopping normal replies.`,
    timedOut: isAr ? "الاختبار أخد وقت أطول من اللازم، فالرسايل اللي ما لحقش يجرّبها اتحسبت إن Pro ما ردّش عليها." : "The test took too long; the turns it did not reach count as ones Pro could not answer.",
    rulesLbl: isAr ? "القاعدة" : "Rule",
    breaksTitle: isAr ? "الردود اللي فيها مشكلة" : "Replies that broke a rule",
    asked: isAr ? "السؤال" : "Question",
    replied: isAr ? "رد Pro" : "Pro replied",
    busy: isAr ? "فيه عملية تانية شغالة دلوقتي. استنى شوية وجرّب تاني." : "Something else is running right now. Wait a moment and try again.",
    emptyLayer: isAr ? "المسودة فاضية. اتكلم مع Pro أو اكتب قاعدة الأول." : "The draft is empty. Chat with Pro or write a rule first.",
    testBroke: isAr ? "الاختبار نفسه ما اشتغلش. جرّب تاني بعد شوية." : "The test itself could not run. Try again in a moment.",
    generic: isAr ? "حصلت مشكلة. جرّب تاني." : "Something went wrong. Try again.",
    notAllowed: isAr ? "دي لمدير العيادة بس، ومحتاجة إضافة Pro." : "Only a clinic Admin can use this, and it needs the Pro add-on.",
    noKey: isAr ? "مفتاح Pro مش متضبط. كلّم الدعم." : "The Pro key is not set. Contact support.",
    auth: isAr ? "سجّل دخول تاني وجرّب." : "Sign in again and try once more.",
    loadFailed: isAr ? "مقدرناش نفتح الشاشة." : "Could not open this screen.",
    retry: isAr ? "حاول تاني" : "Try again",
    versions: isAr ? "النسخ" : "Versions",
    noVersions: isAr ? "لسه مفيش نسخ منشورة." : "No published versions yet.",
    live: isAr ? "شغّالة" : "Live",
    makeLive: isAr ? "شغّلها" : "Make live",
    noLayer: isAr ? "من غير طبقة العيادة" : "No clinic layer",
    layerOff: isAr ? "Pro شغال دلوقتي من غير طبقة العيادة." : "Pro is now answering without the clinic layer.",
    nowLive: isAr ? "النسخة دي شغّالة دلوقتي." : "That version is live now.",
    passedLbl: isAr ? "عدّت الاختبار" : "Passed",
    breaksLbl: (n: number) => (isAr ? `${n.toLocaleString("ar-EG")} مشاكل` : `${n} breaks`),
    by: isAr ? "بواسطة" : "by",
    tryHint: isAr ? "جرّب المسودة الأول في شات التجربة: شغّل «جرّب الرد المتقدم (Pro)» و«جرّب القواعد الجديدة (المسودة)»." : "Try the draft first in the test chat: turn on Try Pro and Use the draft layer.",
  };

  const reasonOf = (why: DroppedLine["why"]) => (why === "price" ? t.price : why === "number" ? t.number : t.medicine);
  /** A checkReply rule id in words; an id this screen does not know is shown as it is. */
  const ruleName = (rule: string): string => {
    const names: Record<string, [string, string]> = {
      price: ["سعر مش من قايمة الأسعار", "a price not from the price list"],
      clock: ["ميعاد مش من المواعيد الفاضية", "a time that is not a free slot"],
      drug: ["اسم دوا", "a medicine name"],
      never_say: ["عبارة ممنوعة", "a never-say phrase"],
      claims_human: ["قال إنه إنسان", "claimed to be human"],
      volunteers_ai: ["قال إنه AI من غير ما يتسأل", "brought up being an AI unasked"],
      script: ["لغة غلط", "the wrong language"],
    };
    const n = names[rule];
    return n ? (isAr ? n[0] : n[1]) : rule;
  };

  /** What a refused or failed call says, in words (the status alone is not enough: busy is a 200). */
  const errorText = (status: number, body: Api): string => {
    if (status === 401) return t.auth;
    if (status === 403) return t.notAllowed;
    if (status === 503) return t.noKey;
    if (body.error === "busy") return t.busy;
    if (body.error === "empty") return t.emptyLayer;
    if (body.error === "test_failed_to_run") return t.testBroke;
    if (body.error === "nothing_to_undo") return t.nothingToUndo;
    return t.generic;
  };

  const applyBoxes = useCallback((layer: ClinicLayer) => {
    setBoxes(boxesOf(layer));
    syncedKey.current = draftKey(layer);
    setDirty(false);
    setStale(false);
  }, [setDirty]);

  /** A draft that came from the server: it replaces the boxes unless the owner is mid-edit. */
  const receiveDraft = useCallback(
    (layer: ClinicLayer) => {
      if (!dirtyRef.current) {
        applyBoxes(layer);
      } else if (draftKey(layer) !== syncedKey.current) {
        setStale(true);
      }
    },
    [applyBoxes],
  );

  const refresh = useCallback(async (): Promise<Loaded | null> => {
    try {
      const { status, body } = await call(`${API}?clinicId=${encodeURIComponent(clinicId)}`, { method: "GET" });
      if (abortedRef.current) return null;
      if (!body.ok || !body.state) {
        if (status === 401 || status === 403) showToast(errorText(status, body), "error");
        setLoadFailed(true);
        return null;
      }
      const loaded: Loaded = {
        state: body.state as PublicState,
        chat: Array.isArray(body.chat) ? (body.chat as ChatRow[]) : [],
        versions: Array.isArray(body.versions) ? [...(body.versions as VersionRow[])].sort((a, b) => b.version - a.version) : [],
      };
      setLoadFailed(false);
      setData(loaded);
      receiveDraft(loaded.state.draft);
      return loaded;
    } catch {
      if (!abortedRef.current) setLoadFailed(true);
      return null;
    }
    // errorText is rebuilt every render from the language; the load does not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, receiveDraft, showToast]);

  const setScan = (scan: ScanState) => setData((d) => (d ? { ...d, state: { ...d.state, scan } } : d));

  /**
   * Reads one batch per call until the scan leaves running/summarizing, a step keeps failing, or
   * the dialog closes. A failed step is tried again twice (after the same 3 s wait as busy);
   * after that the loop gives up and the screen offers Continue.
   */
  const runLoop = useCallback(async () => {
    if (loopRunning.current) return;
    loopRunning.current = true;
    setLoopActive(true);
    setStepError("");
    let fails = 0;
    const wait = () => new Promise((r) => setTimeout(r, BUSY_WAIT_MS));
    try {
      while (!abortedRef.current) {
        let reply: { status: number; body: Api } | null = null;
        try {
          reply = await call(`${API}/scan`, { method: "POST", body: { clinicId, action: "step" } });
        } catch {
          reply = null;
        }
        if (abortedRef.current) break;
        if (!reply || !reply.body.ok || !reply.body.state) {
          // 401/403/503 will not fix themselves; anything else (500, 502, a dropped token) may.
          const hopeless = reply !== null && (reply.status === 401 || reply.status === 403 || reply.status === 503);
          if (!hopeless && fails < STEP_RETRIES) {
            fails += 1;
            await wait();
            continue;
          }
          const msg = reply ? errorText(reply.status, reply.body) : t.generic;
          setStepError(msg);
          showToast(msg, "error");
          break;
        }
        fails = 0;
        const { body } = reply;
        const scan = (body.state as PublicState).scan ?? (body.state as unknown as ScanState);
        setScan(scan);
        if (body.busy) {
          // Another step holds the lock: wait, then ask again.
          await wait();
          continue;
        }
        if (scan.status !== "running" && scan.status !== "summarizing") break;
      }
    } finally {
      loopRunning.current = false;
      setLoopActive(false);
      if (!abortedRef.current) void refresh();
    }
    // The copy and the toast are stable enough for a loop that only reads clinicId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, refresh, showToast]);

  // Opening loads the state (and picks a scan back up if it was left running); closing and
  // unmounting stop the loop and make late replies land nowhere.
  useEffect(() => {
    if (!open) {
      abortedRef.current = true;
      return;
    }
    abortedRef.current = false;
    // Nothing from the last time may flash: the old scan state, draft and notes are cleared first.
    // While loading, "a loop may be about to start" keeps Continue from flashing too.
    setData(null);
    setLoadFailed(false);
    setStepError("");
    setPending(null);
    setText("");
    setLoopActive(true);
    setDirty(false);
    setStale(false);
    setTest(null);
    setPublishNote("");
    setDropped([]);
    setChatNote("");
    void refresh().then((loaded) => {
      const s = loaded?.state.scan.status;
      if (loaded && (s === "running" || s === "summarizing")) void runLoop();
      else setLoopActive(loopRunning.current);
    });
    return () => {
      abortedRef.current = true;
    };
  }, [open, refresh, runLoop, setDirty]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [data?.chat.length, sending, pending]);

  // Unsaved box edits are asked about before the screen goes away.
  const requestClose = useCallback(async () => {
    if (dirty && !(await confirm(t.unsavedClose))) return;
    onClose();
    // t is rebuilt each render from the language; only its copy is read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, confirm, onClose, isAr]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  if (!open) return null;

  const scan = data?.state.scan;
  const going = scan?.status === "running" || scan?.status === "summarizing";
  const scanDone = scan?.status === "done";
  const pct = scan && scan.total > 0 ? Math.min(100, Math.round((scan.done / scan.total) * 100)) : 0;
  const liveVersion = data?.state.liveVersion ?? null;

  const startScan = async () => {
    if (starting || going) return;
    setStarting(true);
    try {
      const { status, body } = await call(`${API}/scan`, { method: "POST", body: { clinicId, action: "start" } });
      if (abortedRef.current) return;
      if (!body.ok || !body.state) {
        showToast(errorText(status, body), "error");
        return;
      }
      const next = (body.state as PublicState).scan;
      setScan(next);
      if (body.busy) showToast(t.busy, "error");
      if (next.status === "running" || next.status === "summarizing") void runLoop();
    } catch {
      if (!abortedRef.current) showToast(t.generic, "error");
    } finally {
      setStarting(false);
    }
  };

  const edit = (key: keyof Boxes, value: string) => {
    setDirty(true);
    setBoxes((b) => ({ ...b, [key]: value }));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { status, body } = await call(API, { method: "PUT", body: { clinicId, draft: layerOf(boxes) } });
      if (abortedRef.current) return;
      if (!body.ok || !body.draft) {
        showToast(errorText(status, body) === t.generic ? t.saveFailed : errorText(status, body), "error");
        return;
      }
      const layer = body.draft as ClinicLayer;
      applyBoxes(layer);
      setData((d) => (d ? { ...d, state: { ...d.state, draft: layer, hasPreviousDraft: body.hasPreviousDraft === true || d.state.hasPreviousDraft === true } } : d));
      setDropped(Array.isArray(body.dropped) ? (body.dropped as DroppedLine[]) : []);
      showToast(t.saved, "success");
    } catch {
      if (!abortedRef.current) showToast(t.saveFailed, "error");
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    const message = text.trim();
    if (!message || sending || !scanDone) return;
    if (message.length > OWNER_TEXT_MAX) {
      setChatNote(t.tooLong);
      return;
    }
    setSending(true);
    setChatNote("");
    setPending(message);
    try {
      const { status, body } = await call(`${API}/chat`, { method: "POST", body: { clinicId, text: message } });
      if (abortedRef.current) return;
      if (body.ok) {
        setText("");
        if (body.draft) receiveDraft(body.draft as ClinicLayer);
        setDropped(Array.isArray(body.dropped) ? (body.dropped as DroppedLine[]) : []);
        await refresh();
        return;
      }
      setChatNote(
        body.error === "cap" ? t.cap
        : body.error === "not_ready" ? t.notReady
        : body.error === "too_long" ? t.tooLong
        : body.error === "empty" ? t.emptyMsg
        : body.error === "model" || status === 502 ? t.modelDown
        : errorText(status, body),
      );
    } catch {
      if (!abortedRef.current) setChatNote(t.modelDown);
    } finally {
      // The real row is in the list by now (or the send failed and the text is still in the box).
      setPending(null);
      setSending(false);
    }
  };

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishNote("");
    setTest(null);
    try {
      const { status, body } = await call(`${API}/publish`, { method: "POST", body: { clinicId } });
      // Closed while the test ran: nothing lands on a screen that is gone; a published result
      // still gets its toast, since it changed what patients see.
      if (abortedRef.current) {
        if (body.ok && body.published === true) showToast(t.passed, "success");
        return;
      }
      if (body.ok) {
        const summary = body.test as ReplaySummary;
        const madeLive = body.madeLive !== false;
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        setTest({ published: body.published === true, madeLive, versionId, summary });
        if (body.published === true) showToast(madeLive ? t.passed : t.passedNotLive(versionId), "success");
      } else {
        setPublishNote(errorText(status, body));
      }
    } catch {
      if (!abortedRef.current) setPublishNote(t.generic);
    } finally {
      setPublishing(false);
      if (!abortedRef.current) void refresh();
    }
  };

  /** One step back: the server swaps the draft with the one it replaced. */
  const undo = async () => {
    if (undoing || dirty) return;
    setUndoing(true);
    try {
      const { status, body } = await call(API, { method: "PUT", body: { clinicId, undo: true } });
      if (abortedRef.current) return;
      if (!body.ok || !body.draft) {
        showToast(errorText(status, body), "error");
        return;
      }
      const layer = body.draft as ClinicLayer;
      applyBoxes(layer);
      setData((d) => (d ? { ...d, state: { ...d.state, draft: layer, hasPreviousDraft: body.hasPreviousDraft === true } } : d));
      setDropped([]);
      showToast(t.undone, "success");
    } catch {
      if (!abortedRef.current) showToast(t.generic, "error");
    } finally {
      setUndoing(false);
    }
  };

  const makeLive = async (id: string | null) => {
    if (switching) return;
    setSwitching(true);
    try {
      const { status, body } = await call(`${API}/publish`, { method: "POST", body: { clinicId, makeLive: id } });
      if (abortedRef.current) return;
      if (body.ok) {
        showToast(id === null ? t.layerOff : t.nowLive, "success");
      } else {
        showToast(errorText(status, body), "error");
      }
    } catch {
      if (!abortedRef.current) showToast(t.generic, "error");
    } finally {
      setSwitching(false);
      if (!abortedRef.current) void refresh();
    }
  };

  const fmtDate = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString(isAr ? "ar-EG" : "en-GB") : "");

  const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface-subtle p-4 lg:min-h-0 lg:overflow-y-auto";
  const heading = "text-sm font-black text-ink";
  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30 resize-y";
  const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-black text-ink-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50";
  const secondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong px-3 py-2 text-xs font-bold text-ink-body hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
  const notice = "rounded-xl border border-warn/25 bg-warn-tint px-3 py-2 text-xs font-bold leading-relaxed text-warn";

  return createPortal(
    <div className="fixed inset-0 z-[260] flex flex-col bg-surface" dir={isAr ? "rtl" : "ltr"}>
      <div role="dialog" aria-modal="true" aria-labelledby="pro-setup-title" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id="pro-setup-title" className="text-lg font-black text-ink">{t.title}</h2>
            <p className="mt-0.5 text-xs font-medium leading-relaxed text-ink-muted">{t.sub}</p>
          </div>
          <button type="button" onClick={() => void requestClose()} aria-label={t.close} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:overflow-hidden">
          {!data ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              {loadFailed ? (
                <>
                  <span>{t.loadFailed}</span>
                  <button type="button" className={secondary} onClick={() => void refresh()}>{t.retry}</button>
                </>
              ) : (
                <Loader2 size={16} className="animate-spin" />
              )}
            </div>
          ) : (
            <div className="grid gap-4 lg:h-full lg:grid-cols-3">
              {/* 1. Reading the old chats */}
              <section className={card}>
                <h3 className={heading}>{t.p1}</h3>
                {scan && scan.status === "idle" && <p className="text-xs leading-relaxed text-ink-muted">{t.idle}</p>}
                {(scan?.status === "idle" || scan?.status === "failed") && (
                  <>
                    {scan.status === "failed" && (
                      <p className={notice}>{t.scanFailed}{scan.error ? ` ${scan.error}` : ""}</p>
                    )}
                    <button type="button" className={`${primary} self-start`} disabled={starting} onClick={() => void startScan()}>
                      {starting && <Loader2 size={14} className="animate-spin" />}
                      {scan.status === "failed" ? t.startAgain : t.start}
                    </button>
                  </>
                )}
                {scan && (going || scanDone) && (
                  <div className="space-y-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={scanDone ? 100 : pct}>
                      <div className="h-full rounded-full bg-ink-slab transition-all" style={{ width: `${scanDone ? 100 : pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                      <span className="font-figure tabular-nums" dir="ltr">{scanDone ? scan.total : scan.done} / {scan.total}</span>
                      <span>{t.chatsRead(scan.chatsRead)}</span>
                    </div>
                    {going && !loopActive ? (
                      <>
                        <p className={notice}>{t.stalled}{stepError ? ` ${stepError}` : ""}</p>
                        <button type="button" className={`${primary} self-start`} onClick={() => void runLoop()}>
                          {t.cont}
                        </button>
                      </>
                    ) : (
                      <p className="flex items-center gap-2 text-xs leading-relaxed text-ink-muted">
                        {going && <Loader2 size={12} className="animate-spin" />}
                        {going ? t.reading : t.scanDone}
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* 2. Chat with Pro */}
              <section className={card}>
                <h3 className={heading}>{t.p2}</h3>
                <div className="max-h-80 min-h-40 flex-1 space-y-2 overflow-y-auto rounded-xl border border-line bg-surface p-3 lg:max-h-none">
                  {data.chat.length === 0 && <p className="text-xs text-ink-muted">{scanDone ? "" : t.chatEmpty}</p>}
                  {data.chat.map((m, i) => (
                    <div key={`${m.at}-${i}`} className={`flex ${m.role === "owner" ? "justify-end" : "justify-start"}`}>
                      <p
                        dir="auto"
                        className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          m.role === "owner" ? "bg-ink-slab text-white" : "bg-surface-subtle text-ink"
                        }`}
                      >
                        {m.text}
                      </p>
                    </div>
                  ))}
                  {pending && (
                    <div className="flex justify-end">
                      <p dir="auto" className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-ink-slab px-3 py-2 text-sm leading-relaxed text-white opacity-70">{pending}</p>
                    </div>
                  )}
                  {sending && <p className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={12} className="animate-spin" />{t.proThinking}</p>}
                  <div ref={chatEnd} />
                </div>
                {chatNote && <p className={notice}>{chatNote}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    dir="auto"
                    maxLength={OWNER_TEXT_MAX}
                    className={`${field} resize-none disabled:opacity-60`}
                    placeholder={scanDone ? t.placeholder : t.chatLocked}
                    value={text}
                    disabled={!scanDone || sending}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button type="button" className={primary} disabled={!scanDone || sending || !text.trim()} onClick={() => void send()} aria-label={t.send}>
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} className={isAr ? "-scale-x-100" : ""} />}
                  </button>
                </div>
              </section>

              {/* 3. The clinic layer */}
              <section className={card}>
                <h3 className={heading}>{t.p3}</h3>
                <p className="text-xs leading-relaxed text-ink-muted">{t.tryHint}</p>
                {stale && (
                  <div className={`${notice} flex items-center justify-between gap-2`}>
                    <span>{t.reload}</span>
                    <button type="button" className={secondary} onClick={() => data && applyBoxes(data.state.draft)}>{t.reloadBtn}</button>
                  </div>
                )}
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-ink">{t.rules}</span>
                  <textarea rows={5} dir="auto" className={field} value={boxes.rules} onChange={(e) => edit("rules", e.target.value)} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-ink">{t.handoff}</span>
                  <textarea rows={3} dir="auto" className={field} value={boxes.handoff} onChange={(e) => edit("handoff", e.target.value)} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-ink">{t.never}</span>
                  <textarea rows={3} dir="auto" className={field} value={boxes.never} onChange={(e) => edit("never", e.target.value)} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-ink">{t.section}</span>
                  <textarea rows={4} dir="auto" className={field} value={boxes.prompt} onChange={(e) => edit("prompt", e.target.value)} />
                </label>

                {dropped.length > 0 && (
                  <div className={notice}>
                    <p>{t.dropNote}</p>
                    <ul className="mt-1 space-y-0.5 font-medium">
                      {dropped.map((d, i) => (
                        <li key={i} dir="auto">{d.text} — {reasonOf(d.why)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={secondary} disabled={saving || !dirty} onClick={() => void save()}>
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    {t.save}
                  </button>
                  <button type="button" className={primary} disabled={publishing || dirty} onClick={() => void publish()}>
                    {publishing && <Loader2 size={14} className="animate-spin" />}
                    {publishing ? t.publishing : t.publish}
                  </button>
                  {data.state.hasPreviousDraft && (
                    <button type="button" className={secondary} disabled={undoing || dirty || publishing} title={dirty ? t.undoHint : undefined} onClick={() => void undo()}>
                      {undoing && <Loader2 size={14} className="animate-spin" />}
                      {t.undo}
                    </button>
                  )}
                </div>
                {dirty && <p className="text-xs text-ink-muted">{t.unsaved} {t.publishHint}</p>}
                {publishNote && <p className={notice}>{publishNote}</p>}

                {test && (() => {
                  const s = test.summary;
                  const limit = replayLimit(s.turns);
                  const short = test.published ? [] : replayShortfalls(s);
                  const stats: Array<[string, number]> = [
                    [t.turnsLbl, s.turns],
                    [t.unavailableLbl, s.unavailable],
                    [t.handoffsLbl, s.unexpectedHandoffs ?? 0],
                    [t.offLbl, s.actionMisses],
                  ];
                  return (
                  <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
                    <p className="text-sm font-black text-ink">{test.published ? (test.madeLive ? t.passed : t.passedNotLive(test.versionId)) : t.failedTest}</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                      {stats.map(([label, n]) => (
                        <div key={label} className="min-w-0">
                          <dt className="truncate text-ink-muted">{label}</dt>
                          <dd className="font-figure font-black text-ink">{isAr ? n.toLocaleString("ar-EG") : n}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.timedOut && <p className={notice}>{t.timedOut}</p>}
                    {short.length > 0 && (
                      <div className="space-y-0.5 text-xs">
                        <p className="font-bold text-ink">{t.whyFailed}</p>
                        <ul className="list-inside list-disc space-y-0.5 text-ink-body">
                          {short.map((k) => (
                            <li key={k}>
                              {k === "no_turns" ? t.noTurns
                                : k === "breaks" ? t.breaksWhy(s.breaks.length)
                                : k === "unavailable" ? t.unavailableWhy(s.unavailable, s.turns, limit)
                                : t.handoffsWhy(s.unexpectedHandoffs ?? 0, s.turns, limit)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {s.breaks.length > 0 && (
                      <>
                        <p className="text-xs font-bold text-ink">{t.breaksTitle}</p>
                        <ul className="space-y-2">
                          {s.breaks.map((b, i) => (
                            <li key={`${b.caseId}-${i}`} className="space-y-0.5 rounded-lg bg-surface-subtle px-3 py-2 text-xs">
                              <p dir="auto" className="text-ink-muted">{t.asked}: <span className="text-ink">{b.q}</span></p>
                              <p dir="auto" className="text-ink-muted">{t.replied}: <span className="text-ink">{b.reply}</span></p>
                              <p className="text-ink-muted">{t.rulesLbl}: <span className="font-bold text-ink">{b.rules.map(ruleName).join(isAr ? "، " : ", ")}</span></p>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  );
                })()}

                <div className="space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className={heading}>{t.versions}</h4>
                    {liveVersion && (
                      <button type="button" className={secondary} disabled={switching} onClick={() => void makeLive(null)}>{t.noLayer}</button>
                    )}
                  </div>
                  {data.versions.length === 0 ? (
                    <p className="text-xs text-ink-muted">{t.noVersions}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {data.versions.map((v) => {
                        const isLive = v.id === liveVersion;
                        return (
                          <li key={v.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                            <div className="min-w-0 text-xs">
                              <p className="flex flex-wrap items-center gap-1.5 font-black text-ink">
                                <span className="font-figure" dir="ltr">v{v.version}</span>
                                {isLive && <span className="rounded-full bg-ink-slab px-2 py-0.5 text-[10px] font-black text-white">{t.live}</span>}
                              </p>
                              <p className="truncate text-ink-muted">
                                {v.passed ? t.passedLbl : t.breaksLbl(v.breaks)}
                                {v.createdBy ? ` · ${t.by} ${v.createdBy}` : ""}
                                {v.createdAt > 0 ? ` · ${fmtDate(v.createdAt)}` : ""}
                              </p>
                            </div>
                            {v.passed && !isLive && (
                              <button type="button" className={secondary} disabled={switching} onClick={() => void makeLive(v.id)}>{t.makeLive}</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
