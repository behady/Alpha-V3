import { NextResponse } from "next/server";
import { reportServerError } from "@/lib/server/reportError";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { holdsPermission } from "@/lib/permissions";
import { listMcpKeys, mintMcpKey, revokeMcpKey, type McpKeyScope } from "@/lib/mcp/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minting, listing and revoking the keys that let an outside AI assistant into a clinic.
 *
 * Gated on `access.settings` rather than on a role, so it follows the same checkbox that governs
 * every other clinic-wide configuration screen. The gate is not a formality: a key is a standing
 * grant to a program nobody here controls, and handing one out is a bigger decision than any
 * single record it can read.
 *
 * A key is always minted **for the person minting it**. There is no field for choosing somebody
 * else's account, because a key issued in another staff member's name would be an escalation tool
 * — mint one as the Owner, connect it to your own assistant, and read everything. If a dentist
 * wants his own connector he mints his own, under his own permissions.
 */

function denyWithoutSettings(role: string | null, permissions: string[]) {
  if (holdsPermission(role, permissions, "access.settings")) return null;
  return NextResponse.json(
    { ok: false, error: "Connecting an AI assistant is limited to staff who manage clinic settings." },
    { status: 403 }
  );
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("clinicId")?.trim() || undefined;
  const authz = await requireStaffUser(request, requested, { allowInactive: true });
  if (!authz.ok) return authz.response;

  const denied = denyWithoutSettings(authz.role, authz.permissions);
  if (denied) return denied;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requested);
    return NextResponse.json({ ok: true, keys: await listMcpKeys(clinicId) });
  } catch (error) {
    reportServerError("api/admin/mcp-keys:GET", error);
    return NextResponse.json({ ok: false, error: "Could not load connection keys." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  const requested = typeof body.clinicId === "string" ? body.clinicId.trim() : undefined;
  // No `allowInactive` here, unlike the GET and the DELETE. Minting a key is issuing a new
  // standing grant, which is a write, and a lapsed clinic does not get to hand out fresh access.
  const authz = await requireStaffUser(request, requested);
  if (!authz.ok) return authz.response;

  const denied = denyWithoutSettings(authz.role, authz.permissions);
  if (denied) return denied;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requested);

    // Write access is a second, explicit decision. Anything other than the exact string "full"
    // — including a missing field, a typo, or a client that sends `true` — means read-only,
    // because the failure mode of guessing wrong in that direction is a deleted patient record.
    const scope: McpKeyScope = body.scope === "full" ? "full" : "read";

    const { record, secret } = await mintMcpKey({
      clinicId,
      uid: authz.uid,
      label: typeof body.label === "string" ? body.label : "",
      scope,
      createdByName: authz.name,
    });

    // The only time this value ever exists outside the caller's own memory. The screen must show
    // it once and then let it go; there is no endpoint that can return it again.
    return NextResponse.json({ ok: true, key: record, secret });
  } catch (error) {
    reportServerError("api/admin/mcp-keys:POST", error);
    return NextResponse.json({ ok: false, error: "Could not create the key." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("clinicId")?.trim() || undefined;
  const id = url.searchParams.get("id")?.trim() || "";

  const authz = await requireStaffUser(request, requested, { allowInactive: true });
  if (!authz.ok) return authz.response;

  const denied = denyWithoutSettings(authz.role, authz.permissions);
  if (denied) return denied;

  if (!id) return NextResponse.json({ ok: false, error: "Which key?" }, { status: 400 });

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requested);
    const revoked = await revokeMcpKey(clinicId, id);
    if (!revoked) {
      return NextResponse.json({ ok: false, error: "No such key at this clinic." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportServerError("api/admin/mcp-keys:DELETE", error);
    return NextResponse.json({ ok: false, error: "Could not revoke the key." }, { status: 500 });
  }
}
