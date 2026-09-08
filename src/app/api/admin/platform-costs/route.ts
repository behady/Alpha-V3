import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAiCreditLimit } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import { costOfTokens, marginFor, platformTotals, rankByCost, type ClinicCostRow } from "@/lib/platformCost";
import { EMPTY_CATEGORY_COUNTS, estimateMonthUsd, type MessageCategory } from "@/lib/whatsappCost";
import { fetchMetaBilledForMonth } from "@/lib/whatsappCostLog";
import { DEFAULT_USD_TO_EGP } from "@/lib/whatsappCost";

/**
 * What every clinic costs the platform this month, against what it pays.
 *
 * SUPERADMIN ONLY, and deliberately so. A clinic is sold credits and a plan price; the supplier
 * invoices behind them are the platform's business and never travel to a clinic's browser. There
 * is no clinic-scoped version of this route on purpose — the earlier one was deleted rather than
 * gated, because a route that merely checks a role is one refactor away from leaking.
 *
 * Reads only: monthly `ai_usage` counters, monthly `whatsapp_cost` counters, and Meta's own
 * `pricing_analytics` per WABA. Writes nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What a clinic pays us per month, in EGP, normalised across billing cycles. */
function monthlyRevenueEgp(clinic: Clinic): number {
  if (clinic.status !== "Active") return 0;
  const cycle = clinic.billingCycle || "Monthly";
  if (clinic.customPrice !== undefined && clinic.customPrice !== null) {
    const price = Number(clinic.customPrice) || 0;
    return cycle === "2-Yearly" ? price / 24 : cycle === "Yearly" ? price / 12 : price;
  }
  const listed: Record<string, number> = { Basic: 50, Pro: 150, Premium: 300 };
  return listed[String(clinic.subscriptionTier || "")] ?? 0;
}

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const url = new URL(request.url);
    const requested = String(url.searchParams.get("month") || "").trim();
    const monthKey = /^\d{4}-\d{2}$/.test(requested) ? requested : new Date().toISOString().slice(0, 7);
    const usdToEgp = Number(url.searchParams.get("rate")) || DEFAULT_USD_TO_EGP;
    const asOf = new Date(`${monthKey}-15T00:00:00Z`);

    const db = adminDb();
    const clinicsSnap = await db.collection("clinics").get();

    const rows: ClinicCostRow[] = await Promise.all(
      clinicsSnap.docs.map(async (doc) => {
        const clinic = { id: doc.id, ...doc.data() } as Clinic;

        const [usageSnap, waSnap, metaBilled] = await Promise.all([
          doc.ref.collection("ai_usage").doc(monthKey).get().catch(() => null),
          doc.ref.collection("whatsapp_cost").doc(monthKey).get().catch(() => null),
          fetchMetaBilledForMonth(doc.id, monthKey).catch(() => null),
        ]);

        const usage = usageSnap?.data() || {};
        /*
         * Priced per MODEL, not from one blended rate. Super mode runs on Pro, which costs several
         * times Flash for the same tokens, so a clinic that leans on it looks cheap under a
         * blended figure and is exactly the clinic worth finding.
         */
        let aiCostUsd = 0;
        const aiMeasuredCalls = Number((usage.tokens as Record<string, unknown> | undefined)?.apiCalls) || 0;
        for (const [modelKey, bundle] of Object.entries((usage.byModel || {}) as Record<string, Record<string, unknown>>)) {
          aiCostUsd += costOfTokens(
            modelKey.replace(/_/g, "."),
            {
              input: Number(bundle.input) || 0,
              output: Number(bundle.output) || 0,
              thoughts: Number(bundle.thoughts) || 0,
              cached: Number(bundle.cached) || 0,
            },
            asOf
          );
        }

        const sentByCategory: Record<MessageCategory, number> = { ...EMPTY_CATEGORY_COUNTS };
        for (const [k, v] of Object.entries((waSnap?.data()?.sentByCategory || {}) as Record<string, unknown>)) {
          if (k in sentByCategory) sentByCategory[k as MessageCategory] = Number(v) || 0;
        }

        return {
          clinicId: doc.id,
          clinicName: String(clinic.name || doc.id),
          tier: String(clinic.subscriptionTier || "—"),
          status: String(clinic.status || "—"),
          monthlyRevenueEgp: Math.round(monthlyRevenueEgp(clinic) * 100) / 100,
          creditsUsed: Number(usage.creditsUsed) || 0,
          creditLimit: getAiCreditLimit(clinic),
          aiCostUsd: Math.round(aiCostUsd * 1_000_000) / 1_000_000,
          aiMeasuredCalls,
          whatsappBilledUsd: metaBilled?.billedUsd ?? null,
          sentByCategory,
          whatsappEstimateUsd: estimateMonthUsd(sentByCategory),
        };
      })
    );

    const margins = rankByCost(rows.map((r) => marginFor(r, usdToEgp)));
    return NextResponse.json({
      ok: true,
      monthKey,
      usdToEgp,
      totals: platformTotals(margins),
      clinics: margins,
    });
  } catch (e) {
    console.error("platform-costs failed", e);
    return NextResponse.json({ ok: false, error: "Failed to load platform costs" }, { status: 500 });
  }
}
