import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { loadSupplyStoreConfig, wooRequest } from "@/lib/server/wooClient";
import {
  buildWooOrderPayload,
  cartTotals,
  commissionFor,
  couponCodesFor,
  friendlyStoreError,
  mapWooOrder,
  validateOrderDraft,
  type CartLine,
  type OrderContact,
} from "@/lib/supplyStore";

/**
 * A clinic's supply orders: list them, and place one.
 *
 * Placing an order is the only write in this feature, and it deliberately happens here rather
 * than in the browser. Three things have to be true at once and only a server can hold all three:
 * the WooCommerce credential (which a clinic must never see), the commission rate (which a clinic
 * must never see either), and the clinic's own order record. Doing it in the browser would mean
 * publishing the first two to do the third.
 *
 * Money never moves through Alpha. The order is created unpaid, cash on delivery, and the partner
 * collects at the door — see buildWooOrderPayload.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDERS_SUBCOLLECTION = "supply_orders";

/**
 * The platform's cut, one document per order, in a root collection firestore.rules denies to
 * everybody. It is not a field on the clinic's order for the same reason the WhatsApp supplier
 * invoice is not a field on a clinic's message: a number that exists on a document the clinic can
 * read is a number the clinic will eventually read.
 */
const COMMISSION_COLLECTION = "supply_commissions";

/** Statuses still worth re-checking with the shop. A delivered order will not change again. */
const OPEN_STATUSES = new Set(["pending", "processing", "on-hold"]);

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinic = url.searchParams.get("clinicId") || "";

  const staff = await requireStaffPermission(request, requestedClinic || undefined, "access.store", {
    allowInactive: true,
  });
  if (!staff.ok) return staff.response;

  try {
    const clinicId = await resolveUserClinicId(staff.uid, requestedClinic);
    const db = adminDb();
    const snap = await db
      .collection("clinics")
      .doc(clinicId)
      .collection(ORDERS_SUBCOLLECTION)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    /**
     * Refresh the ones that could still have moved.
     *
     * The partner marks an order processing or completed in his own WordPress admin; nothing
     * pushes that back to us, and asking him to install a webhook plugin to make our screen
     * correct is not a reasonable thing to ask of someone doing us a favour. So we pull, and only
     * for orders that are still open — one call, batched with `include`.
     */
    const openIds = orders
      .filter((o) => OPEN_STATUSES.has(text((o as Record<string, unknown>).status)))
      .map((o) => Number((o as Record<string, unknown>).wooOrderId))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 20);

    if (openIds.length > 0) {
      const config = await loadSupplyStoreConfig();
      const fresh = await wooRequest<unknown[]>(config, "orders", {
        params: { include: openIds.join(","), per_page: openIds.length },
      });

      if (fresh.ok && Array.isArray(fresh.data)) {
        const byId = new Map<number, { status: string; total: number }>();
        for (const raw of fresh.data) {
          const mapped = mapWooOrder(raw);
          if (mapped) byId.set(mapped.wooOrderId, { status: mapped.status, total: mapped.total });
        }

        const writes = db.batch();
        let changed = 0;
        for (const order of orders) {
          const row = order as Record<string, unknown>;
          const latest = byId.get(Number(row.wooOrderId));
          if (!latest || latest.status === row.status) continue;
          row.status = latest.status;
          row.total = latest.total;
          changed += 1;
          writes.update(
            db.collection("clinics").doc(clinicId).collection(ORDERS_SUBCOLLECTION).doc(String(row.id)),
            { status: latest.status, total: latest.total, updatedAt: new Date().toISOString() }
          );
          // The commission row tracks status too: a cancelled order must stop counting towards
          // what the partner owes, and summariseCommission decides that from this field.
          writes.set(
            db.collection(COMMISSION_COLLECTION).doc(String(row.wooOrderId)),
            { status: latest.status, orderTotal: latest.total },
            { merge: true }
          );
        }
        if (changed > 0) await writes.commit();
      } else if (!fresh.ok) {
        // A shop that is down should not empty this screen — the stored orders are still true.
        console.error("supply order refresh failed", fresh.status, fresh.code, fresh.detail);
      }
    }

    return NextResponse.json({ ok: true, orders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your orders";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    lines?: CartLine[];
    contact?: OrderContact;
    /** A code the clinic typed at checkout. The members' code is added here, not by the browser. */
    coupon?: string;
    lang?: string;
  };

  // store.order, and no expiry exemption: this one spends money in the clinic's name, so a lapsed
  // subscription stops it exactly as it stops every other write. tests/permissions.test.mts counts
  // the exemptions in this file and expects exactly the one on the GET above.
  const staff = await requireStaffPermission(request, body.clinicId || undefined, "store.order");
  if (!staff.ok) return staff.response;

  const language = body.lang === "ar" ? "ar" : "en";

  try {
    const clinicId = await resolveUserClinicId(staff.uid, body.clinicId || "");
    const draft = { lines: Array.isArray(body.lines) ? body.lines : [], contact: body.contact as OrderContact };

    const valid = validateOrderDraft(draft);
    if (!valid.ok) return NextResponse.json({ ok: false, error: valid.error }, { status: 400 });

    const config = await loadSupplyStoreConfig();

    /**
     * Our own reference, written onto the WooCommerce order before we know its id.
     *
     * It exists for the one failure that has no clean recovery: the shop creates the order and
     * the reply never reaches us (a timeout, a cold lambda). The clinic sees an error and the
     * partner sees an order. Searching his admin for this ref is how the two get reconciled, and
     * it is why the ref is generated before the call rather than derived from the response.
     */
    const ref = `ALP-${clinicId.slice(0, 6)}-${Date.now().toString(36).toUpperCase()}`;
    const couponCodes = couponCodesFor(config.memberCoupon, body.coupon || "");
    const payload = buildWooOrderPayload(draft, { clinicId, ref, couponCodes });

    const created = await wooRequest<Record<string, unknown>>(config, "orders", {
      method: "POST",
      body: payload,
      timeoutMs: 25_000,
    });

    if (!created.ok || !created.data) {
      console.error("supply order create failed", ref, created.status, created.code, created.detail);
      return NextResponse.json(
        { ok: false, error: friendlyStoreError(created.status, created.code, language), ref },
        { status: created.status === 503 ? 503 : 502 }
      );
    }

    const wooOrder = mapWooOrder(created.data);
    if (!wooOrder) {
      console.error("supply order create returned an unreadable order", ref, JSON.stringify(created.data).slice(0, 300));
      return NextResponse.json({ ok: false, error: friendlyStoreError(502, "", language), ref }, { status: 502 });
    }

    const db = adminDb();
    const now = new Date().toISOString();
    // Trust WooCommerce's total over our own arithmetic — it priced the lines, applied whatever
    // tax and shipping the shop charges, and it is what the driver will ask for at the door. Our
    // subtotal is kept only so a clinic can see the order it thought it was placing.
    const ourSubtotal = cartTotals(draft.lines).subtotal;

    const record = {
      wooOrderId: wooOrder.wooOrderId,
      number: wooOrder.number,
      ref,
      status: wooOrder.status,
      currency: wooOrder.currency || config.currency,
      total: wooOrder.total,
      subtotal: ourSubtotal,
      lines: draft.lines.map((line) => ({
        productId: Number(line.productId),
        name: text(line.name),
        sku: text(line.sku),
        unitPrice: Number(line.unitPrice) || 0,
        qty: Math.floor(Number(line.qty)) || 0,
        imageUrl: text(line.imageUrl),
      })),
      contact: {
        clinicName: draft.contact.clinicName.trim(),
        phone: draft.contact.phone.trim(),
        address: draft.contact.address.trim(),
        city: (draft.contact.city || "").trim(),
        email: (draft.contact.email || "").trim(),
        notes: (draft.contact.notes || "").trim(),
      },
      placedByUid: staff.uid,
      placedByName: staff.name,
      paymentMethod: "cod",
      // What the clinic can see: that a discount was applied and, if they typed one, which. The
      // members' code is deliberately absent from the record for the same reason it is absent
      // from the status route.
      membersDiscountApplied: config.memberCoupon.trim().length > 0,
      typedCoupon: (body.coupon || "").trim().toLowerCase().slice(0, 60),
      // What the coupons took off, as his shop calculated it.
      discount: wooOrder.discountTotal,
      createdAt: now,
      updatedAt: now,
    };

    const orderRef = db.collection("clinics").doc(clinicId).collection(ORDERS_SUBCOLLECTION).doc();

    // The clinic's copy and the platform's copy are written together. If the commission row were
    // written separately and that write failed, we would have delivered a sale to the partner
    // with no record that it was ours — which is the whole arrangement.
    const batch = db.batch();
    batch.set(orderRef, record);
    batch.set(db.collection(COMMISSION_COLLECTION).doc(String(wooOrder.wooOrderId)), {
      wooOrderId: wooOrder.wooOrderId,
      orderRef: ref,
      clinicId,
      clinicName: record.contact.clinicName,
      placedAt: now,
      status: wooOrder.status,
      orderTotal: wooOrder.total,
      // Frozen. Changing the rate later must not rewrite what an order already earned.
      ratePercent: config.commissionPercent,
      commission: commissionFor(wooOrder.total, config.commissionPercent),
      currency: wooOrder.currency || config.currency,
    });
    await batch.commit();

    return NextResponse.json({
      ok: true,
      order: { id: orderRef.id, ...record },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The order could not be placed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
