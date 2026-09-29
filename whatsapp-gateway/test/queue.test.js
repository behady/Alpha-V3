import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistedQueue } from "../src/queue.js";

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "wa-queue-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a held message survives a restart", () =>
  withDir(async (dir) => {
    const path = join(dir, "q.json");
    const q = new PersistedQueue(path);
    await q.load();
    const tomorrow = Date.now() + 12 * 3600_000;
    await q.push({ id: "A", jid: "2010@s.whatsapp.net", kind: "text", text: "reminder", notBefore: tomorrow });
    await q.push({ id: "B", jid: "2011@s.whatsapp.net", kind: "text", text: "now", notBefore: Date.now() - 1 });

    const again = new PersistedQueue(path);
    assert.equal(await again.load(), 2);
    assert.equal(again.dueNow()?.id, "B");
    assert.equal(again.countWaiting(), 1);
    assert.ok(again.nextDueAt() <= Date.now());
  }));

test("due order is creation order, and removal persists", () =>
  withDir(async (dir) => {
    const q = new PersistedQueue(join(dir, "q.json"));
    await q.load();
    await q.push({ id: "1", jid: "a@s.whatsapp.net", kind: "text", text: "first", notBefore: 0 });
    await q.push({ id: "2", jid: "b@s.whatsapp.net", kind: "text", text: "second", notBefore: 0 });
    assert.equal(q.dueNow().id, "1");
    await q.remove("1");
    assert.equal(q.dueNow().id, "2");
    await q.update("2", { notBefore: Date.now() + 60_000 });
    assert.equal(q.dueNow(), null);

    const again = new PersistedQueue(join(dir, "q.json"));
    await again.load();
    assert.equal(again.size, 1);
    assert.equal(again.items[0].id, "2");
  }));

test("a corrupt or missing file is an empty queue, not a crash", () =>
  withDir(async (dir) => {
    const q = new PersistedQueue(join(dir, "missing.json"));
    assert.equal(await q.load(), 0);
  }));
