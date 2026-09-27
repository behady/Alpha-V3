# Alpha Dental — WhatsApp gateway

Our own replacement for Wapilot. It keeps a WhatsApp Web session open for each clinic (the same
thing the phone lists under *Linked devices*), sends messages through it, and hands every
incoming message to the web app. The web app already talks Wapilot's API; this speaks the same
one, so a clinic moves over by pointing at a different address, not by learning anything new.

## What runs where

```
patient's phone ⇄ WhatsApp ⇄ this gateway (a small always-on server) ⇄ alphadental.app (Vercel)
```

- **This folder** is the gateway. One Node process, one Docker container, one clinic per
  "instance". Sessions are encrypted on disk and survive restarts and code updates.
- **The web app** creates instances and shows QR codes through `src/lib/waGateway.ts`, and
  sends messages through the same `lib/whatsapp.ts` it used for Wapilot.

It cannot live on Vercel: a WhatsApp session is a permanent open connection, and Vercel
functions stop between requests.

## Deploy it (once)

You need a small Linux server (Hetzner CX22 or DigitalOcean's smallest droplet is plenty — one
box carries dozens of clinics) and a subdomain pointing at it.

1. **DNS.** Add an `A` record: `wa.alphadental.app` → the server's IP.
2. **Docker** on the server:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Get this folder onto the server** (clone the repo and `cd whatsapp-gateway`, or copy the
   folder with `scp`).
4. **Secrets:**
   ```bash
   cp .env.example .env
   openssl rand -hex 32   # paste as GATEWAY_ADMIN_KEY
   openssl rand -hex 32   # paste as GATEWAY_SESSION_KEY
   nano .env              # also set GATEWAY_DOMAIN / GATEWAY_PUBLIC_URL
   ```
5. **Start it:**
   ```bash
   docker compose up -d --build
   ```
6. **Check it:** `curl https://wa.alphadental.app/health` → `{"status":"ok",...}`.
7. **Tell the web app** — in Vercel → Project → Settings → Environment Variables:
   - `ALPHA_WA_GATEWAY_URL` = `https://wa.alphadental.app`
   - `ALPHA_WA_GATEWAY_ADMIN_KEY` = the same value as `GATEWAY_ADMIN_KEY`
   - `WHATSAPP_INBOUND_TOKEN` must already be set (it is what the gateway's webhook calls carry).

   Redeploy, and the *Connect by QR* button appears under Settings → WhatsApp.

## Update it

```bash
git pull            # or copy the folder again
docker compose up -d --build
```

Sessions live in `./data` and are reloaded on start. Clinics do not scan again.

## Back it up

`./data` plus the `GATEWAY_SESSION_KEY` from `.env` **together** are every clinic's WhatsApp
login. Either alone is useless. Copy both somewhere safe; restoring them onto a new machine
brings every clinic back without a scan.

## The API, for reference

Instance calls take the instance's own token in a `Token` header (Wapilot's convention) or as
`Authorization: Bearer …`.

| Call | Body | Notes |
| --- | --- | --- |
| `POST /api/v2/{id}/send-message` | `{ chat_id, text }` | `chat_id` is `2010…@c.us`, bare digits, or a `…@lid`. Returns `{ id }`. |
| `POST /api/v2/{id}/send-file` | multipart `media` + `chat_id`, `caption`, `filename` — or JSON with a `media.url` | Sent as a document. |
| `POST /api/v2/{id}/typing` | `{ chat_id }` | "typing…" on the patient's screen. |
| `GET /api/v2/{id}/lids/{lid}` | | The phone behind an anonymised sender, if known. |
| `GET /api/v2/{id}/media/{msgId}` | | Bytes of an inbound voice note or photo, for 48 hours. |
| `GET /api/v2/{id}/status` | | `state`, `phone`. |

Admin calls take `X-Admin-Key: <GATEWAY_ADMIN_KEY>`.

| Call | Notes |
| --- | --- |
| `POST /admin/instances` `{ instanceId, webhookUrl, label }` | Create; returns the instance token. Repeating it returns the same token. |
| `GET /admin/instances/{id}` | State, phone, and `qr` (a PNG data URL) while waiting for a scan. |
| `POST /admin/instances/{id}/logout` | Forget the login; comes back waiting for a new scan. |
| `DELETE /admin/instances/{id}` | Remove entirely. |

Webhook events posted to `webhookUrl` use the WAHA layout the web app's inbound route already
parses: `{ event: "message", payload: { id, from, fromMe, body, type, mimetype, media: { url } } }`
and `{ event: "message.ack", payload: { id, from, fromMe: true, ack, ackName } }`.

## Sending pace

WhatsApp bans numbers that behave like machines. Every send waits a random 1.5–4 s after the
previous one, shows "typing…" first, and no number sends more than 20 messages in any minute
— extra ones wait rather than fail. The web app's own protections (the opt-out footer, the
per-patient flood guard) sit on top of this.

## Tests

```bash
npm test
```
