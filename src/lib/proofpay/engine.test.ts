import { describe, expect, it } from "vitest";
import { assessCase } from "./engine";
import { CASES, getCase } from "./seed";
import { CONFIDENCE_THRESHOLDS, detectInjection } from "./rules";

function scenario(letter: string) {
  const c = CASES.find((c) => c.scenario === letter);
  if (!c) throw new Error(`Scenario ${letter} not found in seed CASES`);
  return c;
}

describe("assessCase", () => {
  it("Scenario A — complete and consistent evidence set is Ready", () => {
    const c = scenario("A");
    // sanity-check we pulled the right fixture straight from seed.ts
    expect(getCase(c.id)).toBe(c);

    const a = assessCase(c);
    expect(a.readinessStatus).toBe("READY");
    expect(a.decision).toBe("READY_FOR_HUMAN_REVIEW");
    expect(a.issues).toHaveLength(0);
  });

  it("Scenario B — PO 100 / Delivery 100 / GRN 80 / Invoice 100 blocks with 20 unsupported units", () => {
    const c = scenario("B");
    expect(c.quantities).toMatchObject({ po: 100, delivered: 100, accepted: 80, invoiced: 100 });

    const a = assessCase(c);
    expect(a.decision).toBe("DO_NOT_SEND_YET");
    expect(a.headline).toContain("20 units");

    const mismatch = a.issues.find((i) => i.ruleId === "ACCEPTED_QUANTITY_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch!.description).toContain("20 units");

    const grnInvoiceRow = a.reconciliation.find((r) => r.pair === "GRN ↔ Invoice");
    expect(grnInvoiceRow?.result).toBe("MISMATCH");
  });

  it("Scenario C — missing delivery/GRN evidence is Incomplete", () => {
    const c = scenario("C");
    const docTypes = new Set(c.documents.map((d) => d.type));
    expect(docTypes.has("DELIVERY_CHALLAN")).toBe(false);
    expect(docTypes.has("GRN")).toBe(false);

    const a = assessCase(c);
    expect(a.readinessStatus).toBe("INCOMPLETE");
    expect(a.decision).toBe("DO_NOT_SEND_YET");
    expect(a.issues.some((i) => i.ruleId === "DOC_MISSING_DELIVERY")).toBe(true);
    expect(a.issues.some((i) => i.ruleId === "DOC_MISSING_GRN")).toBe(true);
  });

  it("Scenario D — duplicate invoice is flagged and blocks", () => {
    const c = scenario("D");
    expect(c.duplicateOfInvoiceNumber).toBeTruthy();

    const a = assessCase(c);
    const dup = a.issues.find((i) => i.ruleId === "DUPLICATE_INVOICE");
    expect(dup).toBeDefined();
    expect(dup!.description).toContain(c.duplicateOfInvoiceNumber!);
    expect(a.decision).toBe("DO_NOT_SEND_YET");
  });

  it("Scenario H — OCR misread of ₹11,800 vs ₹1,18,000 forces human review via CONFIDENCE_THRESHOLDS", () => {
    const c = scenario("H");
    const invoiceDoc = c.documents.find((d) => d.type === "INVOICE")!;
    const totalFact = invoiceDoc.facts.find((f) => f.label === "Invoice Total")!;

    // the fixture really is the low-confidence misread described in seed.ts
    expect(totalFact.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.critical);
    expect(totalFact.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.standard);

    const a = assessCase(c);
    const lowConfidenceIssue = a.issues.find((i) => i.ruleId === "LOW_OCR_CONFIDENCE");
    expect(lowConfidenceIssue).toBeDefined();
    expect(lowConfidenceIssue!.description).toContain("Invoice Total");
    expect(a.requiresHumanReview).toBe(true);
    expect(a.decision).toBe("DO_NOT_SEND_YET");
  });

  it("Scenario I — embedded injection text is flagged and never influences the decision", () => {
    const c = scenario("I");
    const grnDoc = c.documents.find((d) => d.type === "GRN")!;

    // the fixture actually embeds instruction-like text
    const hits = detectInjection(grnDoc.rawText);
    expect(hits.length).toBeGreaterThan(0);

    const a = assessCase(c);
    const injectionIssue = a.issues.find((i) => i.ruleId === "PROMPT_INJECTION_CONTENT");
    expect(injectionIssue).toBeDefined();
    expect(injectionIssue!.severity).toBe("MEDIUM");

    // scenario I is otherwise a clean, fully-matched evidence set (75/75/75/75) —
    // the injected text must not push the case toward approval or a blocked state.
    // It should surface only as a WARN-level flag, never as a reason to approve,
    // and never bypass the human-approval gate.
    expect(a.requiresHumanReview).toBe(true);
    const quantityRows = a.reconciliation.filter((r) => r.pair.includes("PO") || r.pair.includes("GRN"));
    for (const row of quantityRows) {
      expect(["MATCH", "MISSING"]).toContain(row.result);
    }
  });
});
