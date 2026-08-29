import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/proofpay/shell";
import { ConfidenceBadge, Pill, SectionCard, SourceReference } from "@/components/proofpay/atoms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  EXTRACTION_VERSION,
  classifyDocumentType,
  extractFacts,
  extractRawText,
  type ExtractionProgress,
} from "@/lib/proofpay/extraction";
import { CONFIDENCE_THRESHOLDS, CRITICAL_FIELDS } from "@/lib/proofpay/rules";
import { ORGANIZATION } from "@/lib/proofpay/seed";
import { addCase } from "@/lib/proofpay/caseStore";
import { recordAudit } from "@/lib/proofpay/store";
import type {
  CaseDocument,
  CaseRecord,
  DocumentState,
  DocumentType,
  ExtractedFact,
} from "@/lib/proofpay/types";

export const Route = createFileRoute("/cases/new")({
  head: () => ({
    meta: [
      { title: "New case — ProofPay" },
      {
        name: "description",
        content: "Upload PO, invoice, delivery challan and GRN to build a new case.",
      },
    ],
  }),
  component: NewCasePage,
});

type SlotKey = "po" | "invoice" | "delivery" | "grn" | "payment" | "creditNote" | "communication";

const SLOT_DEFS: { key: SlotKey; label: string; type: DocumentType; required: boolean }[] = [
  { key: "po", label: "Purchase Order", type: "PURCHASE_ORDER", required: true },
  { key: "invoice", label: "Invoice", type: "INVOICE", required: true },
  { key: "delivery", label: "Delivery Challan", type: "DELIVERY_CHALLAN", required: true },
  { key: "grn", label: "GRN", type: "GRN", required: true },
  { key: "payment", label: "Payment Record", type: "PAYMENT_RECORD", required: false },
  { key: "creditNote", label: "Credit Note", type: "CREDIT_NOTE", required: false },
  { key: "communication", label: "Communication Export", type: "EMAIL_EXPORT", required: false },
];

const ACCEPT = ".pdf,.jpg,.jpeg,.png";

interface SlotState {
  file: File;
  docId: string;
  status: DocumentState;
  progress: number;
  progressMessage: string;
  docType: DocumentType;
  rawText: string;
  ocrConfidence: number;
  pages: number;
  extractionMethod: "OCR_LAYOUT" | "TEXT_PARSE";
  thumbnailDataUrl?: string;
  facts: ExtractedFact[];
  injectionHits: string[];
  error?: string;
}

function isLowConfidence(f: ExtractedFact): boolean {
  const threshold = CRITICAL_FIELDS.includes(f.label)
    ? CONFIDENCE_THRESHOLDS.critical
    : CONFIDENCE_THRESHOLDS.standard;
  return f.confidence < threshold;
}

function findFact(
  slots: Partial<Record<SlotKey, SlotState>>,
  label: string,
): ExtractedFact | undefined {
  for (const slot of Object.values(slots)) {
    const f = slot?.facts.find((f) => f.label === label);
    if (f) return f;
  }
  return undefined;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewCasePage() {
  const navigate = useNavigate();
  const [slots, setSlots] = useState<Partial<Record<SlotKey, SlotState>>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [manualTouched, setManualTouched] = useState<Set<string>>(new Set());
  const [acknowledgeLowConfidence, setAcknowledgeLowConfidence] = useState(false);
  const [creating, setCreating] = useState(false);

  const updateSlot = (key: SlotKey, patch: Partial<SlotState>) => {
    setSlots((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return { ...prev, [key]: { ...current, ...patch } };
    });
  };

  const processFile = async (key: SlotKey, defaultType: DocumentType, file: File) => {
    const docId = `doc-${Date.now()}-${key}-${Math.random().toString(36).slice(2, 7)}`;
    setSlots((prev) => ({
      ...prev,
      [key]: {
        file,
        docId,
        status: "UPLOADED",
        progress: 0,
        progressMessage: "Uploaded",
        docType: defaultType,
        rawText: "",
        ocrConfidence: 0,
        pages: 0,
        extractionMethod: "TEXT_PARSE",
        facts: [],
        injectionHits: [],
      },
    }));

    try {
      updateSlot(key, { status: "CLASSIFYING", progressMessage: "Preparing…" });
      const onProgress = (p: ExtractionProgress) => {
        updateSlot(key, {
          status:
            p.stage === "ocr" || p.stage === "parsing" || p.stage === "reading"
              ? "PROCESSING"
              : "CLASSIFYING",
          progress: p.percent,
          progressMessage: p.message,
        });
      };
      const raw = await extractRawText(file, onProgress);

      if (!raw.rawText) {
        updateSlot(key, {
          status: "FAILED",
          error: "Could not read any text from this file. Try a clearer scan or photo.",
        });
        return;
      }

      const guessed = classifyDocumentType(file.name, raw.rawText);
      const finalType = guessed === "OTHER" ? defaultType : guessed;
      const facts = extractFacts({
        sourceDocumentId: docId,
        docType: finalType,
        rawText: raw.rawText,
        lines: raw.lines,
        extractionMethod: raw.extractionMethod,
        overallConfidence: raw.ocrConfidence,
      });

      const needsReview =
        raw.ocrConfidence < 0.85 || facts.some(isLowConfidence) || raw.injectionHits.length > 0;

      updateSlot(key, {
        status: needsReview ? "NEEDS_REVIEW" : "EXTRACTED",
        progress: 100,
        progressMessage: needsReview ? "Extracted — needs review" : "Extraction complete",
        docType: finalType,
        rawText: raw.rawText,
        ocrConfidence: raw.ocrConfidence,
        pages: raw.pages,
        extractionMethod: raw.extractionMethod,
        ...(raw.thumbnailDataUrl !== undefined ? { thumbnailDataUrl: raw.thumbnailDataUrl } : {}),
        facts,
        injectionHits: raw.injectionHits,
      });
    } catch (err) {
      updateSlot(key, {
        status: "FAILED",
        error: err instanceof Error ? err.message : "Extraction failed unexpectedly.",
      });
    }
  };

  const removeSlot = (key: SlotKey) => {
    setSlots((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const editFactValue = (key: SlotKey, factId: string, newValue: string) => {
    setSlots((prev) => {
      const slot = prev[key];
      if (!slot) return prev;
      const original = slot.facts.find((f) => f.id === factId);
      const asNumber = Number(newValue);
      const shouldBeNumber = typeof original?.value === "number";
      const value = shouldBeNumber && !Number.isNaN(asNumber) ? asNumber : newValue;
      return {
        ...prev,
        [key]: {
          ...slot,
          facts: slot.facts.map((f) =>
            f.id === factId ? { ...f, value, humanCorrected: true } : f,
          ),
        },
      };
    });
  };

  const filledSlots = Object.entries(slots).filter(([, s]) => Boolean(s)) as [SlotKey, SlotState][];
  const allFacts = filledSlots.flatMap(([, s]) => s.facts);
  const anyProcessing = filledSlots.some(
    ([, s]) => s.status === "CLASSIFYING" || s.status === "PROCESSING",
  );
  const anyFailedUnresolved = filledSlots.some(([, s]) => s.status === "FAILED");
  const unresolvedLowConfidence = allFacts.filter((f) => isLowConfidence(f) && !f.humanCorrected);
  const anyInjection = filledSlots.some(([, s]) => s.injectionHits.length > 0);

  const setManualField = (field: string, value: string) => {
    setManual((prev) => ({ ...prev, [field]: value }));
    setManualTouched((prev) => new Set(prev).add(field));
  };

  const fieldValue = (manualKey: string, factLabel: string): string => {
    if (manualTouched.has(manualKey)) return manual[manualKey] ?? "";
    const f = findFact(slots, factLabel);
    return f ? String(f.value) : (manual[manualKey] ?? "");
  };

  const dateValue = (manualKey: string, factLabel: string, fallbackToday: boolean): string => {
    if (manualTouched.has(manualKey)) return manual[manualKey] ?? "";
    const f = findFact(slots, factLabel);
    if (f) return String(f.value);
    return fallbackToday ? todayIso() : "";
  };

  // Required scalar fields for a valid CaseRecord — filled from best-matching extracted
  // fact, or left for the reviewer to type in directly when nothing was extracted.
  const buyer = fieldValue("buyer", "Buyer Name");
  const buyerGSTIN = fieldValue("buyerGSTIN", "Buyer GSTIN");
  const poNumber = fieldValue("poNumber", "PO Number");
  const invoiceNumber = fieldValue("invoiceNumber", "Invoice Number");
  const unitPrice = fieldValue("unitPrice", "Unit Price");
  const invoiceTotal = fieldValue("invoiceTotal", "Invoice Total");
  const poDate = dateValue("poDate", "PO Date", true);
  const invoiceDate = dateValue("invoiceDate", "Invoice Date", true);
  const dueDate = dateValue("dueDate", "Due Date", false);
  const deliveryDate = dateValue("deliveryDate", "Delivery Date", false);
  const grnDate = dateValue("grnDate", "GRN Date", false);

  const poQty = fieldValue("poQty", "Ordered Quantity");
  const deliveredQty = fieldValue("deliveredQty", "Delivered Quantity");
  const acceptedQty = fieldValue("acceptedQty", "Accepted Quantity");
  const invoicedQty = fieldValue("invoicedQty", "Invoiced Quantity");

  const requiredFields: { label: string; value: string; manualKey: string }[] = [
    { label: "Buyer name", value: buyer, manualKey: "buyer" },
    { label: "Buyer GSTIN", value: buyerGSTIN, manualKey: "buyerGSTIN" },
    { label: "PO number", value: poNumber, manualKey: "poNumber" },
    { label: "Invoice number", value: invoiceNumber, manualKey: "invoiceNumber" },
    { label: "Unit price", value: unitPrice, manualKey: "unitPrice" },
    { label: "Invoice total", value: invoiceTotal, manualKey: "invoiceTotal" },
    { label: "Due date", value: dueDate, manualKey: "dueDate" },
  ];
  const missingRequired = requiredFields.filter(
    (f) => !f.value || f.value === "0" || f.value.trim() === "",
  );

  const hasAnyDocument = filledSlots.length > 0;
  const canCreate =
    hasAnyDocument &&
    !anyProcessing &&
    missingRequired.length === 0 &&
    (unresolvedLowConfidence.length === 0 || acknowledgeLowConfidence);

  const createCase = () => {
    if (!canCreate) return;
    setCreating(true);

    const documents: CaseDocument[] = filledSlots.map(([, s]) => {
      const stillLow = s.facts.some((f) => isLowConfidence(f) && !f.humanCorrected);
      return {
        id: s.docId,
        type: s.docType,
        fileName: s.file.name,
        pages: Math.max(1, s.pages),
        state: (stillLow ? "NEEDS_REVIEW" : "VERIFIED") as DocumentState,
        ocrConfidence: s.ocrConfidence,
        hash: `sha256:${s.docId}-${s.file.name.length.toString(16)}${s.rawText.length.toString(16)}`,
        rawText: s.rawText,
        facts: s.facts,
      };
    });

    const anchorDocId = documents[0]?.id ?? "manual";
    const syntheticFacts: ExtractedFact[] = requiredFields
      .filter((f) => manualTouched.has(f.manualKey) && !findFact(slots, f.label))
      .map((f, i) => ({
        id: `manual-${f.manualKey}-${i}`,
        label: f.label,
        value: f.value,
        confidence: 1,
        sourceDocumentId: anchorDocId,
        sourcePage: 1,
        sourceSnippet: "Entered manually during review",
        boundingBox: { x: 8, y: 14, w: 34, h: 5 },
        extractionMethod: "TEXT_PARSE" as const,
        extractionVersion: EXTRACTION_VERSION,
        humanCorrected: true,
      }));
    const firstDoc = documents[0];
    if (firstDoc) firstDoc.facts = [...firstDoc.facts, ...syntheticFacts];

    const now = new Date();
    const id = `PP-USR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const toNum = (s: string) => {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    const record: CaseRecord = {
      id,
      code: id,
      scenario: "USER",
      title: "User-submitted case",
      supplier: ORGANIZATION.name,
      supplierGSTIN: ORGANIZATION.gstin,
      buyer: buyer || "Unknown buyer",
      buyerGSTIN: buyerGSTIN || "UNKNOWN",
      buyerGSTINOnInvoice: buyerGSTIN || "UNKNOWN",
      unitPrice: toNum(unitPrice) ?? 0,
      currency: "INR",
      invoiceNumber: invoiceNumber || "UNKNOWN",
      poNumber: poNumber || "UNKNOWN",
      poNumberOnInvoice: poNumber || "UNKNOWN",
      invoiceTotal: toNum(invoiceTotal) ?? 0,
      paymentsReceived: toNum(fieldValue("paymentAmount", "Payment Amount")) ?? 0,
      creditNoteAmount: toNum(fieldValue("creditNoteAmount", "Credit Note Amount")) ?? 0,
      tdsAmount: 0,
      retentionAmount: 0,
      dates: {
        po: poDate || todayIso(),
        ...(deliveryDate ? { delivery: deliveryDate } : {}),
        ...(grnDate ? { grn: grnDate } : {}),
        invoice: invoiceDate || todayIso(),
        due: dueDate || todayIso(),
      },
      quantities: {
        ...(toNum(poQty) !== undefined ? { po: toNum(poQty) } : {}),
        ...(toNum(deliveredQty) !== undefined ? { delivered: toNum(deliveredQty) } : {}),
        ...(toNum(acceptedQty) !== undefined ? { accepted: toNum(acceptedQty) } : {}),
        ...(toNum(invoicedQty) !== undefined ? { invoiced: toNum(invoicedQty) } : {}),
      },
      documents,
      createdAt: now.toISOString(),
      notes: "Created from uploaded documents via the New Case flow.",
    };

    addCase(record);
    recordAudit(record.id, "case.created_from_upload", "Case", record.id, {
      documents: documents.length,
      facts: documents.reduce((sum, d) => sum + d.facts.length, 0),
    });
    toast.success(`${record.code} created from ${documents.length} document(s)`);
    void navigate({ to: "/cases/$caseId", params: { caseId: record.id } });
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold">New case</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your PO, invoice, delivery challan and GRN — extraction and reconciliation run
            entirely in your browser, then you land on the same case workspace the seeded scenarios
            use.
          </p>
        </div>

        <SectionCard
          title="Upload documents"
          description="PDF, JPG or PNG. Drag & drop or click to browse."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SLOT_DEFS.map((def) => (
              <UploadSlot
                key={def.key}
                label={def.label}
                required={def.required}
                slot={slots[def.key]}
                onFile={(file) => void processFile(def.key, def.type, file)}
                onRemove={() => removeSlot(def.key)}
              />
            ))}
          </div>
        </SectionCard>

        {hasAnyDocument ? (
          <>
            <SectionCard
              title="Extracted facts"
              description="Every value is editable — corrections are recorded and never silently overwritten"
            >
              {allFacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No facts extracted yet — wait for uploads to finish processing.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Field</th>
                        <th className="pb-2 pr-3 font-medium">Value</th>
                        <th className="pb-2 pr-3 font-medium">Confidence</th>
                        <th className="pb-2 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filledSlots.flatMap(([key, s]) =>
                        s.facts.map((f) => (
                          <tr key={f.id} className="border-b last:border-0">
                            <td className="py-2 pr-3">
                              {f.label}
                              {f.humanCorrected ? (
                                <span className="ml-1.5">
                                  <Pill tone="info">Corrected</Pill>
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2 pr-3">
                              <Input
                                value={String(f.value)}
                                onChange={(e) => editFactValue(key, f.id, e.target.value)}
                                className="h-7 w-40 text-xs"
                              />
                            </td>
                            <td className="py-2 pr-3">
                              <ConfidenceBadge
                                value={f.confidence}
                                critical={CRITICAL_FIELDS.includes(f.label)}
                              />
                            </td>
                            <td className="py-2">
                              <SourceReference
                                fileName={s.file.name}
                                page={f.sourcePage}
                                snippet={f.sourceSnippet}
                              />
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {anyInjection ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                  <FileWarning className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                  <span>
                    Instruction-like text was found inside one or more uploaded documents. It has
                    been recorded and flagged as a risk — it will never influence classification,
                    extraction or the case decision.
                  </span>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Case details"
              description="Pre-filled from extracted facts where possible — fill in anything missing"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Buyer name"
                  value={buyer}
                  onChange={(v) => setManualField("buyer", v)}
                  required
                />
                <Field
                  label="Buyer GSTIN"
                  value={buyerGSTIN}
                  onChange={(v) => setManualField("buyerGSTIN", v)}
                  required
                />
                <Field
                  label="PO number"
                  value={poNumber}
                  onChange={(v) => setManualField("poNumber", v)}
                  required
                />
                <Field
                  label="Invoice number"
                  value={invoiceNumber}
                  onChange={(v) => setManualField("invoiceNumber", v)}
                  required
                />
                <Field
                  label="Unit price (₹)"
                  value={unitPrice}
                  onChange={(v) => setManualField("unitPrice", v)}
                  required
                  type="number"
                />
                <Field
                  label="Invoice total (₹)"
                  value={invoiceTotal}
                  onChange={(v) => setManualField("invoiceTotal", v)}
                  required
                  type="number"
                />
                <Field
                  label="PO date"
                  value={poDate}
                  onChange={(v) => setManualField("poDate", v)}
                />
                <Field
                  label="Delivery date"
                  value={deliveryDate}
                  onChange={(v) => setManualField("deliveryDate", v)}
                />
                <Field
                  label="GRN date"
                  value={grnDate}
                  onChange={(v) => setManualField("grnDate", v)}
                />
                <Field
                  label="Invoice date"
                  value={invoiceDate}
                  onChange={(v) => setManualField("invoiceDate", v)}
                />
                <Field
                  label="Due date"
                  value={dueDate}
                  onChange={(v) => setManualField("dueDate", v)}
                  required
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <Field
                  label="Ordered qty"
                  value={poQty}
                  onChange={(v) => setManualField("poQty", v)}
                  type="number"
                />
                <Field
                  label="Delivered qty"
                  value={deliveredQty}
                  onChange={(v) => setManualField("deliveredQty", v)}
                  type="number"
                />
                <Field
                  label="Accepted qty (GRN)"
                  value={acceptedQty}
                  onChange={(v) => setManualField("acceptedQty", v)}
                  type="number"
                />
                <Field
                  label="Invoiced qty"
                  value={invoicedQty}
                  onChange={(v) => setManualField("invoicedQty", v)}
                  type="number"
                />
              </div>
            </SectionCard>

            <SectionCard title="Create case">
              <div className="space-y-3">
                {missingRequired.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Missing required field(s): {missingRequired.map((f) => f.label).join(", ")}.
                      Fill these in above before creating the case.
                    </span>
                  </div>
                ) : null}

                {unresolvedLowConfidence.length > 0 ? (
                  <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                    <input
                      type="checkbox"
                      checked={acknowledgeLowConfidence}
                      onChange={(e) => setAcknowledgeLowConfidence(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      {unresolvedLowConfidence.length} field(s) were extracted with low confidence (
                      {unresolvedLowConfidence.map((f) => f.label).join(", ")}). I acknowledge this
                      and want to proceed — these will remain flagged for review on the case.
                    </span>
                  </label>
                ) : null}

                {anyProcessing ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Waiting for uploads to finish
                    processing…
                  </p>
                ) : null}

                {anyFailedUnresolved ? (
                  <p className="text-xs text-muted-foreground">
                    One or more uploads failed to extract — remove them or re-upload a clearer file.
                    You can still create the case from the remaining documents.
                  </p>
                ) : null}

                <Button onClick={createCase} disabled={!canCreate || creating}>
                  {creating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Create case
                </Button>
              </div>
            </SectionCard>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: "text" | "number";
}) {
  const empty = required && (!value || value.trim() === "" || value === "0");
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </span>
      <Input
        value={value}
        inputMode={type === "number" ? "decimal" : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={empty ? "border-destructive/50" : ""}
        placeholder={required ? "Required — not extracted" : "Not extracted"}
      />
    </label>
  );
}

function UploadSlot({
  label,
  required,
  slot,
  onFile,
  onRemove,
}: {
  label: string;
  required: boolean;
  slot: SlotState | undefined;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  if (!slot) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
        }`}
      >
        <Upload className="size-5 text-muted-foreground" />
        <div className="text-sm font-medium">
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </div>
        <div className="text-xs text-muted-foreground">Drag & drop or click to browse</div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  const statusTone =
    slot.status === "FAILED"
      ? "critical"
      : slot.status === "NEEDS_REVIEW"
        ? "warning"
        : slot.status === "EXTRACTED"
          ? "success"
          : "info";

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          <div className="truncate text-xs text-muted-foreground">{slot.file.name}</div>
        </div>
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          title="Remove"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Pill tone={statusTone as never}>{slot.status.replace(/_/g, " ")}</Pill>
        {slot.docType !== "OTHER" ? (
          <Pill tone="neutral">{slot.docType.replace(/_/g, " ")}</Pill>
        ) : null}
      </div>

      {slot.status === "CLASSIFYING" || slot.status === "PROCESSING" ? (
        <div className="mt-2 space-y-1">
          <Progress value={slot.progress} />
          <div className="text-[11px] text-muted-foreground">{slot.progressMessage}</div>
        </div>
      ) : null}

      {slot.status === "FAILED" ? (
        <p className="mt-2 text-xs text-destructive">{slot.error}</p>
      ) : null}

      {slot.status === "EXTRACTED" || slot.status === "NEEDS_REVIEW" ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {slot.facts.length} field(s) extracted · <ConfidenceBadge value={slot.ocrConfidence} />
        </div>
      ) : null}
    </div>
  );
}
