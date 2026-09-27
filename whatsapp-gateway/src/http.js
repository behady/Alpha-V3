import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import QRCode from "qrcode";
import { config } from "./config.js";
import { Registry } from "./registry.js";

/**
 * The HTTP face of the gateway. Two audiences, two doors:
 *
 *   /admin/…      — the web app's server, holding GATEWAY_ADMIN_KEY. Creates instances, reads
 *                   QR codes, disconnects numbers. Never reachable with an instance token.
 *   /api/v2/:id/… — one clinic's instance, holding that instance's own token. Sends messages.
 *                   Deliberately shaped like Wapilot's API (`send-message`, `send-file`, header
 *                   `Token`, body `{ chat_id, text }`) so the web app switches gateways by
 *                   changing a base URL, not by learning a second dialect.
 *
 * Plain node:http on purpose: the whole surface is a dozen routes, and a framework would be
 * the largest dependency in the folder.
 */

const MAX_BODY = 20 * 1024 * 1024;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** JSON, form-encoded or multipart — whichever the caller used — as one plain object. */
async function parseBody(req) {
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const raw = await readBody(req);
    const form = await new Response(Readable.toWeb(Readable.from([raw])), { headers: { "content-type": req.headers["content-type"] } }).formData();
    const out = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
      else out[k] = { file: true, name: v.name, type: v.type, bytes: Buffer.from(await v.arrayBuffer()) };
    }
    return out;
  }
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { statusCode: 400 });
  }
}

async function fetchFile(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw Object.assign(new Error("invalid file url"), { statusCode: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw Object.assign(new Error("file url must be http(s)"), { statusCode: 400 });
  const res = await fetch(target, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) throw Object.assign(new Error(`file download failed (${res.status})`), { statusCode: 502 });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > config.maxMediaBytes) throw Object.assign(new Error("file too large"), { statusCode: 413 });
  return { bytes, type: (res.headers.get("content-type") || "").split(";")[0].trim() };
}

export function createHttpServer({ registry, logger }) {
  const startedAt = Date.now();

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method || "GET";

    if (path === "/health" && method === "GET") {
      const list = registry.list();
      return json(res, 200, {
        status: "ok",
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        instances: list.length,
        open: list.filter((i) => i.state === "open").length,
      });
    }

    /* ───────────── admin door ───────────── */
    if (path.startsWith("/admin/")) {
      const key = String(req.headers["x-admin-key"] || "") || bearer(req);
      if (!safeEqual(key, config.adminKey)) return json(res, 401, { ok: false, error: "Unauthorized" });

      if (path === "/admin/instances" && method === "GET") return json(res, 200, { ok: true, instances: registry.list() });

      if (path === "/admin/instances" && method === "POST") {
        const body = await parseBody(req);
        const { instance, token, created } = await registry.create({
          instanceId: body.instanceId,
          webhookUrl: body.webhookUrl,
          label: body.label,
        });
        return json(res, created ? 201 : 200, { ok: true, created, token, ...instance.status() });
      }

      const m = /^\/admin\/instances\/([^/]+)(?:\/(qr|logout|restart|webhook))?$/.exec(path);
      if (m) {
        const inst = registry.get(decodeURIComponent(m[1]));
        if (!inst) return json(res, 404, { ok: false, error: "No such instance" });
        const sub = m[2];

        if (!sub && method === "GET") {
          const status = inst.status();
          // The QR as a PNG data URL, ready for an <img>. Codes rotate about every 20 seconds
          // and each is only valid for the socket that produced it, so the caller polls.
          let qr = null;
          if (inst.state === "qr" && inst.qr) qr = await QRCode.toDataURL(inst.qr, { margin: 1, width: 320 }).catch(() => null);
          return json(res, 200, { ok: true, ...status, qr, token: inst.meta.token });
        }
        if (!sub && method === "PATCH") {
          const body = await parseBody(req);
          await registry.update(inst.id, { webhookUrl: body.webhookUrl, label: body.label });
          return json(res, 200, { ok: true, ...inst.status() });
        }
        if (!sub && method === "DELETE") {
          await registry.remove(inst.id);
          return json(res, 200, { ok: true, removed: true });
        }
        if (sub === "logout" && method === "POST") {
          await inst.logout();
          return json(res, 200, { ok: true, ...inst.status() });
        }
        if (sub === "restart" && method === "POST") {
          await inst.stop();
          await inst.start();
          return json(res, 200, { ok: true, ...inst.status() });
        }
      }
      return json(res, 404, { ok: false, error: "Not found" });
    }

    /* ───────────── instance door (Wapilot-shaped) ───────────── */
    const im = /^\/api\/v2\/([^/]+)\/(.+)$/.exec(path);
    if (im) {
      const inst = registry.get(decodeURIComponent(im[1]));
      const action = im[2];
      const token = String(req.headers.token || "") || bearer(req);
      if (!inst || !safeEqual(token, inst.meta.token)) return json(res, 401, { ok: false, error: "Unauthorized" });

      try {
        if (action === "status" && method === "GET") return json(res, 200, { ok: true, ...inst.status() });

        if (action === "send-message" && method === "POST") {
          const body = await parseBody(req);
          const chatId = body.chat_id || body.chatId || body.phone || body.to;
          const text = body.text ?? body.message ?? body.body;
          const sent = await inst.sendText(chatId, text);
          // `id` at the root is what the web app's wapilotMessageId reads first; the same string
          // later arrives on the ack event, which is how the ticks find their message.
          return json(res, 200, { ok: true, id: sent.id, data: { id: sent.id, chatId: sent.chatId } });
        }

        if (action === "send-file" && method === "POST") {
          const body = await parseBody(req);
          const chatId = body.chat_id || body.chatId || body.phone || body.to;
          const caption = typeof body.caption === "string" ? body.caption : "";
          let buffer = null;
          let mimetype = typeof body.mimetype === "string" ? body.mimetype : "";
          let fileName = typeof body.filename === "string" ? body.filename : "";
          const upload = body.media && body.media.file ? body.media : body.file && body.file.file ? body.file : null;
          if (upload) {
            buffer = upload.bytes;
            mimetype = mimetype || upload.type;
            fileName = fileName || upload.name;
          } else {
            const fileUrl =
              (body.media && typeof body.media === "object" && body.media.url) || body.media_url || body.file_url || body.content || (typeof body.file === "string" ? body.file : "");
            if (!fileUrl) throw Object.assign(new Error("a file (multipart `media`) or a file url is required"), { statusCode: 400 });
            const got = await fetchFile(fileUrl);
            buffer = got.bytes;
            mimetype = mimetype || (body.media && body.media.mimetype) || got.type;
            fileName = fileName || (body.media && body.media.filename) || "file";
          }
          const sent = await inst.sendDocument(chatId, { buffer, mimetype, fileName, caption });
          return json(res, 200, { ok: true, id: sent.id, data: { id: sent.id } });
        }

        if (action === "typing" && method === "POST") {
          const body = await parseBody(req);
          await inst.typing(body.chat_id || body.chatId || body.phone || body.to);
          return json(res, 200, { ok: true });
        }

        const lid = /^lids\/([^/]+)$/.exec(action);
        if (lid && method === "GET") {
          const pn = await inst.resolveLid(`${decodeURIComponent(lid[1]).replace(/@lid$/i, "")}@lid`);
          if (!pn) return json(res, 404, { ok: false, error: "Unknown lid" });
          const digits = pn.split("@")[0].split(":")[0];
          return json(res, 200, { ok: true, pn: digits, phone: `+${digits}` });
        }

        const media = /^media\/([^/]+)$/.exec(action);
        if (media && method === "GET") {
          const found = await inst.readMedia(decodeURIComponent(media[1]));
          if (!found) return json(res, 404, { ok: false, error: "Media expired or unknown" });
          res.writeHead(200, { "Content-Type": found.mimetype, "Content-Length": found.bytes.length, "Cache-Control": "private, max-age=3600" });
          return res.end(found.bytes);
        }
      } catch (e) {
        const status = e?.statusCode || 500;
        // 503 is "not scanned yet" — a state, not a fault; it is logged quietly.
        if (status === 503) logger.warn({ instance: inst.id, action, state: inst.state }, "send while not connected");
        else if (status >= 500) logger.error({ err: e?.message, instance: inst.id, action }, "instance request failed");
        return json(res, status, { ok: false, error: e?.message || "Failed" });
      }
      return json(res, 404, { ok: false, error: "Not found" });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e?.statusCode || 500;
      if (status >= 500) logger.error({ err: e?.message, url: req.url }, "request failed");
      if (!res.headersSent) json(res, status, { ok: false, error: e?.message || "Failed" });
      else res.end();
    });
  });
}

export { Registry };
