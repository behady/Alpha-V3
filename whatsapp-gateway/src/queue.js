import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The messages an instance has accepted but not yet sent, kept on disk.
 *
 * In memory they were lost on every restart, and a restart at 23:00 would have silently dropped
 * the reminders held for 10:00 the next morning — which is exactly the case the sending window
 * creates. So the queue is a JSON file rewritten on every change (a few hundred entries at most,
 * far below anything that needs a database) and reloaded on start.
 *
 * Items are plain objects: `{ id, jid, kind, text | file, caption, fileName, mimetype,
 * proactive, notBefore, createdAt, attempts }`. Order is creation order; `dueNow` respects it,
 * so a batch of reminders leaves in the order the web app sent it.
 */
export class PersistedQueue {
  constructor(path) {
    this.path = path;
    this.items = [];
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      this.items = Array.isArray(raw) ? raw.filter((i) => i && i.id && i.jid) : [];
    } catch {
      this.items = [];
    }
    return this.items.length;
  }

  #save() {
    const snapshot = JSON.stringify(this.items);
    const run = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      // Write-then-rename: a crash mid-write leaves the previous file, never a torn one.
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.path);
    };
    this.writing = this.writing.then(run, run);
    return this.writing;
  }

  async push(item) {
    this.items.push(item);
    await this.#save();
    return item;
  }

  async remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) await this.#save();
  }

  async update(id, patch) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    await this.#save();
    return item;
  }

  get size() {
    return this.items.length;
  }

  /** The oldest item whose time has come, or null. */
  dueNow(now = Date.now()) {
    return this.items.find((i) => !(Number(i.notBefore) > now)) || null;
  }

  /** When the next held item becomes due, or null if nothing is waiting. */
  nextDueAt() {
    let min = null;
    for (const i of this.items) {
      const t = Number(i.notBefore) || 0;
      if (min === null || t < min) min = t;
    }
    return min;
  }

  countWaiting(now = Date.now()) {
    return this.items.filter((i) => Number(i.notBefore) > now).length;
  }
}
