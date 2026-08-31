/**
 * The statement you settle a lab against.
 *
 * A lab's own book reads as one column: "you took these six crowns, you paid me twice in between,
 * this is what is left." So this interleaves deliveries and payments by date with a running
 * balance, rather than printing two lists neither side can reconcile against the other.
 *
 * Firebase-free, like `labOrderHtml.ts`, so the arithmetic on a page somebody argues over can be
 * checked without a browser. The print driver in `labOrderPrint.ts` renders it.
 *
 * One line on this page is not decoration: cases delivered with no agreed price are counted and
 * named. They are the single most likely reason this total and the lab's invoice disagree, and
 * without saying so the difference reads as an arithmetic error rather than a gap in what the
 * clinic recorded.
 */

import type { LabAccount, StatementLine } from "@/lib/labAccounts";

const INK = "#14171A";
const MUTED = "#6A716F";
const RULE = "#D9DCD8";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}

function fmtDate(iso: string, language: "en" | "ar"): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type LabStatementPayload = {
  clinicName: string;
  clinicPhone: string;
  account: LabAccount;
  lines: Array<StatementLine & { balance: number }>;
  closing: number;
  /** Delivered cases carrying no agreed price — why a total can disagree with the lab's invoice. */
  unpricedCount: number;
  from?: string;
  to?: string;
  generatedOn: string;
  language: "en" | "ar";
};

export function buildLabStatementSrcDoc(p: LabStatementPayload): string {
  const isAr = p.language === "ar";
  const bi = (en: string, ar: string) => (isAr ? `${ar} · ${en}` : `${en} · ${ar}`);

  const rows = p.lines
    .map(
      (l) => `<tr>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;white-space:nowrap;">${esc(fmtDate(l.date, p.language))}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;font-weight:600;white-space:nowrap;" dir="ltr">${esc(l.code || "—")}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;">${esc(l.patient)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;color:${MUTED};">${esc(l.work)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;text-align:right;white-space:nowrap;">${l.charge ? money(l.charge) : ""}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;text-align:right;white-space:nowrap;color:#2F6B4F;">${l.payment ? `(${money(l.payment)})` : ""}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #F0F2EE;font-size:8.5pt;text-align:right;font-weight:700;white-space:nowrap;">${money(l.balance)}</td>
    </tr>`
    )
    .join("");

  const empty = `<tr><td colspan="7" style="padding:24px;text-align:center;color:${MUTED};font-size:9pt;">${esc(
    bi("Nothing delivered or paid in this period.", "مفيش تسليم ولا دفع في الفترة دي.")
  )}</td></tr>`;

  const period =
    p.from || p.to
      ? `${esc(fmtDate(p.from || "", p.language))} — ${esc(fmtDate(p.to || "", p.language))}`
      : esc(bi("All time", "من البداية"));

  return `<!DOCTYPE html>
<html lang="${isAr ? "ar" : "en"}" dir="${isAr ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<title>${esc(p.account.labName)} — statement</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Tajawal, 'Segoe UI', Arial, sans-serif; color:${INK}; }
  .sheet { min-height: 297mm; padding: 14mm; }
  table { border-collapse: collapse; width: 100%; }
</style>
</head>
<body><div class="sheet">

  <table style="border-bottom:2px solid ${INK};padding-bottom:8px;">
    <tr>
      <td style="vertical-align:top;">
        <div style="font-size:14pt;font-weight:800;line-height:1.1;">${esc(p.clinicName || "—")}</div>
        <div style="font-size:7pt;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-top:3px;">${esc(p.clinicPhone)}</div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:11pt;font-weight:800;">${esc(bi("Lab statement", "كشف حساب معمل"))}</div>
        <div style="font-size:12pt;font-weight:700;margin-top:2px;">${esc(p.account.labName)}</div>
        <div style="font-size:7.5pt;color:${MUTED};margin-top:3px;">${period}</div>
      </td>
    </tr>
  </table>

  <table style="margin-top:10px;border-bottom:1px solid ${RULE};">
    <tr>
      ${[
        [bi("Delivered", "المسلّم"), `${money(p.account.delivered)} EGP`, `${p.account.deliveredCount}`],
        [bi("Paid", "المدفوع"), `${money(p.account.paid)} EGP`, ""],
        [bi("Outstanding", "المتبقي"), `${money(p.account.outstanding)} EGP`, ""],
        [bi("Still at the lab", "لسه في المعمل"), `${money(p.account.committed)} EGP`, `${p.account.committedCount}`],
      ]
        .map(
          ([label, value, count]) => `<td style="padding:8px 10px 8px 0;vertical-align:top;border-right:1px solid #EDEFEB;">
          <div style="font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};">${esc(label)}</div>
          <div style="font-size:12pt;font-weight:800;margin-top:2px;">${esc(value)}</div>
          ${count ? `<div style="font-size:7pt;color:${MUTED};">${esc(count)} ${esc(bi("cases", "حالة"))}</div>` : ""}
        </td>`
        )
        .join("")}
    </tr>
  </table>

  <table style="margin-top:12px;">
    <thead>
      <tr>
        ${[
          bi("Date", "التاريخ"),
          bi("Code", "الكود"),
          bi("Patient", "المريض"),
          bi("Work", "الشغل"),
          bi("Charge", "عليه"),
          bi("Paid", "له"),
          bi("Balance", "الرصيد"),
        ]
          .map(
            (h, i) => `<th style="padding:5px 6px;border-bottom:1px solid ${INK};font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};font-weight:400;text-align:${i >= 4 ? "right" : "left"};white-space:nowrap;">${esc(h)}</th>`
          )
          .join("")}
      </tr>
    </thead>
    <tbody>${rows || empty}</tbody>
  </table>

  <table style="margin-top:10px;border-top:2px solid ${INK};">
    <tr>
      <td style="padding:8px 6px;font-size:10pt;font-weight:800;">${esc(bi("Balance owed", "الرصيد المستحق"))}</td>
      <td style="padding:8px 6px;font-size:14pt;font-weight:800;text-align:right;">${money(p.closing)} EGP</td>
    </tr>
  </table>

  ${
    p.unpricedCount > 0
      ? `<div style="margin-top:10px;padding:7px 10px;border:1px solid #E3C98F;background:#FBF4E4;font-size:8pt;color:#7A5A10;line-height:1.4;">
          ${esc(
            isAr
              ? `${p.unpricedCount} حالة مسلّمة من غير سعر متفق عليه، فمش داخلة في الإجمالي فوق. ده أغلب سبب اختلاف الرقم ده عن فاتورة المعمل.`
              : `${p.unpricedCount} delivered case(s) carry no agreed price and are therefore NOT in the total above. This is the most likely reason this figure differs from the lab's own invoice.`
          )}
        </div>`
      : ""
  }

  <table style="margin-top:22px;">
    <tr>
      ${["Clinic|العيادة", "Lab|المعمل"]
        .map((pair) => {
          const [en, ar] = pair.split("|");
          return `<td style="width:50%;padding-right:16px;vertical-align:bottom;">
            <div style="border-bottom:1px solid ${INK};height:22px;"></div>
            <div style="font-size:6.5pt;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-top:3px;">${en} · ${ar}</div>
          </td>`;
        })
        .join("")}
    </tr>
  </table>

  <div style="margin-top:14px;font-size:7pt;color:${MUTED};">
    ${esc(bi("Generated", "اتطبع"))} ${esc(fmtDate(p.generatedOn, p.language))}
  </div>

</div></body>
</html>`;
}
