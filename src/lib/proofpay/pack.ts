import { money, netClaimable } from "./engine";
import { DISCLAIMER } from "./seed";
import type { Assessment, CaseRecord } from "./types";

export interface PackSection {
  title: string;
  rows?: { label: string; value: string }[];
  body?: string;
  list?: string[];
}

export function buildAcceptancePack(c: CaseRecord, a: Assessment): PackSection[] {
  const q = c.quantities;
  const unsupported =
    q.accepted !== undefined && q.invoiced !== undefined && q.invoiced > q.accepted
      ? q.invoiced - q.accepted
      : 0;

  return [
    {
      title: "Executive summary",
      body: a.headline,
    },
    {
      title: "Transaction details",
      rows: [
        { label: "Case", value: c.code },
        { label: "Supplier", value: `${c.supplier} (${c.supplierGSTIN})` },
        { label: "Buyer", value: `${c.buyer} (${c.buyerGSTIN})` },
        { label: "Purchase order", value: `${c.poNumber} dated ${c.dates.po}` },
        { label: "Invoice", value: `${c.invoiceNumber} dated ${c.dates.invoice}` },
        { label: "Invoice total", value: money(c.invoiceTotal) },
        { label: "Net claimable (after payments, credit note, TDS, retention)", value: money(netClaimable(c)) },
        { label: "Payment terms", value: "45 days from acceptance" },
      ],
    },
    {
      title: "Quantity summary",
      rows: [
        { label: "Ordered (PO)", value: q.po === undefined ? "Not available" : `${q.po} NOS` },
        { label: "Delivered", value: q.delivered === undefined ? "Not available" : `${q.delivered} NOS` },
        { label: "Accepted (GRN)", value: q.accepted === undefined ? "Not available" : `${q.accepted} NOS` },
        { label: "Invoiced", value: q.invoiced === undefined ? "Not available" : `${q.invoiced} NOS` },
        { label: "Unsupported by acceptance", value: unsupported ? `${unsupported} NOS` : "None" },
      ],
    },
    {
      title: "Reconciliation matrix",
      list: a.reconciliation.map((r) => `${r.pair}: ${r.result} — ${r.detail}`),
    },
    {
      title: "Evidence index",
      list: c.documents.map(
        (d) => `${d.fileName} — ${d.type.replace(/_/g, " ").toLowerCase()} — ${d.facts.length} source-linked facts`,
      ),
    },
    {
      title: "Open issues",
      list: a.issues.length
        ? a.issues.map((i) => `[${i.severity}] ${i.title} → ${i.recommendedAction}`)
        : ["No open issues detected."],
    },
    {
      title: "Clarification required",
      body: unsupported
        ? `Written confirmation or acceptance evidence is required for ${unsupported} units before full payment is pursued.`
        : a.issues.length
          ? "Resolve the open items listed above before requesting acceptance."
          : "No clarification is outstanding.",
    },
    {
      title: "Audit metadata",
      rows: [
        { label: "Readiness score", value: `${a.readinessScore}/100` },
        { label: "Readiness status", value: a.readinessStatus.replace(/_/g, " ") },
        { label: "Decision", value: a.decision.replace(/_/g, " ") },
        { label: "Rule engine version", value: "1.0.0" },
        { label: "Assessment basis", value: "Deterministic reconciliation code (no model arithmetic)" },
      ],
    },
    { title: "Important notice", body: DISCLAIMER },
  ];
}

/**
 * Deterministic, neutral clarification draft. Values come from computed facts,
 * never from model arithmetic. Language is never threatening and never claims
 * a legal entitlement.
 */
export function draftClarification(c: CaseRecord, a: Assessment): string {
  const q = c.quantities;
  const unsupported =
    q.accepted !== undefined && q.invoiced !== undefined && q.invoiced > q.accepted
      ? q.invoiced - q.accepted
      : 0;

  const lines: string[] = [];
  lines.push(`Subject: Clarification on acceptance records for invoice ${c.invoiceNumber} (${c.poNumber})`);
  lines.push("");
  lines.push(`Dear ${c.buyer} team,`);
  lines.push("");
  lines.push(
    `We are reviewing the documentation for purchase order ${c.poNumber} and invoice ${c.invoiceNumber} dated ${c.dates.invoice}, and would like to confirm a few details with you before proceeding.`,
  );
  lines.push("");

  if (unsupported) {
    lines.push(
      `Our records show ${q.delivered} units delivered on ${c.dates.delivery}, and goods receipt note acceptance for ${q.accepted} units. The invoice covers ${q.invoiced} units, which leaves ${unsupported} units without a corresponding acceptance record.`,
    );
    lines.push("");
    lines.push(
      `Could you please confirm the status of the remaining ${unsupported} units, or share the acceptance document if it has already been issued? We would like to align our records with yours before the invoice moves further in your payable cycle.`,
    );
  } else if (a.issues.length) {
    lines.push("The following points are open on our side and we would appreciate your confirmation:");
    lines.push("");
    for (const i of a.issues.slice(0, 5)) lines.push(`• ${i.title}.`);
  } else {
    lines.push(
      `All supporting documents — purchase order, delivery challan, goods receipt note and invoice — are consistent. We are sharing the acceptance package for your records and would be glad to answer any question.`,
    );
  }

  lines.push("");
  lines.push("We have attached the acceptance package with the supporting documents for reference.");
  lines.push("");
  lines.push("Thank you for your help.");
  lines.push("");
  lines.push(`Regards,`);
  lines.push(`Accounts team, ${c.supplier}`);
  return lines.join("\n");
}
