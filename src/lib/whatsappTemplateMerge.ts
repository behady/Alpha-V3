/** Replace `{{key}}` placeholders in a template string (case-sensitive keys). */
export function mergeWhatsAppTemplate(template: string, vars: Record<string, string | number | undefined | null>): string {
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    const safe = val === undefined || val === null ? "" : String(val);
    out = out.split(`{{${key}}}`).join(safe);
  }
  return out;
}
