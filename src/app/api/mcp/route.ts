import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { clinicActivity } from "@/lib/clinicStatus";
import { reportServerError } from "@/lib/server/reportError";
import { touchMcpKey, verifyMcpKey } from "@/lib/mcp/keys";
import { resolveMcpIdentity } from "@/lib/mcp/identity";
import { mcpToolCatalogue, runMcpTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A broad query over a busy clinic's ledger is the slow case, and it is still seconds. */
export const maxDuration = 60;

/**
 * The door an outside AI assistant knocks on.
 *
 * A clinic owner pastes this URL into Claude (Settings → Connectors), gives it a key minted in
 * Alpha Dental, and can then ask his own assistant about his own clinic — in whatever words he
 * likes, on his phone, in Arabic or English. The assistant does the reasoning; this endpoint
 * only answers questions about data.
 *
 * It speaks MCP over Streamable HTTP: JSON-RPC 2.0 in the body of a POST, a JSON object back.
 * There is no session, no SSE stream and no server-initiated message, because nothing here needs
 * them — every exchange is one question and one answer — and a transport with fewer moving parts
 * is a transport with fewer ways to be half-connected.
 *
 * WHAT THIS ENDPOINT DOES NOT CONTROL
 *
 * The model on the other side is the clinic's, not ours. There is no system prompt to write and
 * no instruction we can attach that the owner's assistant must obey — if he asks Claude for an
 * opinion about an employee, Claude will give him one. The only real lever is what the tools
 * return, which is why they return measurements rather than judgements. See lib/mcp/tools.ts.
 */

const SERVER_INFO = { name: "alpha-dental", version: "1.0.0" };

/** The revisions of the spec this server is known to satisfy; the newest is the default. */
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcId = string | number | null;

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0" as const, id, result: value };
}

function failure(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function unauthorized(detail: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: detail } },
    {
      status: 401,
      // Tells a well-behaved client that the credential was the problem, rather than letting it
      // retry the same key forever against what looks like a server fault.
      headers: { "WWW-Authenticate": 'Bearer realm="alpha-dental"' },
    }
  );
}

async function handleMessage(
  message: Record<string, unknown>,
  ctx: Awaited<ReturnType<typeof authorize>> & { ok: true }
): Promise<object | null> {
  const id = (message.id ?? null) as JsonRpcId;
  const method = String(message.method || "");
  const params = (message.params || {}) as Record<string, unknown>;

  switch (method) {
    case "initialize": {
      const asked = String(params.protocolVersion || "");
      return result(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        // Shown by some clients before the first question. Naming the clinic and the staff account
        // out loud is a small thing that prevents a large mistake: an owner who manages two
        // practices can see which one he is actually talking to.
        instructions:
          `You are connected to the Alpha Dental clinic management system for clinic "${ctx.clinicId}", ` +
          `acting as ${ctx.identity.name} (${ctx.identity.role}). You can read this clinic's live records ` +
          `and nothing else. Data is factual — attendance is punches, not performance; figures are what ` +
          `was recorded, not benchmarks. There is no market or industry data here, so do not compare this ` +
          `clinic's prices to outside figures as if this system supplied them.` +
          (ctx.key.scope === "full"
            ? " This connection can also create, change and delete records; confirm every such action with the user first."
            : " This connection is read-only."),
      });
    }

    // Notifications carry no id and get no reply, by the JSON-RPC spec. Returning a result for
    // one is a protocol error that some clients treat as fatal.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: mcpToolCatalogue(ctx.key.scope) });

    case "tools/call": {
      const name = String(params.name || "");
      const args = (params.arguments || {}) as Record<string, unknown>;

      // The expiry gate every other write in this codebase sits behind. requireStaffUser
      // applies it for routes that carry a login; this door has none, so it is asked here —
      // and only of writes, because a lapsed clinic keeps full read access to its own records.
      if ((name === "write_document" || name === "delete_document") && !ctx.active) {
        return result(id, {
          content: [{ type: "text", text: "This clinic's subscription has lapsed, so records cannot be changed. Reading still works." }],
          isError: true,
        });
      }
      const outcome = await runMcpTool(name, args, {
        clinicId: ctx.clinicId,
        uid: ctx.identity.uid,
        role: ctx.identity.role,
        permissions: ctx.identity.permissions,
        scope: ctx.key.scope,
      });

      // A tool that refused is reported through `isError` rather than a JSON-RPC error, because
      // the model is meant to read the reason and try something else. A transport-level error is
      // for the client to handle; this is for the model.
      if (!outcome.ok) {
        return result(id, { content: [{ type: "text", text: outcome.error }], isError: true });
      }
      return result(id, {
        content: [{ type: "text", text: JSON.stringify(outcome.data, null, 2) }],
      });
    }

    // Declared in neither capability, so a compliant client will not ask — but some probe anyway,
    // and an empty list is a better answer than a method-not-found the client logs as a fault.
    case "resources/list":
      return result(id, { resources: [] });
    case "prompts/list":
      return result(id, { prompts: [] });

    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

async function authorize(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false as const, response: unauthorized("Missing key. Send it as: Authorization: Bearer <key>.") };
  }

  const key = await verifyMcpKey(header.slice(7).trim());
  if (!key) {
    return { ok: false as const, response: unauthorized("That key is not valid, or it has been revoked.") };
  }

  const identity = await resolveMcpIdentity(key.uid, key.clinicId);
  if (!identity) {
    return {
      ok: false as const,
      response: unauthorized("The staff account this key belongs to no longer has a role at this clinic."),
    };
  }

  const clinicSnap = await adminDb().collection("clinics").doc(key.clinicId).get();
  const active = clinicActivity(clinicSnap.data() ?? null).active;

  return { ok: true as const, key, clinicId: key.clinicId, identity, active };
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  touchMcpKey(auth.key.id);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failure(null, -32700, "Body is not valid JSON."), { status: 400 });
  }

  try {
    // A batch is a list; a single call is an object. Both are legal JSON-RPC and clients differ.
    if (Array.isArray(body)) {
      const replies = await Promise.all(
        body.map((m) => handleMessage((m || {}) as Record<string, unknown>, auth))
      );
      const kept = replies.filter((r): r is object => r !== null);
      // A batch of nothing but notifications gets no body at all, only an acknowledgement.
      if (!kept.length) return new NextResponse(null, { status: 202 });
      return NextResponse.json(kept);
    }

    const reply = await handleMessage((body || {}) as Record<string, unknown>, auth);
    if (reply === null) return new NextResponse(null, { status: 202 });
    return NextResponse.json(reply);
  } catch (error) {
    reportServerError("api/mcp", error, { clinicId: auth.clinicId });
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json(failure(null, -32603, message), { status: 500 });
  }
}

/**
 * Some clients open a GET first to look for a server-initiated event stream.
 *
 * 405 is the spec's own answer for a server that does not offer one, and it stops the client
 * retrying. Anything friendlier here — a 200 with a message — reads as a broken stream instead.
 */
export function GET() {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "This MCP server is POST-only." } },
    { status: 405, headers: { Allow: "POST" } }
  );
}
