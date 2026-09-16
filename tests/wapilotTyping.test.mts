import assert from "node:assert/strict";
import { sendWapilotTyping, typingEndpoint } from "../src/lib/whatsapp";
import type { WapilotConfig } from "../src/types/wapilot";

/**
 * The typing indicator, which on this channel is usually nothing at all.
 *
 * Wapilot publishes no typing endpoint. Probed live on 2026-09-16 against api.wapilot.net with
 * two real instances: `send-message` and `send-file` resolve and then check the instance
 * (INSTANCE_NOT_FOUND / INSTANCE_FORBIDDEN), while typing, start-typing, presence, chat-state and
 * seen all answer NOT_FOUND — on v1, v2 and v3 alike. So the honest default is off.
 *
 * "Off" has to mean NO REQUEST, not a request that fails. An indicator is decoration in front of
 * a real answer; buying it with a round trip and a 404 before every reply would cost the patient
 * real waiting for nothing. That is the property these cases exist to hold.
 *
 * It stays configurable because a clinic can point this integration at its own WAHA instance,
 * which does have `/api/startTyping`.
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

async function runAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const base: WapilotConfig = {
  instanceId: "inst123",
  token: "tok",
  apiRoot: "https://api.wapilot.net/api/v2",
  sendUrlOverride: null,
  sendDocumentUrlOverride: null,
  sendPathTemplate: "/{instanceId}/send-message",
  sendDocumentPathTemplate: "/{instanceId}/send-file",
  typingUrlOverride: null,
  typingPathTemplate: null,
  source: "clinic",
};

run("the default is off — the gateway has no such endpoint", () => {
  assert.equal(typingEndpoint(base), null);
});

run("a configured path is built against the instance, like every other send", () => {
  assert.equal(
    typingEndpoint({ ...base, typingPathTemplate: "/{instanceId}/start-typing" }),
    "https://api.wapilot.net/api/v2/inst123/start-typing"
  );
});

run("a full URL override wins, for a self-hosted WAHA on another host", () => {
  assert.equal(
    typingEndpoint({ ...base, typingUrlOverride: "https://waha.clinic.local/api/startTyping", typingPathTemplate: "/{instanceId}/x" }),
    "https://waha.clinic.local/api/startTyping"
  );
});

run("credentials missing means off, whatever the path says", () => {
  assert.equal(typingEndpoint({ ...base, token: "", typingPathTemplate: "/{instanceId}/typing" }), null);
  assert.equal(typingEndpoint({ ...base, instanceId: "", typingPathTemplate: "/{instanceId}/typing" }), null);
});

await runAsync("with nothing configured, not one request is made", async () => {
  /*
   * The case that matters. `sendWapilotTyping` swallows every error by design, so a version that
   * fired a doomed request would look identical from outside — and would sit in front of every
   * single reply on this channel. Counting calls is the only way to tell the two apart.
   */
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    calls += 1;
    return realFetch(...(args as Parameters<typeof fetch>));
  }) as typeof fetch;

  /*
   * With no Firebase credentials here, loadWapilotConfig cannot read Firestore and warns before
   * falling back to the environment — which configures no typing path, which is the state every
   * clinic is in today and exactly what this case needs. The warning is expected, so it is
   * silenced rather than left to make a passing test look like a failing one.
   */
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await sendWapilotTyping("no-such-clinic-for-typing-test", "201551552440");
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
  assert.equal(calls, 0, "a typing indicator with no endpoint must not cost a round trip");
});

console.log("\nwapilotTyping: all cases pass");
