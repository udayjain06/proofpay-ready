/**
 * Client-side document extraction pipeline.
 *
 * Everything here runs in the browser — no backend calls. PDFs are parsed
 * with pdfjs-dist (falling back to OCR when a PDF has no real text layer),
 * images are OCR'd with tesseract.js, and every field pulled out of the
 * resulting text is produced by plain regex/heuristic code — never a
 * language model. Document text is DATA ONLY: detectInjection() is run on
 * it immediately, before anything else touches it, exactly like the rest
 * of the engine treats document content.
 */
import type { BoundingBox, CaseDocument, DocumentType, ExtractedFact } from "./types";
import { detectInjection } from "./rules";

export const EXTRACTION_VERSION = "extraction@1.0.0";

export type ExtractionStage = "reading" | "ocr" | "parsing" | "classifying" | "done";

export interface ExtractionProgress {
  stage: ExtractionStage;
  percent: number;
  message: string;
}

export interface RawExtractionResult {
  rawText: string;
  ocrConfidence: number;
  pages: number;
  extractionMethod: "OCR_LAYOUT" | "TEXT_PARSE";
  /** Per-line text + confidence, when available, used to score individual facts. */
  lines: { text: string; confidence: number }[];
  thumbnailDataUrl?: string;
  /** Instruction-like phrases found in the raw text — flagged, never acted on. */
  injectionHits: string[];
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Renders a canvas to a compressed JPEG data URL for use as a thumbnail. */
function canvasToThumbnail(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function extractFromPdf(
  file: File,
  onProgress?: (p: ExtractionProgress) => void,
): Promise<RawExtractionResult> {
  onProgress?.({ stage: "reading", percent: 5, message: "Loading PDF…" });
  const pdfjsLib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let combinedText = "";
  const pageCount = pdf.numPages;
  let thumbnailDataUrl: string | undefined;

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    onProgress?.({
      stage: "parsing",
      percent: 10 + Math.round((pageNum / pageCount) * 50),
      message: `Reading page ${pageNum} of ${pageCount}…`,
    });
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    combinedText += `${pageText}\n`;

    if (pageNum === 1) {
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        thumbnailDataUrl = canvasToThumbnail(canvas);
      }
    }
  }

  const hasRealTextLayer = combinedText.replace(/\s/g, "").length > 20;

  if (hasRealTextLayer) {
    onProgress?.({ stage: "done", percent: 100, message: "Text layer extracted." });
    return {
      rawText: combinedText.trim(),
      ocrConfidence: 0.97,
      pages: pageCount,
      extractionMethod: "TEXT_PARSE",
      lines: linesOf(combinedText).map((text) => ({ text, confidence: 0.97 })),
      ...(thumbnailDataUrl !== undefined ? { thumbnailDataUrl } : {}),
      injectionHits: detectInjection(combinedText),
    };
  }

  // Scanned PDF with no text layer — fall back to OCR on the first-page render.
  if (!thumbnailDataUrl) {
    onProgress?.({ stage: "done", percent: 100, message: "Could not read this PDF." });
    return {
      rawText: "",
      ocrConfidence: 0,
      pages: pageCount,
      extractionMethod: "TEXT_PARSE",
      lines: [],
      injectionHits: [],
    };
  }
  onProgress?.({ stage: "ocr", percent: 65, message: "No text layer found — running OCR…" });
  const ocrResult = await ocrDataUrl(thumbnailDataUrl, (p) =>
    onProgress?.({
      stage: "ocr",
      percent: 65 + Math.round(p * 30),
      message: "Running OCR on scanned page…",
    }),
  );
  onProgress?.({ stage: "done", percent: 100, message: "OCR complete." });
  return {
    rawText: ocrResult.text.trim(),
    ocrConfidence: ocrResult.confidence,
    pages: pageCount,
    extractionMethod: "OCR_LAYOUT",
    lines: ocrResult.lines,
    thumbnailDataUrl,
    injectionHits: detectInjection(ocrResult.text),
  };
}

async function fileToImageDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

async function ocrDataUrl(
  dataUrl: string,
  onProgress?: (fraction: number) => void,
): Promise<{ text: string; confidence: number; lines: { text: string; confidence: number }[] }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number")
        onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(dataUrl, {}, { text: true, blocks: true });
    const lines = (data.blocks ?? [])
      .flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .map((line) => ({ text: line.text.trim(), confidence: line.confidence / 100 }))
      .filter((l) => l.text);
    return { text: data.text, confidence: (data.confidence ?? 0) / 100, lines };
  } finally {
    await worker.terminate();
  }
}

async function extractFromImage(
  file: File,
  onProgress?: (p: ExtractionProgress) => void,
): Promise<RawExtractionResult> {
  onProgress?.({ stage: "reading", percent: 10, message: "Loading image…" });
  const dataUrl = await fileToImageDataUrl(file);
  onProgress?.({ stage: "ocr", percent: 20, message: "Running OCR — this can take a moment…" });
  const result = await ocrDataUrl(dataUrl, (fraction) =>
    onProgress?.({
      stage: "ocr",
      percent: 20 + Math.round(fraction * 75),
      message: "Running OCR…",
    }),
  );
  onProgress?.({ stage: "done", percent: 100, message: "OCR complete." });
  return {
    rawText: result.text.trim(),
    ocrConfidence: result.confidence,
    pages: 1,
    extractionMethod: "OCR_LAYOUT",
    lines: result.lines,
    thumbnailDataUrl: dataUrl,
    injectionHits: detectInjection(result.text),
  };
}

/** Entry point: reads a file (PDF or image) and returns extracted text + metadata. */
export async function extractRawText(
  file: File,
  onProgress?: (p: ExtractionProgress) => void,
): Promise<RawExtractionResult> {
  if (isPdf(file)) return extractFromPdf(file, onProgress);
  return extractFromImage(file, onProgress);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CLASSIFICATION_KEYWORDS: { type: DocumentType; patterns: RegExp[] }[] = [
  {
    type: "PURCHASE_ORDER",
    patterns: [/purchase\s*order/i, /\bP\.?O\.?\s*(no|number|#)/i, /work\s*order/i],
  },
  { type: "GRN", patterns: [/goods\s*receipt/i, /\bGRN\b/i, /receipt\s*note/i] },
  {
    type: "DELIVERY_CHALLAN",
    patterns: [/delivery\s*challan/i, /\bDC\s*no/i, /dispatch\s*(note|challan)/i],
  },
  {
    type: "INVOICE",
    patterns: [/tax\s*invoice/i, /\binvoice\s*(no|number|#)/i, /\bbill\s*of\s*supply\b/i],
  },
  { type: "CREDIT_NOTE", patterns: [/credit\s*note/i] },
  {
    type: "PAYMENT_RECORD",
    patterns: [/neft/i, /rtgs/i, /payment\s*(advice|record|receipt)/i, /bank\s*credit/i],
  },
];

const FILENAME_HINTS: { type: DocumentType; patterns: RegExp[] }[] = [
  { type: "PURCHASE_ORDER", patterns: [/\bpo\b/i, /purchase.?order/i] },
  { type: "GRN", patterns: [/\bgrn\b/i, /goods.?receipt/i] },
  { type: "DELIVERY_CHALLAN", patterns: [/delivery/i, /challan/i, /\bdc\b/i] },
  { type: "INVOICE", patterns: [/invoice/i, /\binv\b/i, /bill/i] },
  { type: "CREDIT_NOTE", patterns: [/credit.?note/i] },
  { type: "PAYMENT_RECORD", patterns: [/payment/i, /neft/i, /credit.?advice/i] },
];

/** Guesses the document type from filename + a keyword scan of extracted text. Never blocking — always overridable. */
export function classifyDocumentType(fileName: string, rawText: string): DocumentType {
  for (const { type, patterns } of CLASSIFICATION_KEYWORDS) {
    if (patterns.some((p) => p.test(rawText))) return type;
  }
  for (const { type, patterns } of FILENAME_HINTS) {
    if (patterns.some((p) => p.test(fileName))) return type;
  }
  return "OTHER";
}

// ---------------------------------------------------------------------------
// Deterministic field extraction
// ---------------------------------------------------------------------------

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d?[A-Z]Z[A-Z\d]\b/;

interface FieldSpec {
  label: string;
  /** Applies only when the document is classified (or overridden) as one of these types. Omit to match any. */
  docTypes?: DocumentType[];
  pattern: RegExp;
  /** Extracts + cleans the matched value from the regex match. */
  parse: (match: RegExpMatchArray) => string | number | undefined;
  /** Base confidence for a clean regex match on a real text layer. */
  baseConfidence?: number;
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, "").trim());
}

const FIELD_SPECS: FieldSpec[] = [
  {
    label: "PO Number",
    pattern: /purchase\s*order\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9/-]{3,})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "PO Number",
    pattern: /\bP\.?O\.?\s*(?:no\.?|number|#)\s*[:-]?\s*([A-Z0-9/-]{3,})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Invoice Number",
    pattern: /(?:tax\s*invoice|invoice)\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9/-]{3,})/i,
    docTypes: ["INVOICE"],
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "GRN Number",
    pattern: /\bGRN\b\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9/-]{3,})/i,
    docTypes: ["GRN"],
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Delivery Number",
    pattern: /(?:delivery\s*challan|\bDC\b)\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9/-]{3,})/i,
    docTypes: ["DELIVERY_CHALLAN"],
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Ordered Quantity",
    pattern: /ordered\s*quantity\s*[:-]?\s*(\d+(?:\.\d+)?)/i,
    docTypes: ["PURCHASE_ORDER"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Delivered Quantity",
    pattern: /(?:dispatched|delivered)\s*quantity\s*[:-]?\s*(\d+(?:\.\d+)?)/i,
    docTypes: ["DELIVERY_CHALLAN"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Accepted Quantity",
    pattern: /accepted\s*quantity\s*[:-]?\s*(\d+(?:\.\d+)?)/i,
    docTypes: ["GRN"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Invoiced Quantity",
    pattern: /(?:invoiced\s*quantity|quantity)\s*[:-]?\s*(\d+(?:\.\d+)?)/i,
    docTypes: ["INVOICE"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Unit Price",
    pattern: /unit\s*price\s*[:-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i,
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Invoice Total",
    pattern:
      /(?:invoice\s*total|grand\s*total|total\s*amount|amount\s*payable)\s*[:-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i,
    docTypes: ["INVOICE"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Payment Amount",
    pattern: /amount\s*credited\s*[:-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i,
    docTypes: ["PAYMENT_RECORD"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "Credit Note Amount",
    pattern: /amount\s*[:-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i,
    docTypes: ["CREDIT_NOTE"],
    parse: (m) => toNumber(m[1] ?? ""),
  },
  {
    label: "PO Date",
    docTypes: ["PURCHASE_ORDER"],
    pattern:
      /(?:po\s*date|order\s*date|dated)\s*[:-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Delivery Date",
    docTypes: ["DELIVERY_CHALLAN"],
    pattern:
      /(?:delivery\s*date|dated)\s*[:-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "GRN Date",
    docTypes: ["GRN"],
    pattern:
      /(?:grn\s*date|dated)\s*[:-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Invoice Date",
    docTypes: ["INVOICE"],
    pattern:
      /(?:invoice\s*date|dated)\s*[:-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Due Date",
    docTypes: ["INVOICE"],
    pattern: /due\s*date\s*[:-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Buyer Name",
    pattern: /buyer\s*[:-]\s*([^\n]{3,60})/i,
    parse: (m) => m[1]?.trim(),
  },
  {
    label: "Supplier Name",
    pattern: /(?:supplier|seller|vendor)\s*[:-]\s*([^\n]{3,60})/i,
    parse: (m) => m[1]?.trim(),
  },
];

function lineContaining(
  lines: { text: string; confidence: number }[],
  needle: string,
): { text: string; confidence: number } | undefined {
  const lower = needle.toLowerCase();
  return lines.find((l) =>
    l.text.toLowerCase().includes(lower.slice(0, Math.min(24, lower.length))),
  );
}

function approximateBoundingBox(index: number): BoundingBox {
  return { x: 8 + ((index * 7) % 40), y: 14 + ((index * 11) % 60), w: 34, h: 5 };
}

let factSeq = 0;
function nextFactId(): string {
  factSeq += 1;
  return `uf${Date.now().toString(36)}${factSeq}`;
}

/**
 * Deterministic regex/heuristic field extraction — never an LLM call.
 * Confidence derives from the OCR/text-layer confidence: a real PDF text
 * layer gets a high base confidence, OCR'd content inherits the per-line
 * confidence Tesseract reported for the matching line (or the document's
 * overall OCR confidence when no line match is found).
 */
export function extractFacts(params: {
  sourceDocumentId: string;
  docType: DocumentType;
  rawText: string;
  lines: { text: string; confidence: number }[];
  extractionMethod: "OCR_LAYOUT" | "TEXT_PARSE";
  overallConfidence: number;
}): ExtractedFact[] {
  const { sourceDocumentId, docType, rawText, lines, extractionMethod, overallConfidence } = params;
  const facts: ExtractedFact[] = [];
  const seenLabels = new Set<string>();

  FIELD_SPECS.forEach((spec, index) => {
    if (spec.docTypes && !spec.docTypes.includes(docType)) return;
    if (seenLabels.has(spec.label)) return;
    const match = rawText.match(spec.pattern);
    if (!match) return;
    const value = spec.parse(match);
    if (value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value)))
      return;

    const matchedLine = lineContaining(lines, match[0]);
    const confidence =
      extractionMethod === "TEXT_PARSE"
        ? (spec.baseConfidence ?? 0.9)
        : (matchedLine?.confidence ?? overallConfidence);

    seenLabels.add(spec.label);
    facts.push({
      id: nextFactId(),
      label: spec.label,
      value,
      confidence,
      sourceDocumentId,
      sourcePage: 1,
      sourceSnippet: (matchedLine?.text ?? match[0]).slice(0, 160),
      boundingBox: approximateBoundingBox(index),
      extractionMethod,
      extractionVersion: EXTRACTION_VERSION,
    });
  });

  // GSTINs: scan every match, label by nearby keyword.
  const gstinRegex = new RegExp(GSTIN_PATTERN, "g");
  let gm: RegExpExecArray | null;
  let gstinIndex = 0;
  while ((gm = gstinRegex.exec(rawText)) !== null) {
    const value = gm[0];
    const contextStart = Math.max(0, gm.index - 40);
    const context = rawText.slice(contextStart, gm.index).toLowerCase();
    const label = /buyer|bill\s*to/.test(context)
      ? "Buyer GSTIN"
      : /supplier|seller|vendor/.test(context)
        ? "Supplier GSTIN"
        : "GSTIN";
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    const matchedLine = lineContaining(lines, value);
    facts.push({
      id: nextFactId(),
      label,
      value,
      confidence:
        extractionMethod === "TEXT_PARSE" ? 0.95 : (matchedLine?.confidence ?? overallConfidence),
      sourceDocumentId,
      sourcePage: 1,
      sourceSnippet: (matchedLine?.text ?? value).slice(0, 160),
      boundingBox: approximateBoundingBox(FIELD_SPECS.length + gstinIndex),
      extractionMethod,
      extractionVersion: EXTRACTION_VERSION,
    });
    gstinIndex += 1;
  }

  return facts;
}

/** Convenience: assembles a CaseDocument-shaped object from a completed extraction. */
export function buildCaseDocument(params: {
  id: string;
  type: DocumentType;
  fileName: string;
  pages: number;
  rawText: string;
  ocrConfidence: number;
  facts: ExtractedFact[];
}): CaseDocument {
  return {
    id: params.id,
    type: params.type,
    fileName: params.fileName,
    pages: params.pages,
    state: "EXTRACTED",
    ocrConfidence: params.ocrConfidence,
    hash: `sha256:${params.id}-${params.fileName.length.toString(16)}${params.rawText.length.toString(16)}`,
    rawText: params.rawText,
    facts: params.facts,
  };
}
