import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { useEncryptedFileAuthState } from "./authState.js";
import { config } from "./config.js";
import { classify, dailyProactiveCap, daysBetween, inSendWindow, nextWindowOpen, zonedParts } from "./policy.js";
import { PersistedQueue } from "./queue.js";
import {
  buildAckEvent,
  buildMessageEvent,
  digitsOf,
  isSilentMessage,
  messageAd,
  messageMedia,
  messageText,
  randomGap,
  toWaJid,
} from "./shape.js";

/**
 * One clinic's WhatsApp, kept alive.
 *
 * An instance is a WhatsApp Web session (the same thing the phone shows under Linked devices)
 * plus the things around it that make it a service: a queue that paces outgoing messages like
 * a person and holds them for clinic hours, a webhook that hands every incoming message to the
 * web app, and a brake that stops everything when WhatsApp shows signs of a restriction.
 *
 * States, in the order a clinic sees them:
 *   starting   — socket being built
 *   qr         — waiting for the phone to scan (`qr` holds the current code; it rotates)
 *   connecting — scanned, handshake in progress
 *   open       — live
 *   closed     — dropped; reconnecting on its own
 *   logged_out — the phone removed us (or the clinic asked); needs a new scan
 *   restricted — the brake: WhatsApp refused us or logged us out repeatedly; waits for a person
 *
 * ── Sending ──────────────────────────────────────────────────────────────────────────────────
 * `sendText` / `sendDocument` do not send. They classify the message (reply or proactive — see
 * policy.js), decide when it may leave, put it in the on-disk queue and return its id at once.
 * The id is generated here and handed to WhatsApp on the actual send, so it is the same string
 * the web app stored and the same one the delivery acks later carry. The drain loop then sends
 * whatever is due, one at a time, with a random human gap between messages.
 */
export class Instance {
  constructor(meta, { logger, dataDir }) {
    this.id = meta.id;
    this.meta = meta;
    this.log = logger.child({ instance: meta.id });
    this.dir = join(dataDir, "instances", meta.id);
    this.mediaDir = join(dataDir, "media", meta.id);
    this.outboxDir = join(dataDir, "outbox", meta.id);

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
    this.logoutTimes = [];
    this.qrCycles = 0;

    // Outbound.
    this.queue = new PersistedQueue(join(this.dir, "queue.json"));
    this.draining = false;
    this.drainTimer = null;
    this.lastSendAt = 0;

    // What this number knows about the people it talks to: when each chat last wrote in (decides
    // reply vs proactive) and whom it has ever messaged (decides whether a number needs the
    // "is this on WhatsApp?" check). Persisted, because "wrote in yesterday" must survive a restart.
    this.contacts = { inbound: {}, contacted: {} };
    this.contactsDirty = false;

    // Today's first-contact count, under the day key in the clinic's zone.
    this.daily = { day: "", proactive: 0 };
  }

  /* ───────────────────────── lifecycle ───────────────────────── */

  async start() {
    this.stopping = false;
    await mkdir(this.mediaDir, { recursive: true });
    await mkdir(this.outboxDir, { recursive: true });
    await this.#loadState();
    await this.#connect();
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.drainTimer);
    await this.#saveState().catch(() => {});
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

  /** Forget the login and come back up waiting for a fresh scan. Also clears the brake. */
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
    this.logoutTimes = [];
    this.state = "logged_out";
    await this.start();
  }

  /** A person has looked: lift the brake and reconnect with the same session. */
  async resume() {
    this.logoutTimes = [];
    this.qrCycles = 0;
    this.reconnectAttempt = 0;
    await this.stop();
    await this.start();
  }

  async destroy() {
    await this.stop();
    await rm(this.dir, { recursive: true, force: true });
    await rm(this.mediaDir, { recursive: true, force: true });
    await rm(this.outboxDir, { recursive: true, force: true });
  }

  async #loadState() {
    await this.queue.load();
    try {
      const raw = JSON.parse(await readFile(join(this.dir, "state.json"), "utf8"));
      if (raw?.contacts) this.contacts = { inbound: raw.contacts.inbound || {}, contacted: raw.contacts.contacted || {} };
      if (raw?.daily) this.daily = raw.daily;
      if (raw?.connectedAt) this.connectedAt = raw.connectedAt;
      if (raw?.firstConnectedAt) this.meta.firstConnectedAt = raw.firstConnectedAt;
    } catch {
      /* first run */
    }
  }

  async #saveState() {
    await writeFile(
      join(this.dir, "state.json"),
      JSON.stringify({ contacts: this.contacts, daily: this.daily, connectedAt: this.connectedAt, firstConnectedAt: this.meta.firstConnectedAt })
    );
    this.contactsDirty = false;
  }

  #touchState() {
    // Coalesced: a burst of inbound messages is one write, not fifty.
    if (this.contactsDirty) return;
    this.contactsDirty = true;
    setTimeout(() => this.#saveState().catch((e) => this.log.warn({ err: e?.message }, "state save failed")), 2000);
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
      this.qrCycles = 0;
      this.connectedAt = Date.now();
      // The number's age, for the warm-up curve, is counted from its FIRST successful link — a
      // reconnect after a Wi-Fi drop must not reset a week of trust to day zero.
      if (!this.meta.firstConnectedAt) this.meta.firstConnectedAt = this.connectedAt;
      const me = this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : "";
      this.phone = digitsOf(me) || this.phone;
      this.log.info({ phone: this.phone, queued: this.queue.size }, "connected");
      this.#touchState();
      this.#kickDrain();
      return;
    }
    if (connection === "close") {
      // Baileys wraps the close reason in a Boom error; the status code is what tells them apart.
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "closed";
      this.lastError = reason;
      this.sock = null;

      if (code === DisconnectReason.forbidden) {
        // WhatsApp refused the session outright. That is what a ban or restriction looks like
        // from a linked device, and knocking again is the one thing that makes it worse.
        this.#trip("WhatsApp refused the connection (403). The number may be restricted. Check the phone, then press New QR or Resume.");
        return;
      }

      if (code === DisconnectReason.loggedOut) {
        // The phone removed this device (Linked devices → Log out), or the account was banned —
        // and a restricted account drops its linked devices too. One logout is a person; three
        // in a quarter of an hour is WhatsApp, and the brake goes on rather than a fresh QR.
        const now = Date.now();
        this.logoutTimes = this.logoutTimes.filter((t) => now - t < config.logoutStormWindowMs);
        this.logoutTimes.push(now);
        this.phone = null;
        this.auth?.clear().catch(() => {});
        if (this.logoutTimes.length >= config.logoutStormCount) {
          this.#trip(`Logged out ${this.logoutTimes.length} times in ${Math.round(config.logoutStormWindowMs / 60000)} minutes. The number may be restricted. Wait, check the phone, then press New QR.`);
          return;
        }
        this.log.warn("logged out by the phone; clearing session");
        this.state = "logged_out";
        this.#scheduleReconnect(2000);
        return;
      }
      if (this.stopping) {
        this.state = "closed";
        return;
      }

      // Nobody scanned. WhatsApp hands out a few codes and then closes with 408; left alone, the
      // gateway would open a fresh pairing every minute for ever — a clinic that clicked Connect
      // and walked away would look, from WhatsApp's side, like a machine hammering the pairing
      // endpoint from a datacenter. Three rounds, then wait for a person to click again.
      if (code === DisconnectReason.timedOut && !this.phone && /QR/i.test(reason)) {
        this.qrCycles += 1;
        if (this.qrCycles >= 3) {
          this.state = "qr_expired";
          this.lastError = "Nobody scanned the code in time. Press Connect by QR for a new one.";
          this.log.info("QR expired three times; waiting for a person");
          return;
        }
      }

      this.state = "closed";
      // 515 = "restart required" after pairing: expected, immediate. Anything else backs off.
      this.log.warn({ code, reason }, "connection closed");
      this.#scheduleReconnect(code === DisconnectReason.restartRequired ? 500 : undefined);
    }
  }

  /** Put the brake on: no reconnects, no sends, until a person presses Resume or New QR. */
  #trip(message) {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.drainTimer);
    this.state = "restricted";
    this.lastError = message;
    this.log.error({ queued: this.queue.size }, message);
  }

  #scheduleReconnect(delayMs) {
    if (this.stopping || this.state === "restricted") return;
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

    if (!key.fromMe) {
      // This chat wrote to us: for the next 24 hours anything we send it is a reply. Remembered
      // under both ids WhatsApp may use for the same person, so a send addressed by phone is
      // recognised as a reply to a message that arrived under a lid.
      const now = Date.now();
      this.contacts.inbound[jid] = now;
      if (phoneJid) this.contacts.inbound[jidNormalizedUser(phoneJid)] = now;
      this.#touchState();
    }

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
      ad: key.fromMe ? null : messageAd(msg.message),
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

  #window() {
    return { tz: config.sendTz, startHour: config.windowStartHour, endHour: config.windowEndHour };
  }

  /** Today's first-contact allowance and how much of it is used. */
  #dailyStatus(now = new Date()) {
    const { dayKey } = zonedParts(now, config.sendTz);
    if (this.daily.day !== dayKey) this.daily = { day: dayKey, proactive: 0 };
    const cap = dailyProactiveCap(daysBetween(this.meta.firstConnectedAt, now.getTime()), config.warmup);
    return { cap, used: this.daily.proactive, left: Math.max(0, cap - this.daily.proactive) };
  }

  /**
   * Decide when a message may leave, before it goes in the queue.
   *
   * A reply leaves now. A proactive message leaves now if the window is open and the day's
   * allowance has room; otherwise it is dated for the next opening. A message already dated
   * for tomorrow is only re-examined then, by the drain loop, which applies the same rules
   * again — the window may have closed, the allowance may be gone — and re-dates it if needed.
   */
  #schedule(jid, now = new Date()) {
    const kind = classify(this.contacts.inbound[jid], now);
    if (kind === "reply") return { kind, notBefore: now.getTime() };
    if (!inSendWindow(now, this.#window())) return { kind, notBefore: nextWindowOpen(now, this.#window()).getTime(), held: "window" };
    if (this.#dailyStatus(now).left <= 0) return { kind, notBefore: nextWindowOpen(now, this.#window()).getTime(), held: "daily_cap" };
    return { kind, notBefore: now.getTime() };
  }

  async #enqueue(item) {
    const { kind, notBefore, held } = this.#schedule(item.jid);
    const full = { ...item, id: generateMessageIDV2(), proactive: kind === "proactive", notBefore, createdAt: Date.now(), attempts: 0 };
    await this.queue.push(full);
    if (held) this.log.info({ id: full.id, held, notBefore: new Date(notBefore).toISOString() }, "message held");
    this.#kickDrain();
    return { id: full.id, queued: true, proactive: full.proactive, notBefore, held: held || null };
  }

  async sendText(chatId, text) {
    const jid = toWaJid(chatId);
    if (!jid) throw Object.assign(new Error("Invalid chat_id"), { statusCode: 400 });
    const body = String(text ?? "");
    if (!body.trim()) throw Object.assign(new Error("text is required"), { statusCode: 400 });
    if (this.state === "restricted") throw Object.assign(new Error(`Sending is paused: ${this.lastError}`), { statusCode: 503 });
    return this.#enqueue({ jid, kind: "text", text: body });
  }

  async sendDocument(chatId, { buffer, mimetype, fileName, caption }) {
    const jid = toWaJid(chatId);
    if (!jid) throw Object.assign(new Error("Invalid chat_id"), { statusCode: 400 });
    if (!buffer?.length) throw Object.assign(new Error("file is empty"), { statusCode: 400 });
    if (this.state === "restricted") throw Object.assign(new Error(`Sending is paused: ${this.lastError}`), { statusCode: 503 });
    // The bytes wait on disk with the queue, not in memory with the process.
    const fileId = generateMessageIDV2();
    const file = join(this.outboxDir, fileId);
    await writeFile(file, buffer);
    return this.#enqueue({ jid, kind: "document", file, mimetype: mimetype || "application/octet-stream", fileName: fileName || "file", caption: caption || "" });
  }

  #kickDrain() {
    clearTimeout(this.drainTimer);
    if (this.draining || this.state !== "open") return;
    const due = this.queue.dueNow();
    if (due) {
      this.#drain().catch((e) => this.log.error({ err: e?.message }, "drain failed"));
      return;
    }
    const next = this.queue.nextDueAt();
    if (next != null) this.drainTimer = setTimeout(() => this.#kickDrain(), Math.max(1000, Math.min(next - Date.now(), 3600_000)));
  }

  /**
   * Send what is due, one at a time, at a human pace.
   *
   * The gap is measured from the previous send: short for a reply (someone is waiting), long
   * and random for a proactive message (nobody is, and forty identical-looking sends two seconds
   * apart is the signature WhatsApp's classifier is trained on). Each item is re-checked against
   * the rules at the moment of sending, so a batch that started at 21:55 stops at 22:00 and
   * carries on at 10:00.
   */
  async #drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.stopping && this.state === "open") {
        const now = new Date();
        const item = this.queue.dueNow(now.getTime());
        if (!item) break;

        // Rules again, now: the window may have closed while the batch was running.
        if (item.proactive) {
          const { notBefore, held } = this.#schedule(item.jid, now);
          if (held) {
            await this.queue.update(item.id, { notBefore });
            this.log.info({ id: item.id, held }, "message re-held");
            continue;
          }
        }

        const [lo, hi] = item.proactive ? config.proactiveGapMs : config.replyGapMs;
        const wait = this.lastSendAt + randomGap(lo, hi) - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (this.state !== "open" || !this.sock) break;

        try {
          await this.#sendNow(item);
          await this.queue.remove(item.id);
          if (item.proactive) {
            this.daily.proactive += 1;
            this.contacts.contacted[item.jid] = Date.now();
            this.#touchState();
          }
        } catch (e) {
          const permanent = e?.permanent === true;
          this.log.warn({ id: item.id, err: e?.message, permanent, attempts: item.attempts + 1 }, "send failed");
          if (permanent || item.attempts + 1 >= 3) {
            await this.queue.remove(item.id);
            if (item.kind === "document") await rm(item.file, { force: true }).catch(() => {});
            // Tell the web app, in the shape its ack parser reads, so the chat shows a red mark
            // instead of a message stuck on one tick forever.
            await this.#postWebhook(buildAckEvent({ instanceId: this.id, key: { id: item.id, remoteJid: item.jid, fromMe: true }, status: 0 }));
          } else {
            // A transient failure: try again in a minute, after everything else that is due.
            await this.queue.update(item.id, { attempts: item.attempts + 1, notBefore: Date.now() + 60_000 });
          }
        } finally {
          this.lastSendAt = Date.now();
        }
      }
    } finally {
      this.draining = false;
      this.#kickDrain();
    }
  }

  async #sendNow(item) {
    const sock = this.sock;
    if (!sock) throw new Error("not connected");

    // A number we have never spoken to and that never wrote to us: make sure it is on WhatsApp
    // before writing to it. Sending to numbers that are not is one of the clearer machine tells.
    if (item.proactive && /@s\.whatsapp\.net$/.test(item.jid) && !this.contacts.contacted[item.jid] && !this.contacts.inbound[item.jid]) {
      try {
        const [hit] = await sock.onWhatsApp(item.jid);
        if (hit && hit.exists === false) throw Object.assign(new Error("number is not on WhatsApp"), { permanent: true });
      } catch (e) {
        if (e?.permanent) throw e;
        // A lookup failure is not a reason to drop the message.
      }
    }

    if (item.kind === "text") {
      // A person types before they send. Short and bounded: decoration, never a delay worth noticing.
      try {
        await sock.sendPresenceUpdate("composing", item.jid);
        await new Promise((r) => setTimeout(r, Math.min(1500, 300 + item.text.length * 15)));
      } catch {
        /* cosmetic */
      }
      await sock.sendMessage(item.jid, { text: item.text }, { messageId: item.id });
      sock.sendPresenceUpdate("paused", item.jid).catch(() => {});
      return;
    }

    if (item.kind === "document") {
      let buffer;
      try {
        buffer = await readFile(item.file);
      } catch {
        throw Object.assign(new Error("queued file is gone"), { permanent: true });
      }
      await sock.sendMessage(item.jid, { document: buffer, mimetype: item.mimetype, fileName: item.fileName, caption: item.caption || undefined }, { messageId: item.id });
      await rm(item.file, { force: true }).catch(() => {});
      return;
    }

    throw Object.assign(new Error(`unknown item kind ${item.kind}`), { permanent: true });
  }

  async typing(chatId) {
    if (this.state !== "open" || !this.sock) return;
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
    const now = new Date();
    const daily = this.#dailyStatus(now);
    const open = inSendWindow(now, this.#window());
    return {
      instanceId: this.id,
      label: this.meta.label || "",
      state: this.state,
      phone: this.phone,
      connectedAt: this.connectedAt,
      firstConnectedAt: this.meta.firstConnectedAt || null,
      qrAt: this.qrAt,
      lastError: this.lastError,
      webhookUrl: this.meta.webhookUrl || "",
      createdAt: this.meta.createdAt,
      sending: {
        windowOpen: open,
        window: `${String(config.windowStartHour).padStart(2, "0")}:00–${String(config.windowEndHour).padStart(2, "0")}:00 ${config.sendTz}`,
        nextOpenAt: open ? null : nextWindowOpen(now, this.#window()).getTime(),
        queued: this.queue.size,
        waiting: this.queue.countWaiting(now.getTime()),
        dailyCap: daily.cap,
        sentToday: daily.used,
      },
    };
  }
}
