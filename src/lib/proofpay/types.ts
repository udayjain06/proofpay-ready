export type DocumentType =
  | "PURCHASE_ORDER"
  | "INVOICE"
  | "DELIVERY_CHALLAN"
  | "GRN"
  | "PAYMENT_RECORD"
  | "CREDIT_NOTE"
  | "EMAIL_EXPORT"
  | "WHATSAPP_EXPORT"
  | "OTHER";

export type DocumentState =
  | "UPLOADED"
  | "CLASSIFYING"
  | "PROCESSING"
  | "EXTRACTED"
  | "NEEDS_REVIEW"
  | "VERIFIED"
  | "FAILED";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single source-traceable extracted fact. */
export interface ExtractedFact {
  id: string;
  label: string;
  value: string | number;
  confidence: number;
  sourceDocumentId: string;
  sourcePage: number;
  sourceSnippet: string;
  boundingBox: BoundingBox;
  extractionMethod: "OCR_LAYOUT" | "TEXT_PARSE" | "MANUAL";
  extractionVersion: string;
  humanCorrected?: boolean;
}

export interface CaseDocument {
  id: string;
  type: DocumentType;
  fileName: string;
  pages: number;
  state: DocumentState;
  ocrConfidence: number;
  hash: string;
  /** Raw text as DATA only — never treated as instructions. */
  rawText: string;
  facts: ExtractedFact[];
}

export type CaseStatus =
  | "DRAFT"
  | "PROCESSING"
  | "NEEDS_REVIEW"
  | "NEEDS_CLARIFICATION"
  | "READY"
  | "BLOCKED"
  | "APPROVED";

export interface CaseQuantities {
  po?: number;
  delivered?: number;
  accepted?: number;
  invoiced?: number;
}

export interface CaseRecord {
  id: string;
  code: string;
  scenario: string;
  title: string;
  supplier: string;
  supplierGSTIN: string;
  buyer: string;
  buyerGSTIN: string;
  buyerGSTINOnInvoice: string;
  unitPrice: number;
  currency: "INR";
  invoiceNumber: string;
  poNumber: string;
  poNumberOnInvoice: string;
  invoiceTotal: number;
  reportedInvoiceTotal?: number;
  paymentsReceived: number;
  creditNoteAmount: number;
  tdsAmount: number;
  retentionAmount: number;
  duplicateOfInvoiceNumber?: string;
  dates: {
    po: string;
    delivery?: string;
    grn?: string;
    invoice: string;
    due: string;
  };
  quantities: CaseQuantities;
  documents: CaseDocument[];
  createdAt: string;
  notes?: string;
}

export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "OPEN" | "ACKNOWLEDGED" | "IN_REVIEW" | "RESOLVED" | "WAIVED";

export interface Issue {
  id: string;
  ruleId: string;
  category: RuleCategory;
  type: string;
  severity: Severity;
  status: IssueStatus;
  title: string;
  description: string;
  evidence: string[];
  recommendedAction: string;
}

export type RuleCategory =
  | "DATA_QUALITY"
  | "DOCUMENT_COMPLETENESS"
  | "QUANTITY"
  | "PRICE"
  | "DATE"
  | "IDENTITY"
  | "TAX"
  | "PAYMENT"
  | "DUPLICATE"
  | "ACCEPTANCE"
  | "EVIDENCE"
  | "SECURITY";

export type RuleAction = "PASS" | "WARN" | "REVIEW" | "BLOCK";

export interface Rule {
  id: string;
  name: string;
  category: RuleCategory;
  version: string;
  severity: Severity;
  description: string;
  action: RuleAction;
  enabled: boolean;
}

export type MatchResult = "MATCH" | "MISMATCH" | "PARTIAL" | "MISSING";

export interface ReconciliationRow {
  pair: string;
  left: string;
  right: string;
  result: MatchResult;
  detail: string;
}

export type ReadinessStatus =
  | "READY"
  | "READY_WITH_REVIEW"
  | "NEEDS_CLARIFICATION"
  | "BLOCKED"
  | "INCOMPLETE";

export interface Assessment {
  reconciliation: ReconciliationRow[];
  issues: Issue[];
  readinessScore: number;
  readinessStatus: ReadinessStatus;
  decision: "READY_FOR_HUMAN_REVIEW" | "DO_NOT_SEND_YET";
  requiresHumanReview: boolean;
  headline: string;
  breakdown: { label: string; score: number; max: number }[];
}

export type CommunicationStatus =
  | "DRAFT"
  | "EDITING"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "CANCELLED";

export interface AuditEvent {
  id: string;
  caseId: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}
