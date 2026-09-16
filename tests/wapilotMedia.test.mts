import assert from "node:assert/strict";
import { extractInboundMedia, fetchInboundMediaBytes } from "../src/lib/bot/wapilotMedia";

/**
 * Finding the voice note in a payload nobody documents.
 *
 * On the official Meta channel a voice note arrives as a typed object with a media id. The
 * Wapilot gateway is WAHA-shaped and does whatever its instance is configured to do: the file
 * inline as base64, or a URL, under `media`, or `_data`, or flat on the message. Get this wrong
 * and the patient is simply never answered — which is exactly what happened before this existed,
 * and is indistinguishable from the message never arriving.
 *
 * The cases below are the shapes seen in WAHA's own webhook documentation and in the payloads
 * already recorded in whatsapp_inbound_debug. The refusals matter as much as the matches: a
 * document or a plain chat message must not be read as a photo, because reading costs a credit.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

/** Mirrors what the inbound route hands in: the unwrapped candidates, outermost first. */
const one = (m: Record<string, unknown>) => [m];

run("a voice note with a download URL is audio", () => {
  const got = extractInboundMedia(
    one({ id: "false_201x@c.us_AAA", type: "ptt", mimetype: "audio/ogg; codecs=opus", media: { url: "https://api.wapilot.net/files/a.ogg", mimetype: "audio/ogg" } })
  );
  assert.equal(got?.kind, "audio");
  assert.equal(got?.url, "https://api.wapilot.net/files/a.ogg");
  assert.equal(got?.ref, "false_201x@c.us_AAA");
});

run("push-to-talk is audio even with no mime type at all", () => {
  // The shape that would be missed by a list written from Meta's vocabulary, where "ptt" does
  // not exist — and push-to-talk is the button patients actually hold down.
  const got = extractInboundMedia(one({ type: "ptt", media: { url: "https://api.wapilot.net/f.oga" } }));
  assert.equal(got?.kind, "audio");
});

run("a photo arrives inline as a data URI", () => {
  const body = `data:image/jpeg;base64,${"A".repeat(600)}`;
  const got = extractInboundMedia(one({ type: "image", mimetype: "image/jpeg", body }));
  assert.equal(got?.kind, "image");
  assert.equal(got?.base64, "A".repeat(600));
  assert.equal(got?.url, undefined);
});

run("bare base64 in the body counts when the message says it carries media", () => {
  const got = extractInboundMedia(one({ type: "image", mimetype: "image/png", hasMedia: true, body: "B".repeat(700) }));
  assert.equal(got?.kind, "image");
  assert.equal(got?.base64, "B".repeat(700));
});

run("the nested _data wrapper is read too", () => {
  const got = extractInboundMedia(one({ _data: { mimetype: "audio/mp4", id: { _serialized: "X1" } }, media: { url: "https://api.wapilot.net/v.m4a" } }));
  assert.equal(got?.kind, "audio");
});

run("a sticker is a picture; a video and a PDF are neither", () => {
  assert.equal(extractInboundMedia(one({ type: "sticker", media: { url: "https://api.wapilot.net/s.webp" } }))?.kind, "image");
  assert.equal(extractInboundMedia(one({ type: "video", mimetype: "video/mp4", media: { url: "https://x/v.mp4" } })), null);
  assert.equal(extractInboundMedia(one({ type: "document", mimetype: "application/pdf", media: { url: "https://x/d.pdf" } })), null);
});

run("a plain text message is not media", () => {
  assert.equal(extractInboundMedia(one({ type: "chat", body: "عايز أحجز بكره" })), null);
  assert.equal(extractInboundMedia(one({ body: "تمام" })), null);
  assert.equal(extractInboundMedia([]), null);
});

run("a long typed message is never mistaken for an inline file", () => {
  /*
   * The base64 sniffer only looks at long strings, so the guard that actually protects a talkative
   * patient is that nothing is sniffed until the payload has already declared a media type. A chat
   * message of 900 characters must stay a chat message — reading it as a photo would spend a
   * credit and answer with a description of nothing.
   */
  assert.equal(extractInboundMedia(one({ type: "chat", body: "A".repeat(900) })), null);
});

run("media declared but not delivered is still reported, with no source to fetch", () => {
  /*
   * An instance with media download switched off says "image" and sends no file. Nothing can be
   * read — and inventing a URL from the message id would fetch someone else's picture — but the
   * patient did send a photo, so the message must not vanish. It comes back with a kind and no
   * source, which is what makes the acknowledgement happen and the reason get written down.
   */
  const got = extractInboundMedia(one({ type: "image", mimetype: "image/jpeg" }));
  assert.equal(got?.kind, "image");
  assert.equal(got?.url, undefined);
  assert.equal(got?.base64, undefined);
});

run("the declaration and the bytes may sit in different wrappers", () => {
  // `payload` names the type, `_data` carries the file. Stopping at the first wrapper that
  // mentions a type would lose the recording that is sitting in the next one.
  const got = extractInboundMedia([
    { type: "ptt", mimetype: "audio/ogg" },
    { mimetype: "audio/ogg", media: { url: "https://api.wapilot.net/a.ogg" } },
  ]);
  assert.equal(got?.kind, "audio");
  assert.equal(got?.url, "https://api.wapilot.net/a.ogg");
});

run("a non-media wrapper never stops the search", () => {
  const got = extractInboundMedia([
    { type: "chat", body: "hello" },
    { type: "ptt", media: { url: "https://api.wapilot.net/a.ogg" } },
  ]);
  assert.equal(got?.kind, "audio");
});

/**
 * The fetch guards, which all answer before any network call or credential lookup.
 *
 * The URL being fetched comes out of a webhook body. Even behind the shared token, a body that
 * can name any address is a body that can ask the server to fetch the address — so the private
 * ranges are refused outright, and the gateway's API token is attached only for the gateway's own
 * host (checked by reading the code path, since proving it needs a live config).
 */
async function runAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

await runAsync("inline base64 is decoded without any network call", async () => {
  const bytes = Buffer.from("hello voice note");
  const got = await fetchInboundMediaBytes("c1", { kind: "audio", mime: "audio/ogg", base64: bytes.toString("base64"), ref: "r" });
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.bytes.toString(), "hello voice note");
    assert.equal(got.mime, "audio/ogg");
  }
});

await runAsync("a media declaration with nothing behind it fails with a readable reason", async () => {
  const got = await fetchInboundMediaBytes("c1", { kind: "image", mime: "image/jpeg", ref: "r" });
  assert.equal(got.ok, false);
  if (!got.ok) assert.equal(got.reason, "no_media_source");
});

await runAsync("the loopback and private ranges are refused", async () => {
  for (const url of [
    "http://127.0.0.1/secret",
    "http://localhost:8080/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.9/x",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/x",
  ]) {
    const got = await fetchInboundMediaBytes("c1", { kind: "image", mime: "image/jpeg", url, ref: "r" });
    assert.equal(got.ok, false, `${url} should be refused`);
    if (!got.ok) assert.equal(got.reason, "media_url_private", url);
  }
});

await runAsync("non-http schemes and malformed URLs are refused", async () => {
  const bad = await fetchInboundMediaBytes("c1", { kind: "image", mime: "image/jpeg", url: "file:///etc/passwd", ref: "r" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "media_url_scheme");

  const broken = await fetchInboundMediaBytes("c1", { kind: "image", mime: "image/jpeg", url: "not a url", ref: "r" });
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.reason, "media_url_invalid");
});

await runAsync("an oversized inline file is refused before it reaches the model", async () => {
  const huge = Buffer.alloc(7 * 1024 * 1024, 1).toString("base64");
  const got = await fetchInboundMediaBytes("c1", { kind: "image", mime: "image/jpeg", base64: huge, ref: "r" });
  assert.equal(got.ok, false);
  if (!got.ok) assert.equal(got.reason, "media_too_large");
});

console.log("\nwapilotMedia: all cases pass");
