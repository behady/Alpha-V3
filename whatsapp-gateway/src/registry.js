import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Instance } from "./instance.js";

/**
 * Every instance this gateway hosts, and the file that remembers them across restarts.
 *
 * `data/instances/<id>/meta.json` holds the instance's own API token, webhook and label — the
 * login itself lives next to it under `auth/`, encrypted (authState.js). On boot each one is
 * started again, which is what makes a code update invisible to clinics: the session files
 * outlive the process, so the number comes back without a scan.
 */
export class Registry {
  constructor({ dataDir, logger }) {
    this.dataDir = dataDir;
    this.log = logger;
    this.instances = new Map();
  }

  static isValidId(id) {
    return /^[A-Za-z0-9_-]{3,64}$/.test(String(id || ""));
  }

  #metaPath(id) {
    return join(this.dataDir, "instances", id, "meta.json");
  }

  async loadAll() {
    const root = join(this.dataDir, "instances");
    await mkdir(root, { recursive: true });
    const ids = await readdir(root).catch(() => []);
    for (const id of ids) {
      try {
        const meta = JSON.parse(await readFile(this.#metaPath(id), "utf8"));
        if (!meta?.id || !meta?.token) continue;
        await this.#boot(meta);
      } catch (e) {
        this.log.warn({ instance: id, err: e?.message }, "could not load instance");
      }
    }
    this.log.info({ count: this.instances.size }, "instances loaded");
  }

  async #boot(meta) {
    const inst = new Instance(meta, { logger: this.log, dataDir: this.dataDir });
    this.instances.set(meta.id, inst);
    // Not awaited past the socket build: a phone that never scans must not hold up the others.
    await inst.start();
    return inst;
  }

  get(id) {
    return this.instances.get(String(id || "")) || null;
  }

  list() {
    return [...this.instances.values()].map((i) => i.status());
  }

  /**
   * Make (or update) an instance. Idempotent on id: calling it again for an existing one
   * refreshes the webhook and label and returns the SAME token, so the web app can re-run its
   * connect step safely without invalidating what it already stored.
   */
  async create({ instanceId, webhookUrl, label }) {
    const id = String(instanceId || "").trim();
    if (!Registry.isValidId(id)) throw Object.assign(new Error("instanceId must be 3-64 letters, digits, _ or -"), { statusCode: 400 });

    const existing = this.instances.get(id);
    if (existing) {
      existing.meta.webhookUrl = String(webhookUrl || existing.meta.webhookUrl || "");
      if (typeof label === "string") existing.meta.label = label;
      existing.meta.updatedAt = new Date().toISOString();
      await this.#save(existing.meta);
      return { instance: existing, token: existing.meta.token, created: false };
    }

    const meta = {
      id,
      token: randomBytes(24).toString("hex"),
      webhookUrl: String(webhookUrl || ""),
      label: typeof label === "string" ? label : "",
      createdAt: new Date().toISOString(),
    };
    await mkdir(join(this.dataDir, "instances", id), { recursive: true });
    await this.#save(meta);
    const instance = await this.#boot(meta);
    return { instance, token: meta.token, created: true };
  }

  async update(id, { webhookUrl, label }) {
    const inst = this.get(id);
    if (!inst) return null;
    if (typeof webhookUrl === "string") inst.meta.webhookUrl = webhookUrl;
    if (typeof label === "string") inst.meta.label = label;
    inst.meta.updatedAt = new Date().toISOString();
    await this.#save(inst.meta);
    return inst;
  }

  async remove(id) {
    const inst = this.get(id);
    if (!inst) return false;
    this.instances.delete(inst.id);
    await inst.destroy();
    return true;
  }

  async #save(meta) {
    await writeFile(this.#metaPath(meta.id), JSON.stringify(meta, null, 2));
  }

  async stopAll() {
    await Promise.all([...this.instances.values()].map((i) => i.stop().catch(() => {})));
  }

  async sweepMedia(ttlMs) {
    for (const inst of this.instances.values()) await inst.sweepMedia(ttlMs).catch(() => {});
  }
}
