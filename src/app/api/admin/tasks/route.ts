import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { cleanTaskInput, datesInOrder, STARTER_TASKS, taskFromDoc, type TaskInput } from "@/lib/platformTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The superadmin console's task list. `platform_tasks` is a top-level collection the rules never
 * open, so this route is the only door, and only superadmins get through it. No clinic data is
 * read or written here.
 *
 *   GET                                        → every task
 *   POST { action: "create", task }            → the new task
 *   POST { action: "update", id, task }        → the task as saved
 *   POST { action: "delete", id }
 *   POST { action: "seed" }                    → adds the starter list, only when the list is empty
 */
const COLLECTION = "platform_tasks";
const MAX_TASKS = 500;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function newRow(input: TaskInput, now: string) {
  const status = input.status ?? "todo";
  return {
    title: input.title ?? "",
    notes: input.notes ?? "",
    clinic: input.clinic ?? "",
    status,
    priority: input.priority ?? "normal",
    startDate: input.startDate ?? "",
    deadline: input.deadline ?? "",
    createdAt: now,
    updatedAt: now,
    liveAt: status === "live" ? now : "",
  };
}

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const snap = await adminDb().collection(COLLECTION).limit(MAX_TASKS).get();
    return NextResponse.json({ ok: true, items: snap.docs.map((d) => taskFromDoc(d.id, d.data())) });
  } catch (error) {
    reportServerError("admin tasks list error:", error);
    return fail("Could not read the tasks", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Bad request");
  const col = adminDb().collection(COLLECTION);
  const now = new Date().toISOString();

  try {
    switch (body.action) {
      case "create": {
        const clean = cleanTaskInput(body.task, false);
        if (!clean.ok) return fail(clean.error);
        const row = newRow(clean.value, now);
        if (!datesInOrder(row.startDate, row.deadline)) return fail("The deadline is before the start date");
        const count = (await col.count().get()).data().count;
        if (count >= MAX_TASKS) return fail("The list is full. Delete some finished tasks first.");
        const ref = await col.add({ ...row, createdBy: auth.uid });
        return NextResponse.json({ ok: true, item: taskFromDoc(ref.id, row) });
      }

      case "update": {
        if (typeof body.id !== "string" || !body.id) return fail("Which task?");
        const clean = cleanTaskInput(body.task, true);
        if (!clean.ok) return fail(clean.error);
        const ref = col.doc(body.id);
        const saved = await adminDb().runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const before = taskFromDoc(snap.id, snap.data() || {});
          const after = { ...before, ...clean.value };
          if (!datesInOrder(after.startDate, after.deadline)) return "dates" as const;
          const patch: Record<string, unknown> = { ...clean.value, updatedAt: now };
          // Keep the first day it went live; forget it if it is moved back.
          if (after.status === "live" && before.status !== "live") patch.liveAt = now;
          if (after.status !== "live" && before.status === "live") patch.liveAt = "";
          tx.update(ref, patch);
          return taskFromDoc(snap.id, { ...snap.data(), ...patch });
        });
        if (saved === null) return fail("That task is gone", 404);
        if (saved === "dates") return fail("The deadline is before the start date");
        return NextResponse.json({ ok: true, item: saved });
      }

      case "delete": {
        if (typeof body.id !== "string" || !body.id) return fail("Which task?");
        await col.doc(body.id).delete();
        return NextResponse.json({ ok: true });
      }

      case "seed": {
        const added = await adminDb().runTransaction(async (tx) => {
          const existing = await tx.get(col.limit(1));
          if (!existing.empty) return 0;
          STARTER_TASKS.forEach((t, i) => {
            // A second apart, so "oldest first" keeps the starter list in the order it was given.
            const at = new Date(Date.parse(now) + i * 1000).toISOString();
            tx.set(col.doc(), { ...newRow(t, at), createdBy: auth.uid });
          });
          return STARTER_TASKS.length;
        });
        return NextResponse.json({ ok: true, added });
      }

      default:
        return fail("Unknown action");
    }
  } catch (error) {
    reportServerError("admin tasks write error:", error);
    return fail("Could not save", 500);
  }
}
