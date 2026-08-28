import {
  CONFIDENCE_THRESHOLDS,
  CRITICAL_FIELDS,
  RULE_BY_ID,
  detectInjection,
} from "./rules";
import type {
  Assessment,
  CaseRecord,
  Issue,
  MatchResult,
  ReadinessStatus,
  ReconciliationRow,
  Severity,
} from "./types";

/**
 * ALL arithmetic, comparison, date logic and scoring in this file is
 * deterministic code. No language model participates in these decisions.
 */

const fmtQty = (q?: number) => (q === undefined ? "—" : String(q));

export function money(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function compareQty(
  left?: number,
  right?: number,
): { result: MatchResult; detail: string } {
  if (left === undefined || right === undefined)
    return { result: "MISSING", detail: "Required document or quantity is not available." };
  if (left === right) return { result: "MATCH", detail: "Quantities are equal." };
  if (right < left)
    return {
      result: right === 0 ? "MISMATCH" : "PARTIAL",
      detail: `Shortfall of ${left - right} units.`,
    };
  return { result: "MISMATCH", detail: `Excess of ${right - left} units.` };
}

export function buildReconciliation(c: CaseRecord): ReconciliationRow[] {
  const q = c.quantities;
  const rows: ReconciliationRow[] = [];

  const poDelivery = compareQty(q.po, q.delivered);
  rows.push({
    pair: "PO ↔ Delivery",
    left: fmtQty(q.po),
    right: fmtQty(q.delivered),
    ...poDelivery,
  });

  const deliveryGrn = compareQty(q.delivered, q.accepted);
  rows.push({
    pair: "Delivery ↔ GRN",
    left: fmtQty(q.delivered),
    right: fmtQty(q.accepted),
    result: deliveryGrn.result === "PARTIAL" ? "MISMATCH" : deliveryGrn.result,
    detail:
      q.delivered !== undefined && q.accepted !== undefined && q.accepted < q.delivered
        ? `${q.delivered - q.accepted} delivered units were not accepted.`
        : deliveryGrn.detail,
  });

  rows.push({ pair: "PO ↔ GRN", left: fmtQty(q.po), right: fmtQty(q.accepted), ...compareQty(q.po, q.accepted) });

  const grnInvoice = compareQty(q.accepted, q.invoiced);
  rows.push({
    pair: "GRN ↔ Invoice",
    left: fmtQty(q.accepted),
    right: fmtQty(q.invoiced),
    result: grnInvoice.result === "PARTIAL" ? "MISMATCH" : grnInvoice.result,
    detail:
      q.accepted !== undefined && q.invoiced !== undefined && q.invoiced > q.accepted
        ? `${q.invoiced - q.accepted} invoiced units are not supported by acceptance evidence.`
        : grnInvoice.detail,
  });

  rows.push({ pair: "PO ↔ Invoice", left: fmtQty(q.po), right: fmtQty(q.invoiced), ...compareQty(q.po, q.invoiced) });

  const outstanding = netClaimable(c);
  rows.push({
    pair: "Invoice ↔ Payment",
    left: money(c.invoiceTotal),
    right: money(c.paymentsReceived),
    result:
      c.paymentsReceived === 0
        ? "MISSING"
        : c.paymentsReceived >= c.invoiceTotal
          ? "MATCH"
          : "PARTIAL",
    detail:
      c.paymentsReceived === 0
        ? "No payment recorded against this invoice."
        : `Outstanding balance ${money(outstanding)}.`,
  });

  rows.push({
    pair: "Invoice ↔ Credit Note",
    left: money(c.invoiceTotal),
    right: money(c.creditNoteAmount),
    result: c.creditNoteAmount > 0 ? "PARTIAL" : "MATCH",
    detail:
      c.creditNoteAmount > 0
        ? `Credit note reduces the claimable amount by ${money(c.creditNoteAmount)}.`
        : "No credit note recorded.",
  });

  return rows;
}

export function computedInvoiceTotal(c: CaseRecord): number {
  return (c.quantities.invoiced ?? 0) * c.unitPrice;
}

export function netClaimable(c: CaseRecord): number {
  return (
    c.invoiceTotal - c.paymentsReceived - c.creditNoteAmount - c.tdsAmount - c.retentionAmount
  );
}

function issue(
  ruleId: string,
  partial: Partial<Issue> & { title: string; description: string; recommendedAction: string; evidence: string[] },
): Issue {
  const rule = RULE_BY_ID[ruleId]!;
  return {
    id: `${ruleId}`,
    ruleId,
    category: rule.category,
    type: ruleId,
    severity: (partial.severity ?? rule.severity) as Severity,
    status: "OPEN",
    ...partial,
  };
}

export function runRules(c: CaseRecord): Issue[] {
  const issues: Issue[] = [];
  const q = c.quantities;
  const has = (t: string) => c.documents.some((d) => d.type === t);

  if (!has("PURCHASE_ORDER"))
    issues.push(
      issue("DOC_MISSING_PO", {
        title: "Purchase order not on file",
        description: "No purchase order document was uploaded for this case.",
        evidence: ["Document set"],
        recommendedAction: "Upload the purchase order or work order for this transaction.",
      }),
    );

  if (!has("DELIVERY_CHALLAN"))
    issues.push(
      issue("DOC_MISSING_DELIVERY", {
        title: "Delivery proof missing",
        description: "No delivery challan or dispatch proof was found in the evidence set.",
        evidence: ["Document set"],
        recommendedAction: "Upload the delivery challan / LR copy covering the invoiced goods.",
      }),
    );

  if (!has("GRN"))
    issues.push(
      issue("DOC_MISSING_GRN", {
        title: "Acceptance evidence missing",
        description:
          "No goods receipt note or acceptance record is available, so the invoiced quantity is unverified.",
        evidence: ["Document set"],
        recommendedAction:
          "Request the buyer's GRN or written acceptance before any payment follow-up.",
      }),
    );

  if (q.po !== undefined && q.delivered !== undefined && q.delivered > q.po)
    issues.push(
      issue("QTY_DELIVERY_VS_PO", {
        title: "Delivered quantity exceeds ordered quantity",
        description: `Delivered ${q.delivered} units against an order of ${q.po} units.`,
        evidence: ["Purchase order", "Delivery challan"],
        recommendedAction: "Confirm whether an amended PO exists for the additional units.",
      }),
    );

  if (q.po !== undefined && q.delivered !== undefined && q.delivered < q.po)
    issues.push(
      issue("PARTIAL_DELIVERY", {
        title: "Partial delivery against purchase order",
        description: `${q.po - q.delivered} of ${q.po} ordered units are not covered by delivery evidence.`,
        evidence: ["Purchase order", "Delivery challan"],
        recommendedAction: "Confirm the balance delivery schedule with the buyer.",
      }),
    );

  if (q.accepted !== undefined && q.invoiced !== undefined && q.invoiced > q.accepted)
    issues.push(
      issue("ACCEPTED_QUANTITY_MISMATCH", {
        title: `${q.invoiced - q.accepted} units are not supported by acceptance evidence`,
        description: `Invoice quantity (${q.invoiced}) exceeds accepted quantity in the GRN (${q.accepted}). The difference of ${q.invoiced - q.accepted} units has no acceptance record.`,
        evidence: ["GRN", "Invoice"],
        recommendedAction: `Request written confirmation or acceptance evidence for the remaining ${q.invoiced - q.accepted} units before pursuing full payment.`,
      }),
    );

  if (c.duplicateOfInvoiceNumber)
    issues.push(
      issue("DUPLICATE_INVOICE", {
        title: "Possible duplicate invoice",
        description: `Invoice ${c.invoiceNumber} matches an earlier invoice ${c.duplicateOfInvoiceNumber} for the same buyer, amount and PO.`,
        evidence: ["Invoice", "Invoice ledger"],
        recommendedAction: "Withdraw or reconcile the duplicate before contacting the buyer.",
      }),
    );

  if (c.buyerGSTINOnInvoice && c.buyerGSTINOnInvoice !== c.buyerGSTIN)
    issues.push(
      issue("GSTIN_MISMATCH", {
        title: "Buyer GSTIN on invoice differs from buyer record",
        description: `Invoice shows ${c.buyerGSTINOnInvoice}; buyer master record shows ${c.buyerGSTIN}. GSTINs are never auto-merged.`,
        evidence: ["Invoice", "Buyer record"],
        recommendedAction: "Confirm the correct GSTIN with the buyer and reissue if required.",
      }),
    );

  if (c.poNumberOnInvoice && c.poNumberOnInvoice !== c.poNumber)
    issues.push(
      issue("PO_REFERENCE_MISMATCH", {
        title: "PO reference on invoice does not match the purchase order",
        description: `Invoice quotes ${c.poNumberOnInvoice}; purchase order is ${c.poNumber}.`,
        evidence: ["Invoice", "Purchase order"],
        recommendedAction: "Correct the PO reference on the invoice.",
      }),
    );

  if (c.dates.delivery && c.dates.invoice < c.dates.delivery)
    issues.push(
      issue("INVOICE_BEFORE_DELIVERY", {
        title: "Invoice dated before delivery",
        description: `Invoice date ${c.dates.invoice} precedes delivery date ${c.dates.delivery}.`,
        evidence: ["Invoice", "Delivery challan"],
        recommendedAction: "Clarify the invoicing date with the buyer's accounts team.",
      }),
    );

  if (c.paymentsReceived > 0 && c.paymentsReceived < c.invoiceTotal)
    issues.push(
      issue("PARTIAL_PAYMENT", {
        title: "Partial payment recorded",
        description: `${money(c.paymentsReceived)} received against an invoice total of ${money(c.invoiceTotal)}.`,
        evidence: ["Payment record", "Invoice"],
        recommendedAction: `Reference the outstanding balance of ${money(c.invoiceTotal - c.paymentsReceived)} in any clarification.`,
      }),
    );

  if (c.creditNoteAmount > 0)
    issues.push(
      issue("CREDIT_NOTE_PRESENT", {
        title: "Credit note reduces the claimable amount",
        description: `A credit note of ${money(c.creditNoteAmount)} is on file against this invoice.`,
        evidence: ["Credit note"],
        recommendedAction: `Use the net claimable figure ${money(netClaimable(c))} in all communication.`,
      }),
    );

  if (c.tdsAmount > 0 || c.retentionAmount > 0)
    issues.push(
      issue("TDS_RETENTION_DETECTED", {
        title: "TDS / retention deductions detected",
        description: `TDS ${money(c.tdsAmount)} and retention ${money(c.retentionAmount)} apply to this invoice.`,
        evidence: ["Invoice", "Purchase order terms"],
        recommendedAction: `Expect a net receipt of ${money(netClaimable(c))}; do not treat the deduction as a shortfall.`,
      }),
    );

  const computed = computedInvoiceTotal(c);
  if (c.quantities.invoiced !== undefined && Math.abs(computed - c.invoiceTotal) > 1)
    issues.push(
      issue("AMOUNT_ARITHMETIC_MISMATCH", {
        title: "Invoice total does not match quantity × unit price",
        description: `Computed ${money(computed)} from ${c.quantities.invoiced} × ${money(c.unitPrice)}, invoice states ${money(c.invoiceTotal)}.`,
        evidence: ["Invoice"],
        recommendedAction: "Verify the invoice total against the line items before sending anything.",
      }),
    );

  for (const doc of c.documents) {
    const lowFacts = doc.facts.filter((f) => {
      const threshold = CRITICAL_FIELDS.includes(f.label)
        ? CONFIDENCE_THRESHOLDS.critical
        : CONFIDENCE_THRESHOLDS.standard;
      return f.confidence < threshold;
    });
    if (lowFacts.length)
      issues.push(
        issue("LOW_OCR_CONFIDENCE", {
          title: `Low extraction confidence in ${doc.fileName}`,
          description: `Fields below threshold: ${lowFacts
            .map((f) => `${f.label} (${Math.round(f.confidence * 100)}%)`)
            .join(", ")}. These values are treated as UNKNOWN until a human confirms them.`,
          evidence: [doc.fileName],
          recommendedAction: "Open the source page and confirm or correct the value manually.",
        }),
      );

    const hits = detectInjection(doc.rawText);
    if (hits.length)
      issues.push(
        issue("PROMPT_INJECTION_CONTENT", {
          title: `Instruction-like text found in ${doc.fileName}`,
          description: `The document contains: "${hits[0]}". This was ignored as an instruction and recorded as document content only.`,
          evidence: [doc.fileName],
          recommendedAction: "Review the document source and confirm its legitimacy with the buyer.",
        }),
      );
  }

  return issues;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  INFO: 0,
  LOW: 3,
  MEDIUM: 8,
  HIGH: 20,
  CRITICAL: 30,
};

export function assessCase(c: CaseRecord): Assessment {
  const reconciliation = buildReconciliation(c);
  const issues = runRules(c);
  const open = issues.filter((i) => i.status === "OPEN" || i.status === "IN_REVIEW");

  const q = c.quantities;
  const docTypes = new Set(c.documents.map((d) => d.type));
  const required = ["PURCHASE_ORDER", "INVOICE", "DELIVERY_CHALLAN", "GRN"];
  const presentCount = required.filter((t) => docTypes.has(t as never)).length;

  const evidenceCompleteness = Math.round((presentCount / required.length) * 25);

  const consistencyPenalty = open
    .filter((i) => ["QUANTITY", "PRICE", "IDENTITY", "DATE", "DUPLICATE"].includes(i.category))
    .reduce((s, i) => s + SEVERITY_WEIGHT[i.severity], 0);
  const dataConsistency = Math.max(0, 25 - consistencyPenalty);

  const acceptanceOk =
    q.accepted !== undefined && q.invoiced !== undefined && q.invoiced <= q.accepted;
  const acceptanceConsistency = acceptanceOk
    ? 25
    : q.accepted === undefined
      ? 0
      : Math.max(0, Math.round((q.accepted / (q.invoiced || 1)) * 25) - 10);

  const paymentPenalty = open
    .filter((i) => ["PAYMENT", "TAX"].includes(i.category))
    .reduce((s, i) => s + SEVERITY_WEIGHT[i.severity], 0);
  const paymentTerms = Math.max(0, 10 - paymentPenalty);

  const qualityPenalty = open
    .filter((i) => ["DATA_QUALITY", "SECURITY", "EVIDENCE"].includes(i.category))
    .reduce((s, i) => s + SEVERITY_WEIGHT[i.severity], 0);
  const documentQuality = Math.max(0, 15 - qualityPenalty);

  const breakdown = [
    { label: "Evidence completeness", score: evidenceCompleteness, max: 25 },
    { label: "Data consistency", score: dataConsistency, max: 25 },
    { label: "Acceptance consistency", score: acceptanceConsistency, max: 25 },
    { label: "Payment-term consistency", score: paymentTerms, max: 10 },
    { label: "Document quality", score: documentQuality, max: 15 },
  ];
  const readinessScore = breakdown.reduce((s, b) => s + b.score, 0);

  const blocking = open.filter((i) => RULE_BY_ID[i.ruleId]?.action === "BLOCK");
  const reviewNeeded = open.filter((i) =>
    ["REVIEW", "BLOCK"].includes(RULE_BY_ID[i.ruleId]?.action ?? "PASS"),
  );

  let readinessStatus: ReadinessStatus;
  if (presentCount < required.length && blocking.length) readinessStatus = "INCOMPLETE";
  else if (blocking.length) readinessStatus = "BLOCKED";
  else if (reviewNeeded.length) readinessStatus = "NEEDS_CLARIFICATION";
  else if (open.length) readinessStatus = "READY_WITH_REVIEW";
  else readinessStatus = "READY";

  const decision =
    blocking.length || reviewNeeded.length ? "DO_NOT_SEND_YET" : "READY_FOR_HUMAN_REVIEW";

  const unsupported =
    q.accepted !== undefined && q.invoiced !== undefined && q.invoiced > q.accepted
      ? q.invoiced - q.accepted
      : 0;

  const headline = unsupported
    ? `Do not proceed yet. Invoice quantity exceeds accepted quantity by ${unsupported} units. Additional acceptance evidence or clarification is required.`
    : readinessStatus === "INCOMPLETE"
      ? "Evidence set is incomplete. Collect the missing documents before requesting acceptance."
      : readinessStatus === "READY"
        ? "Evidence is complete and internally consistent. Ready for human review before any communication is sent."
        : "Open items require human review before this package can be treated as acceptance-ready.";

  return {
    reconciliation,
    issues,
    readinessScore,
    readinessStatus,
    decision,
    requiresHumanReview: true,
    headline,
    breakdown,
  };
}

/** Admin rule simulator — deterministic, mirrors the production path. */
export function simulateRules(input: { po: number; delivered?: number; accepted?: number; invoiced: number }) {
  const fired: { ruleId: string; severity: Severity; action: string }[] = [];
  const { po, delivered, accepted, invoiced } = input;
  if (accepted !== undefined && invoiced > accepted)
    fired.push({ ruleId: "ACCEPTED_QUANTITY_MISMATCH", severity: "HIGH", action: "BLOCK" });
  if (accepted === undefined)
    fired.push({ ruleId: "DOC_MISSING_GRN", severity: "HIGH", action: "BLOCK" });
  if (delivered !== undefined && delivered < po)
    fired.push({ ruleId: "PARTIAL_DELIVERY", severity: "MEDIUM", action: "WARN" });
  if (delivered !== undefined && delivered > po)
    fired.push({ ruleId: "QTY_DELIVERY_VS_PO", severity: "MEDIUM", action: "REVIEW" });
  const result = fired.some((f) => f.action === "BLOCK")
    ? "BLOCK"
    : fired.some((f) => f.action === "REVIEW")
      ? "REVIEW"
      : fired.length
        ? "WARN"
        : "PASS";
  return { fired, result };
}
