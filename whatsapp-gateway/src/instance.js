import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { useEncryptedFileAuthState } from "./authState.js";
import { config } from "./config.js";
import {
  buildAckEvent,
  buildMessageEvent,
  digitsOf,
  isSilentMessage,
  messageMedia,
  messageText,
  randomGap,
  toWaJid,
} from "./shape.js";

/**
 * One clinic's WhatsApp, kept alive.
 *
 * An instance is a WhatsApp Web session (the same thing the phone shows under Linked devices)
 * plus the two things around it that make it a service: a send queue that paces outgoing
 * messages like a person, and a webhook that hands every incoming message to the web app.
 *
 * States, in the order a clinic sees them:
 *   starting   — socket being built
 *   qr         — waiting for the phone to scan (`qr` holds the current code; it rotates)
 *   connecting — scanned, handshake in progress
 *   open       — live
 *   closed     — dropped; reconnecting on its own
 *   logged_out — the phone removed us (or the clinic asked); needs a new scan
 */
export class Instance {
  constructor(meta, { logger, dataDir }) {
    this.id = meta.id;
    this.meta = meta;
    this.log = logger.child({ instance: meta.id });
    this.dir = join(dataDir, "instances", meta.id);
    this.mediaDir = join(dataDir, "media", meta.id);

    this.state = "starting";
    this.qr = null;
    this.qrAt = null;
    this.phone = null;
    this.lastError = null;
    this.connectedAt = null;

    this.sock = null;
    this.auth = null;
    this.stopping = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;

    // Send pacing (see config.js).
    this.queue = Promise.resolve();
    this.lastSendAt = 0;
    this.sendTimes = [];
  }

  /* ───────────────────────── lifecycle ───────────────────────── */

  async start() {
    this.stopping = false;
    await mkdir(this.mediaDir, { recursive: true });
    await this.#connect();
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try {
        sock.ev.removeAllListeners("connection.update");
        sock.end(undefined);
      } catch {
        /* already closed */
      }
    }
  }

  /** Forget the login and come back up waiting for a fresh scan. */
  async logout() {
    const sock = this.sock;
    try {
      if (sock && this.state === "open") await sock.logout();
    } catch (e) {
      this.log.warn({ err: e?.message }, "logout call failed; clearing the session anyway");
    }
    await this.stop();
    if (this.auth) await this.auth.clear().catch(() => {});
    this.phone = null;
    this.state = "logged_out";
    await this.start();
  }

  async destroy() {
    await this.stop();
    await rm(this.dir, { recursive: true, force: true });
    await rm(this.mediaDir, { recursive: true, force: true });
  }

  async #connect() {
    if (this.stopping) return;
    this.state = this.phone ? "connecting" : "starting";
    this.qr = null;

    try {
      this.auth = await useEncryptedFileAuthState(join(this.dir, "auth"), config.sessionKey);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

      const sock = makeWASocket({
        version,
        auth: this.auth.state,
        logger: this.log.child({ lib: "baileys" }, { level: "warn" }),
        browser: Browsers.ubuntu("Alpha Dental"),
        // The clinic's phone still shows the chats; we are a linked device, not the desk.
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        // Retried decrypts ask for the original; we keep no store, so there is nothing to give.
        getMessage: async () => undefined,
      });
      this.sock = sock;

      sock.ev.on("creds.update", () => this.auth.saveCreds().catch((e) => this.log.error({ err: e?.message }, "saveCreds failed")));
      sock.ev.on("connection.update", (u) => this.#onConnection(u));
      sock.ev.on("messages.upsert", (u) => this.#onUpsert(u).catch((e) => this.log.error({ err: e?.message }, "upsert handler failed")));
      sock.ev.on("messages.update", (updates) => this.#onUpdates(updates).catch(() => {}));
    } catch (e) {
      this.lastError = e?.message || String(e);
      this.log.error({ err: this.lastError }, "socket build failed");
      this.#scheduleReconnect();
    }
  }

  #onConnection({ connection, lastDisconnect, qr }) {
    if (qr) {
      this.state = "qr";
      this.qr = qr;
      this.qrAt = Date.now();
      this.log.info("waiting for QR scan");
      return;
    }
    if (connection === "connecting") {
      this.state = "connecting";
      return;
    }
    if (connection === "open") {
      this.state = "open";
      this.qr = null;
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.connectedAt = Date.now();
      const me = this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : "";
      this.phone = digitsOf(me) || this.phone;
      this.log.info({ phone: this.phone }, "connected");
      return;
    }
    if (connection === "close") {
      // Baileys wraps the close reason in a Boom error; the status code is what tells them apart.
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "closed";
      this.lastError = reason;
      this.sock = null;

      if (code === DisconnectReason.loggedOut) {
        // The phone removed this device (Linked devices → Log out), or the account was banned.
        // The old keys are useless now; wipe them so the next start shows a fresh QR.
        this.log.warn("logged out by the phone; clearing session");
        this.state = "logged_out";
        this.phone = null;
        this.auth?.clear().catch(() => {});
        this.#scheduleReconnect(2000);
        return;
      }
      if (this.stopping) {
        this.state = "closed";
        return;
      }
      this.state = "closed";
      // 515 = "restart required" after pairing: expected, immediate. Anything else backs off.
      this.log.warn({ code, reason }, "connection closed");
      this.#scheduleReconnect(code === DisconnectReason.restartRequired ? 500 : undefined);
    }
  }

  #scheduleReconnect(delayMs) {
    if (this.stopping) return;
    clearTimeout(this.reconnectTimer);
    const backoff = Math.min(60_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 6));
    const delay = delayMs ?? backoff;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.#connect(), delay);
  }

  /* ───────────────────────── inbound ───────────────────────── */

  async #onUpsert({ messages, type }) {
    // "notify" is a message that just happened. "append" is history being filled in — old chats
    // replayed on connect, which must not be answered as if the patient wrote them now.
    if (type !== "notify") return;
    for (const msg of messages || []) {
      try {
        await this.#handleMessage(msg);
      } catch (e) {
        this.log.error({ err: e?.message, id: msg?.key?.id }, "message handling failed");
      }
    }
  }

  async #handleMessage(msg) {
    const key = msg.key || {};
    const jid = String(key.remoteJid || "");
    if (!jid || jid === "status@broadcast" || /@(g\.us|broadcast|newsletter)$/i.test(jid)) return;
    if (!msg.message || isSilentMessage(msg.message)) return;

    const text = messageText(msg.message);
    const media = messageMedia(msg.message);
    if (!text && !media) return;

    // Where WhatsApp tells us the phone behind a lid, pass it on; the web app can then match a
    // patient directly. `remoteJidAlt` is the field on the rc line; `senderPn` was its old name.
    let phoneJid = key.remoteJidAlt || key.senderPn || null;
    if (!phoneJid && /@lid$/i.test(jid)) phoneJid = await this.resolveLid(jid);

    let mediaUrl = null;
    if (media && !key.fromMe && (media.type === "ptt" || media.type === "audio" || media.type === "image")) {
      mediaUrl = await this.#stashMedia(msg, media).catch((e) => {
        this.log.warn({ err: e?.message, id: key.id }, "media download failed");
        return null;
      });
    }

    const event = buildMessageEvent({
      instanceId: this.id,
      key,
      timestamp: msg.messageTimestamp,
      text,
      media,
      mediaUrl,
      pushName: msg.pushName,
      phoneJid,
    });
    await this.#postWebhook(event);
  }

  async #onUpdates(updates) {
    for (const { key, update } of updates || []) {
      if (!key?.fromMe || update?.status == null) continue;
      const event = buildAckEvent({ instanceId: this.id, key, status: update.status });
      if (event) await this.#postWebhook(event);
    }
  }

  async #stashMedia(msg, media) {
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: this.log, reupload: this.sock?.updateMediaMessage });
    if (!buffer?.length) throw new Error("empty media");
    if (buffer.length > config.maxMediaBytes) throw new Error("media too large");
    const id = String(msg.key.id).replace(/[^A-Za-z0-9_-]/g, "");
    await writeFile(join(this.mediaDir, id), buffer);
    await writeFile(join(this.mediaDir, `${id}.json`), JSON.stringify({ mimetype: media.mimetype, at: Date.now() }));
    if (!config.publicUrl) return null;
    return `${config.publicUrl}/api/v2/${encodeURIComponent(this.id)}/media/${id}`;
  }

  /** The stored bytes for a media id, or null once they have been swept. */
  async readMedia(id) {
    const safe = String(id).replace(/[^A-Za-z0-9_-]/g, "");
    if (!safe) return null;
    try {
      const meta = JSON.parse(await readFile(join(this.mediaDir, `${safe}.json`), "utf8"));
      const bytes = await readFile(join(this.mediaDir, safe));
      return { bytes, mimetype: meta.mimetype || "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async sweepMedia(ttlMs) {
    const files = await readdir(this.mediaDir).catch(() => []);
    const cutoff = Date.now() - ttlMs;
    for (const f of files) {
      const p = join(this.mediaDir, f);
      const s = await stat(p).catch(() => null);
      if (s && s.mtimeMs < cutoff) await rm(p, { force: true }).catch(() => {});
    }
  }

  /**
   * Deliver one event to the clinic's webhook.
   *
   * Three attempts with growing gaps, then give up and log: the web app answers 200 even for
   * payloads it cannot parse, so a non-2xx is Vercel being unreachable, not a bad message, and
   * a stop request is worth a second try. Never throws — a webhook failure must not take the
   * socket down with it.
   */
  async #postWebhook(event) {
    const url = this.meta.webhookUrl;
    if (!url) return;
    const body = JSON.stringify(event);
    const delays = [0, 2000, 8000];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Instance": this.id },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return;
        this.log.warn({ status: res.status, attempt: i + 1 }, "webhook rejected");
      } catch (e) {
        this.log.warn({ err: e?.message, attempt: i + 1 }, "webhook unreachable");
      }
    }
  }

  /* ───────────────────────── outbound ───────────────────────── */

  #assertOpen() {
    if (this.state !== "open" || !this.sock) {
      const err = new Error(`WhatsApp is not connected (${this.state})`);
      err.statusCode = 503;
      throw err;
    }
  }

  /**
   * Run one send after the pacing rules have had their say.
   *
   * Every send on this instance goes through here, in order. The gap is measured from the
   * previous send's completion, and the per-minute cap holds the queue rather than dropping
   * anything — a reminder batch of forty goes out over two minutes instead of two seconds.
   */
  #paced(fn) {
    const run = async () => {
      const now = Date.now();
      this.sendTimes = this.sendTimes.filter((t) => now - t < 60_000);
      let wait = 0;
      if (this.sendTimes.length >= config.perMinuteCap) wait = Math.max(wait, this.sendTimes[0] + 60_000 - now);
      const gap = randomGap(config.minGapMs, config.maxGapMs);
      if (this.lastSendAt) wait = Math.max(wait, this.lastSendAt + gap - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.#assertOpen();
      try {
        return await fn();
      } finally {
        this.lastSendAt = Date.now();
        this.sendTimes.push(this.lastSendAt);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async sendText(chatId, text) {
    this.#assertOpen();
    const jid = toWaJid(chatId);
    if (!jid) throw Object.assign(new Error("Invalid chat_id"), { statusCode: 400 });
    const body = String(text ?? "");
    if (!body.trim()) throw Object.assign(new Error("text is required"), { statusCode: 400 });

    return this.#paced(async () => {
      // A person types before they send. Short and bounded: decoration, never a delay worth noticing.
      try {
        await this.sock.sendPresenceUpdate("composing", jid);
        await new Promise((r) => setTimeout(r, Math.min(1500, 300 + body.length * 15)));
      } catch {
        /* cosmetic */
      }
      const sent = await this.sock.sendMessage(jid, { text: body });
      try {
        await this.sock.sendPresenceUpdate("paused", jid);
      } catch {
        /* cosmetic */
      }
      return { id: sent?.key?.id || "", chatId: toWaJid(chatId) };
    });
  }

  async sendDocument(chatId, { buffer, mimetype, fileName, caption }) {
    this.#assertOpen();
    const jid = toWaJid(chatId);
    if (!jid) throw Object.assign(new Error("Invalid chat_id"), { statusCode: 400 });
    if (!buffer?.length) throw Object.assign(new Error("file is empty"), { statusCode: 400 });
    return this.#paced(async () => {
      const sent = await this.sock.sendMessage(jid, {
        document: buffer,
        mimetype: mimetype || "application/octet-stream",
        fileName: fileName || "file",
        caption: caption || undefined,
      });
      return { id: sent?.key?.id || "" };
    });
  }

  async typing(chatId) {
    this.#assertOpen();
    const jid = toWaJid(chatId);
    if (!jid) return;
    await this.sock.sendPresenceUpdate("composing", jid).catch(() => {});
  }

  /** The phone behind an anonymised sender, if this session has learned it. */
  async resolveLid(lid) {
    try {
      const mapping = this.sock?.signalRepository?.lidMapping;
      if (!mapping?.getPNForLID) return null;
      const pn = await mapping.getPNForLID(String(lid));
      return pn || null;
    } catch {
      return null;
    }
  }

  status() {
    return {
      instanceId: this.id,
      label: this.meta.label || "",
      state: this.state,
      phone: this.phone,
      connectedAt: this.connectedAt,
      qrAt: this.qrAt,
      lastError: this.lastError,
      webhookUrl: this.meta.webhookUrl || "",
      createdAt: this.meta.createdAt,
    };
  }
}
