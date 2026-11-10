"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Printer, Trash2 } from "lucide-react";
import { stockApi } from "@/lib/stock/api";
import type { StockDrawer } from "@/lib/stock/types";
import { printDrawerLabels } from "./labels";
import { SetupView } from "./SetupView";
import { Btn, Card, Eyebrow, Field, Ltr, Reveal, inputCls, linesOfDrawer, shortCode, useBusy, type StockCtx } from "./shared";

/**
 * The clinic describes its own furniture, and nothing is assumed.
 *
 * A room; a cabinet in it with so many drawers and so many shelves; a name on each; then open
 * one and put its items in. That is the whole page. The ready-made dental layout the module
 * first shipped with told a clinic how its cupboards "should" be arranged, and the owner's
 * reaction was that it forced him into a setup that was not his — so it survives only as an
 * optional shortcut for a clinic that has nothing yet.
 */
export function LayoutView({ ctx }: { ctx: StockCtx }) {
  const { snap, t, ar, toast, canStructure } = ctx;
  const { busy, run } = useBusy();
  const [addingRoom, setAddingRoom] = useState(snap.drawers.length === 0);
  const [readyMade, setReadyMade] = useState(false);

  const rooms = useMemo(() => {
    const map = new Map<string, { code: string; name: string; cabinets: Map<string, StockDrawer[]> }>();
    for (const d of snap.drawers) {
      const r = map.get(d.roomCode) || { code: d.roomCode, name: ar ? d.roomAr : d.roomEn, cabinets: new Map() };
      r.cabinets.set(d.cabinetLetter, [...(r.cabinets.get(d.cabinetLetter) || []), d]);
      map.set(d.roomCode, r);
    }
    return [...map.values()];
  }, [snap.drawers, ar]);

  if (!canStructure) {
    return <Card className="p-6 text-sm text-ink-body">{t("Only an admin can change the rooms and drawers.", "الأدمن بس اللي يقدر يغيّر الغرف والأدراج.")}</Card>;
  }
  if (readyMade) {
    return (
      <div className="grid gap-3">
        <button type="button" onClick={() => setReadyMade(false)} className="justify-self-start text-[13px] font-bold text-ink underline">
          {t("← Back to my own layout", "→ ارجع لتقسيمتي")}
        </button>
        <SetupView ctx={ctx} />
      </div>
    );
  }

  const usedCodes = new Set(rooms.map((r) => r.code));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>{t("Rooms and drawers", "الغرف والأدراج")}</Eyebrow>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{t("Lay it out the way it really is.", "قسّمه زي ما هو عندك بالظبط.")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-body">
            {t(
              "Add a room. Add a cabinet in it and say how many drawers and shelves it has. Name each one. Then open it and add what lives there.",
              "ضيف غرفة. ضيف فيها دولاب وقول فيه كام درج وكام رف. سمّي كل واحد. وبعدين افتحه وضيف اللي جواه."
            )}
          </p>
        </div>
        {snap.drawers.length ? (
          <Btn busy={busy} onClick={() => run(() => printDrawerLabels(snap, snap.drawers, window.location.origin), (m) => toast(m, "error"))}>
            <Printer size={15} /> {t("Print all labels", "اطبع كل الملصقات")}
          </Btn>
        ) : null}
      </div>

      {rooms.map((r) => (
        <RoomCard key={r.code} ctx={ctx} room={r} />
      ))}

      {addingRoom ? (
        <Reveal><AddRoomForm ctx={ctx} usedCodes={usedCodes} roomCount={rooms.length} onDone={() => setAddingRoom(false)} canCancel={rooms.length > 0} /></Reveal>
      ) : (
        <Btn kind="dark" onClick={() => setAddingRoom(true)} className="justify-self-start">
          <Plus size={15} /> {t("Add a room", "ضيف غرفة")}
        </Btn>
      )}

      {snap.drawers.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          {t("In a hurry? ", "مستعجل؟ ")}
          <button type="button" onClick={() => setReadyMade(true)} className="font-bold text-ink underline">
            {t("Start from a ready-made dental layout instead", "ابدأ بتقسيمة أسنان جاهزة")}
          </button>
          {t(" and change it afterwards.", " وغيّرها بعدين.")}
        </p>
      ) : null}
    </div>
  );
}

function RoomCard({ ctx, room }: { ctx: StockCtx; room: { code: string; name: string; cabinets: Map<string, StockDrawer[]> } }) {
  const { t, toast } = ctx;
  const { run } = useBusy();
  const [addingCabinet, setAddingCabinet] = useState(false);
  const total = [...room.cabinets.values()].reduce((a, c) => a + c.length, 0);
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-ink-slab px-2 py-1 font-display text-[12px] font-black text-white"><Ltr>{room.code}</Ltr></span>
        <input
          key={`${room.code}:${room.name}`}
          defaultValue={room.name}
          aria-label={t("Room name", "اسم الغرفة")}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (!name || name === room.name) return;
            void run(async () => { ctx.setSnap(await stockApi.renameRoom(room.code, name)); toast(t("Room renamed.", "اتغير اسم الغرفة.")); }, (m) => toast(m, "error"));
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-lg font-bold text-ink outline-none hover:border-line focus:border-ink-muted focus:bg-surface"
        />
        <span className="text-[12px] text-ink-muted">{room.cabinets.size} {t("cabinets", "دولاب")} · {total} {t("places", "مكان")}</span>
      </div>

      {[...room.cabinets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([letter, drawers]) => (
        <CabinetBlock key={letter} ctx={ctx} roomCode={room.code} letter={letter} drawers={drawers} />
      ))}

      {addingCabinet ? (
        <Reveal><AddCabinetForm ctx={ctx} roomCode={room.code} roomName={room.name} onDone={() => setAddingCabinet(false)} /></Reveal>
      ) : (
        <Btn onClick={() => setAddingCabinet(true)} className="justify-self-start">
          <Plus size={14} /> {t("Add a cabinet to this room", "ضيف دولاب في الغرفة دي")}
        </Btn>
      )}
    </Card>
  );
}

function CabinetBlock({ ctx, roomCode, letter, drawers }: { ctx: StockCtx; roomCode: string; letter: string; drawers: StockDrawer[] }) {
  const { t, ar, toast, snap } = ctx;
  const { busy, run } = useBusy();
  const sorted = [...drawers].sort((a, b) => a.order - b.order);
  // Delete is two taps on the same button: a bin beside a text field is too easy to hit by mistake.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const nDrawers = drawers.filter((d) => d.kind === "drawer").length;
  const nShelves = drawers.length - nDrawers;
  const Open = ar ? ChevronLeft : ChevronRight;

  const addOne = (kind: "drawer" | "shelf") =>
    run(async () => {
      ctx.setSnap(await stockApi.addCabinet({ roomCode, cabinetLetter: letter, drawers: kind === "drawer" ? 1 : 0, shelves: kind === "shelf" ? 1 : 0 }));
    }, (m) => toast(m, "error"));

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-subtle px-3 py-2">
        <b className="font-display text-[13px] font-bold text-ink">{t("Cabinet", "دولاب")} <Ltr>{letter}</Ltr></b>
        <span className="text-[12px] text-ink-muted">
          {nDrawers} {t("drawers", "درج")}{nShelves ? ` · ${nShelves} ${t("shelves", "رف")}` : ""}
        </span>
      </div>
      {sorted.map((d) => {
        const lines = linesOfDrawer(snap, d.id);
        const holding = lines.filter((l) => l.qty > 0).length;
        return (
          <div key={d.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-line px-3 py-1.5">
            <span className={`w-12 rounded-md px-1.5 py-1 text-center font-display text-[12px] font-black ${d.kind === "shelf" ? "border border-line text-ink" : "bg-[#FACC15] text-[#1A1206]"}`}>
              <Ltr>{shortCode(d)}</Ltr>
            </span>
            <input
              key={`${d.id}:${ar ? d.nameAr : d.nameEn}`}
              defaultValue={ar ? d.nameAr : d.nameEn}
              aria-label={`${t("Name of", "اسم")} ${d.code}`}
              placeholder={d.kind === "shelf" ? t("Shelf name", "اسم الرف") : t("Drawer name", "اسم الدرج")}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (!name || name === (ar ? d.nameAr : d.nameEn)) return;
                void run(async () => { ctx.setSnap(await stockApi.renameDrawer(d.id, { name })); }, (m) => toast(m, "error"));
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-[14px] text-ink outline-none focus:border-ink-muted"
            />
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => ctx.go({ tab: "cupboard", drawer: d.code })} aria-label={`${t("Open", "افتح")} ${d.code}`} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-2 font-display text-[12px] font-bold text-ink hover:bg-surface-subtle">
                {lines.length ? <><Ltr>{lines.length}</Ltr> <span className="hidden sm:inline">{t("items", "صنف")}</span></> : <><Plus size={13} /> <span className="hidden sm:inline">{t("Add items", "ضيف أصناف")}</span></>} <Open size={13} />
              </button>
              {confirmDelete === d.id ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => { ctx.setSnap(await stockApi.deleteDrawer(d.id)); toast(t("Deleted.", "اتمسح.")); }, (m) => { toast(m, "error"); setConfirmDelete(null); })}
                  onBlur={() => setConfirmDelete(null)}
                  className="h-9 rounded-lg bg-red-700 px-2.5 font-display text-[12px] font-bold text-white disabled:opacity-40"
                  aria-label={`${t("Confirm delete", "أكّد المسح")} ${d.code}`}
                >
                  {t("Delete?", "امسح؟")}
                </button>
              ) : (
                <button
                  type="button"
                  title={holding ? t("Still holds stock", "لسه فيه مخزون") : t("Delete", "مسح")}
                  onClick={() => setConfirmDelete(d.id)}
                  className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-red-50 hover:text-red-700"
                  aria-label={`${t("Delete", "مسح")} ${d.code}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </span>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 border-t border-line bg-surface-subtle px-3 py-2">
        <Btn busy={busy} onClick={() => addOne("drawer")} className="!px-3 !py-1.5 !text-[12px]"><Plus size={13} /> {t("Drawer", "درج")}</Btn>
        <Btn busy={busy} onClick={() => addOne("shelf")} className="!px-3 !py-1.5 !text-[12px]"><Plus size={13} /> {t("Shelf", "رف")}</Btn>
      </div>
    </div>
  );
}

function CountField({ id, label, value, onChange, max }: { id: string; label: string; value: number; onChange: (n: number) => void; max: number }) {
  return (
    <Field label={label}>
      <input id={id} type="number" inputMode="numeric" min={0} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0))))} onFocus={(e) => e.currentTarget.select()} className={inputCls} dir="ltr" />
    </Field>
  );
}

function AddCabinetForm({ ctx, roomCode, roomName, onDone }: { ctx: StockCtx; roomCode: string; roomName: string; onDone: () => void }) {
  const { t, toast } = ctx;
  const { busy, run } = useBusy();
  const [drawers, setDrawers] = useState(4);
  const [shelves, setShelves] = useState(0);
  const [where, setWhere] = useState("");
  return (
    <div className="grid gap-3 rounded-xl border border-[#FACC15] p-3">
      <Eyebrow>{t("New cabinet in", "دولاب جديد في")} {roomName}</Eyebrow>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <CountField id={`stock-cab-drawers-${roomCode}`} label={t("How many drawers", "كام درج")} value={drawers} onChange={setDrawers} max={60} />
        <CountField id={`stock-cab-shelves-${roomCode}`} label={t("How many shelves", "كام رف")} value={shelves} onChange={setShelves} max={20} />
        <div className="col-span-2 sm:col-span-1">
          <Field label={t("Where is it (optional)", "مكانه فين (اختياري)")}><input id={`stock-cab-where-${roomCode}`} value={where} onChange={(e) => setWhere(e.target.value)} className={inputCls} placeholder={t("e.g. left of the chair", "مثلاً يسار الكرسي")} /></Field>
        </div>
      </div>
      <div className="flex gap-2">
        <Btn kind="yellow" busy={busy} disabled={drawers + shelves < 1} onClick={() => run(async () => { ctx.setSnap(await stockApi.addCabinet({ roomCode, roomName, where, drawers, shelves })); toast(t("Cabinet added. Now name its drawers.", "اتضاف الدولاب. سمّي أدراجه دلوقتي.")); onDone(); }, (m) => toast(m, "error"))}>
          {t("Add cabinet", "ضيف الدولاب")}
        </Btn>
        <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </div>
  );
}

function AddRoomForm({ ctx, usedCodes, roomCount, onDone, canCancel }: { ctx: StockCtx; usedCodes: Set<string>; roomCount: number; onDone: () => void; canCancel: boolean }) {
  const { t, toast } = ctx;
  const { busy, run } = useBusy();
  const nextNumbered = () => {
    for (let n = 1; n < 99; n++) if (!usedCodes.has(`R${n}`) && !usedCodes.has(`C${n}`)) return `R${n}`;
    return "R99";
  };
  const [name, setName] = useState("");
  const [code, setCode] = useState(nextNumbered);
  const [drawers, setDrawers] = useState(4);
  const [shelves, setShelves] = useState(0);
  const quick: Array<{ label: string; name: string; code: string }> = [
    { label: t("Treatment room", "غرفة كشف"), name: t(`Room ${roomCount + 1}`, `غرفة ${roomCount + 1}`), code: nextNumbered() },
    { label: t("Sterilisation", "التعقيم"), name: t("Sterilisation", "التعقيم"), code: "ST" },
    { label: t("Store", "المخزن"), name: t("Store", "المخزن"), code: "SR" },
  ];
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const clash = usedCodes.has(cleanCode);
  return (
    <Card className="grid gap-3 border-[#FACC15] p-4">
      <Eyebrow>{t("New room", "غرفة جديدة")}</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {quick.filter((q) => !usedCodes.has(q.code)).map((q) => (
          <button key={q.code} type="button" onClick={() => { setName(q.name); setCode(q.code); }} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink-body hover:border-ink-muted">
            {q.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label={t("Room name", "اسم الغرفة")}><input id="stock-room-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={t("e.g. Room 1", "مثلاً غرفة 1")} /></Field>
        <Field label={t("Short code (printed on labels)", "كود قصير (بيتطبع على الملصق)")}><input id="stock-room-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} dir="ltr" maxLength={4} /></Field>
      </div>
      {clash ? <p className="text-[12.5px] text-red-700">{t("That code is already used by another room.", "الكود ده مستخدم لغرفة تانية.")}</p> : null}
      <Eyebrow>{t("Its first cabinet", "أول دولاب فيها")}</Eyebrow>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <CountField id="stock-room-drawers" label={t("How many drawers", "كام درج")} value={drawers} onChange={setDrawers} max={60} />
        <CountField id="stock-room-shelves" label={t("How many shelves", "كام رف")} value={shelves} onChange={setShelves} max={20} />
      </div>
      <div className="flex gap-2">
        <Btn
          kind="yellow"
          busy={busy}
          disabled={!name.trim() || !cleanCode || clash || drawers + shelves < 1}
          onClick={() => run(async () => { ctx.setSnap(await stockApi.addCabinet({ roomCode: cleanCode, roomName: name.trim(), drawers, shelves })); toast(t("Room added. Now name its drawers.", "اتضافت الغرفة. سمّي أدراجها دلوقتي.")); onDone(); }, (m) => toast(m, "error"))}
        >
          {t("Add room", "ضيف الغرفة")}
        </Btn>
        {canCancel ? <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn> : null}
      </div>
    </Card>
  );
}
