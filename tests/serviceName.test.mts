/**
 * Bilingual treatment names: the Arabic name shows to Arabic users, the English stays underneath,
 * and pricing matches a treatment by either.
 * Run: npm run test:service-name
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serviceDisplayName, serviceMatchesName } from "../src/lib/serviceName";
import { computeProcedurePricing } from "../src/lib/procedurePricing";

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks += 1; };
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks += 1; };

const s = { name: "Zirconia Crown", nameAr: "طربوش زركون" };
eq(serviceDisplayName(s, true), "طربوش زركون", "Arabic UI shows the Arabic name");
eq(serviceDisplayName(s, false), "Zirconia Crown", "English UI shows the English name");
eq(serviceDisplayName({ name: "Consultation", nameAr: "  " }, true), "Consultation", "a blank Arabic name falls back to the English");
eq(serviceDisplayName({ name: "كشف" }, true), "كشف", "a treatment named in Arabic only is itself");

ok(serviceMatchesName(s, "طربوش زركون"), "matches the Arabic name");
ok(serviceMatchesName(s, "Zirconia Crown "), "matches the English name, whitespace ignored");
ok(!serviceMatchesName(s, "Crown"), "no partial matches");

// The server prices a treatment saved under its Arabic name from the same catalogue row.
{
  const services = [{ id: "a", name: "Zirconia Crown", nameAr: "طربوش زركون", price: 5000, pricingMode: "per_tooth" }];
  const p = computeProcedurePricing({ procedures: ["طربوش زركون"], services, selectedTeeth: ["16", "17"], unitCost: null, priceListId: null } as never);
  eq([p.serviceIds, p.cost], [["a"], 10000], "priced from the row, two teeth");
}

// Every screen that loads services by a hand-picked field list must carry the Arabic name too.
{
  const read = (rel: string) => readFileSync(join(import.meta.dirname, "..", rel), "utf8");
  for (const rel of ["src/components/dashboard/DesktopDashboard.tsx", "src/components/dashboard/MobileDashboard.tsx", "src/app/(dashboard)/appointments/page.tsx"]) {
    ok(/nameAr: d\.data\(\)\.nameAr/.test(read(rel)), `${rel} loads each service's Arabic name`);
  }
}

console.log(`service name: ${checks} checks passed`);
