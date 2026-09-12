import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { loadSupplyStoreConfig, isStoreUsable } from "@/lib/server/wooClient";

/**
 * Is there a supply store to show this clinic, and what is it called?
 *
 * The rail asks this before drawing the Store item. A link to a shop that is not connected is
 * worse than no link: it reads as a broken feature rather than one that has not been switched on.
 *
 * Answers with the shop's NAME and nothing else — not its URL, not its currency source, and
 * certainly not the commission. The clinic is being shown a catalogue, not introduced to a
 * supplier relationship it can go around us to reach.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // allowInactive: this is a read, and a lapsed clinic keeps its reads. It cannot order — the
  // POST in ../orders has no such exemption — but the rail should not flicker on renewal day.
  const staff = await requireStaffUser(request, undefined, { allowInactive: true });
  if (!staff.ok) return staff.response;

  try {
    const config = await loadSupplyStoreConfig();
    return NextResponse.json({
      ok: true,
      connected: isStoreUsable(config),
      storeName: config.storeName,
      currency: config.currency,
      deliveryNote: config.deliveryNote,
    });
  } catch (error) {
    console.error("supply store status failed", error);
    // A store we cannot ask about is a store the clinic does not see. Failing closed here keeps a
    // Firestore hiccup from putting a dead shop link in the rail.
    return NextResponse.json({ ok: true, connected: false, storeName: "", currency: "EGP", deliveryNote: "" });
  }
}
