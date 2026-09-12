import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import {
  isStoreUsable,
  loadSupplyStoreConfig,
  saveSupplyStoreConfig,
  wooRequest,
  type SupplyStoreConfig,
} from "@/lib/server/wooClient";
import { normalizeStoreUrl } from "@/lib/supplyStore";

/**
 * The partner shop's connection, and the platform's cut of it.
 *
 * SUPERADMIN ONLY, and there is deliberately no clinic-scoped version. Two of the fields here are
 * things a clinic must never learn: the WooCommerce credential (which would open the partner's
 * whole shop, including his other customers) and `commissionPercent` (which is the platform's
 * margin — see the CostsTab route for the same rule applied to WhatsApp).
 *
 * The secret is never echoed back. GET says whether one is stored and nothing more, which is the
 * same discipline the Meta WhatsApp token follows: a value that is only ever written cannot leak
 * through a screenshot, a browser cache or a support session.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const config = await loadSupplyStoreConfig();
    return NextResponse.json({
      ok: true,
      enabled: config.enabled,
      storeUrl: config.storeUrl,
      storeName: config.storeName,
      currency: config.currency,
      commissionPercent: config.commissionPercent,
      deliveryNote: config.deliveryNote,
      consumerKeyPreview: config.consumerKey ? `${config.consumerKey.slice(0, 8)}…` : "",
      secretSet: config.consumerSecret.length > 0,
      usable: isStoreUsable(config),
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the store connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      storeUrl?: string;
      storeName?: string;
      currency?: string;
      commissionPercent?: number;
      deliveryNote?: string;
      consumerKey?: string;
      consumerSecret?: string;
      /** Ask the shop for one product after saving, to prove the credentials actually work. */
      test?: boolean;
    };

    const patch: Partial<SupplyStoreConfig> = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    if (typeof body.storeUrl === "string" && body.storeUrl.trim()) {
      const normalized = normalizeStoreUrl(body.storeUrl);
      if (!normalized) {
        return NextResponse.json({ ok: false, error: "That does not look like a website address." }, { status: 400 });
      }
      patch.storeUrl = normalized;
    }

    if (typeof body.storeName === "string") patch.storeName = body.storeName.trim().slice(0, 80);
    if (typeof body.currency === "string" && body.currency.trim()) {
      patch.currency = body.currency.trim().toUpperCase().slice(0, 8);
    }
    if (typeof body.deliveryNote === "string") patch.deliveryNote = body.deliveryNote.trim().slice(0, 500);

    if (body.commissionPercent !== undefined) {
      const rate = Number(body.commissionPercent);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return NextResponse.json({ ok: false, error: "Commission must be between 0 and 100." }, { status: 400 });
      }
      patch.commissionPercent = Math.round(rate * 100) / 100;
    }

    // Blank means "leave what is stored". Only a non-empty string replaces a credential, so
    // saving the commission rate cannot wipe the key by submitting an untouched empty field.
    if (typeof body.consumerKey === "string" && body.consumerKey.trim()) {
      patch.consumerKey = body.consumerKey.trim();
    }
    if (typeof body.consumerSecret === "string" && body.consumerSecret.trim()) {
      patch.consumerSecret = body.consumerSecret.trim();
    }

    await saveSupplyStoreConfig(patch);
    const config = await loadSupplyStoreConfig();

    let testResult: { ok: boolean; message: string; sampleProduct?: string } | undefined;
    if (body.test) {
      if (!isStoreUsable(config)) {
        testResult = { ok: false, message: "Fill in the address, key and secret, and switch the store on, then test." };
      } else {
        const probe = await wooRequest<unknown[]>(config, "products", { params: { per_page: 1, status: "publish" } });
        if (probe.ok) {
          const first = Array.isArray(probe.data) && probe.data[0] && typeof probe.data[0] === "object"
            ? String((probe.data[0] as Record<string, unknown>).name ?? "")
            : "";
          testResult = {
            ok: true,
            message: first ? "Connected. Products are readable." : "Connected, but the shop returned no published products.",
            sampleProduct: first || undefined,
          };
        } else {
          // The superadmin IS the person who can fix this, so unlike the clinic-facing routes the
          // real reason is shown rather than softened into "contact support".
          console.error("supply store test failed", probe.status, probe.code, probe.detail);
          testResult = { ok: false, message: `${probe.status} ${probe.code || ""} ${probe.detail}`.trim() };
        }
      }
    }

    return NextResponse.json({
      ok: true,
      enabled: config.enabled,
      storeUrl: config.storeUrl,
      storeName: config.storeName,
      currency: config.currency,
      commissionPercent: config.commissionPercent,
      deliveryNote: config.deliveryNote,
      consumerKeyPreview: config.consumerKey ? `${config.consumerKey.slice(0, 8)}…` : "",
      secretSet: config.consumerSecret.length > 0,
      usable: isStoreUsable(config),
      test: testResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the store connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
