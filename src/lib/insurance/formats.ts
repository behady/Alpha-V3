/**
 * One place that says, per insurer paper, which reader and which checks apply. The read route, the
 * claims route and the confirm card all ask here, so the three can never disagree about a format.
 * Pure: no SDK, no Firestore.
 */
import type { InsurerFormat } from "@/lib/payers";
import { buildMetlifePrompt, checkMetlife, METLIFE_RESPONSE_SCHEMA, normalizeMetlife, type Check, type MetlifeExtraction } from "./metlife";
import { buildNextcarePrompt, checkNextcare, fromNextcareModel, NEXTCARE_RESPONSE_SCHEMA, normalizeNextcare } from "./nextcare";
import { AXA_RESPONSE_SCHEMA, buildAxaPrompt, checkAxa, fromAxaModel, normalizeAxa } from "./axa";

export type ApprovalReader = {
  schema: Record<string, unknown>;
  prompt: () => string;
  /** The model's parsed JSON → the shared approval record. Never throws. */
  normalize: (parsed: unknown) => MetlifeExtraction;
};

export function readerFor(format: InsurerFormat): ApprovalReader {
  if (format === "axa") {
    return { schema: AXA_RESPONSE_SCHEMA, prompt: buildAxaPrompt, normalize: (p) => normalizeAxa(fromAxaModel(p)) };
  }
  if (format === "nextcare") {
    return { schema: NEXTCARE_RESPONSE_SCHEMA, prompt: buildNextcarePrompt, normalize: (p) => normalizeNextcare(fromNextcareModel(p)) };
  }
  return { schema: METLIFE_RESPONSE_SCHEMA, prompt: buildMetlifePrompt, normalize: normalizeMetlife };
}

export type ApprovalCheckContext = {
  today: string;
  /** MetLife only: the clinic's code with the insurer, printed on its approvals. */
  providerCode?: string;
  matchedPatientName?: string;
  nameScore?: number;
};

export function checkApproval(format: InsurerFormat, x: MetlifeExtraction, ctx: ApprovalCheckContext): Check[] {
  if (format === "axa") {
    return checkAxa(x, { today: ctx.today, matchedPatientName: ctx.matchedPatientName, nameScore: ctx.nameScore });
  }
  if (format === "nextcare") {
    return checkNextcare(x, { today: ctx.today, matchedPatientName: ctx.matchedPatientName, nameScore: ctx.nameScore });
  }
  return checkMetlife(x, ctx);
}

/**
 * Finding the patient again: MetLife needs certificate AND dependent code to be sure; a NextCare or
 * AXA card number belongs to one person, so the card alone is enough.
 */
export function cardIdentifiesPatient(format: InsurerFormat): boolean {
  return format === "nextcare" || format === "axa";
}

/** Papers whose service lines name their teeth (the confirm card shows a teeth box per line). */
export function linesHaveTeeth(format: InsurerFormat): boolean {
  return format === "nextcare" || format === "axa";
}
