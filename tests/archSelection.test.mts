/**
 * Arch / full-mouth ticks on the teeth chart, and the teeth that are no longer there.
 * Run: npm run test:arch
 */
import assert from "node:assert/strict";
import { isArchPicked, missingInArch, missingTeeth, toggleArch, UPPER_ARCH, LOWER_ARCH } from "../src/lib/archSelection";
import type { ToothTreatment } from "../src/lib/toothTreatments";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks += 1; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks += 1; };

// What counts as gone: a missing diagnosis (new or legacy shape), a congenital absence, or an
// extraction nothing replaced. A planned extraction is not a gap; an implant after one is a tooth.
{
  const extraction = (date: string, status = "Completed") => ({ state: "extracted", status, date }) as unknown as ToothTreatment;
  const implant = (date: string) => ({ state: "implant", status: "Completed", date }) as unknown as ToothTreatment;
  const gone = missingTeeth(
    { "16": { statuses: ["surg_missing"] }, "26": "surg_missing", "38": { statuses: ["dev_hypodontia"] }, "11": { statuses: ["caries_occlusal"] } },
    { "36": [extraction("2026-01-01")], "46": [extraction("2026-01-01"), implant("2026-05-01")], "47": [extraction("2026-01-01", "Planned")] }
  );
  eq([...gone].sort(), ["16", "26", "36", "38"], "diagnosis, legacy string, congenital and done extraction count; implant and planned do not");
  eq(missingInArch("lower", gone), ["36", "38"], "the lower arch's gaps, in chart order");
  eq(missingInArch("full", gone), ["16", "26", "36", "38"], "the whole mouth's gaps");
}

// Ticking an arch.
{
  const none = new Set<string>();
  eq(toggleArch([], "upper", none, false), UPPER_ARCH, "an intact upper arch is its 16 teeth");
  eq(toggleArch([], "full", none, false).length, 32, "the full mouth is 32");
  const gone = new Set(["16", "36"]);
  const upperOut = toggleArch([], "upper", gone, false);
  eq(upperOut.length, 15, "leaving the gap out: 15 teeth");
  ok(!upperOut.includes("16"), "16 is not counted");
  ok(isArchPicked(upperOut, "upper", gone), "and the arch still shows as ticked");
  const upperIn = toggleArch([], "upper", gone, true);
  eq(upperIn.length, 16, "counting the gap: 16 teeth");
  ok(isArchPicked(upperIn, "upper", gone), "ticked that way too");
  eq(toggleArch(upperIn, "upper", gone, false), [], "ticking again clears the arch, gap included");
  const mixed = toggleArch(["16", "45"], "upper", gone, false);
  ok(!mixed.includes("16") && mixed.includes("45"), "a gap picked by hand is dropped when the arch is taken without gaps; other arches' teeth stay");
  ok(isArchPicked(toggleArch([], "full", gone, false), "lower", gone), "the full mouth ticks the lower arch too");
  ok(!isArchPicked(["11"], "upper", none), "one tooth is not an arch");
  eq(toggleArch(toggleArch([], "upper", none, false), "lower", none, false).length, UPPER_ARCH.length + LOWER_ARCH.length, "both arches = the mouth");
}

console.log(`arch selection: ${checks} checks passed`);
