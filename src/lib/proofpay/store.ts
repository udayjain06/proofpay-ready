import { useSyncExternalStore } from "react";
import type { AuditEvent, CaseRecord, CommunicationStatus, IssueStatus } from "./types";

export interface AgentStep {
  agent:
    | "DOCUMENT INTAKE AGENT"
    | "DOCUMENT EXTRACTION"
    | "RECONCILIATION AGENT"
    | "RISK AGENT"
    | "ACCEPTANCE PACK AGENT"
    | "HUMAN CHECKPOINT";
  message: string;
  state: "ok" | "warn" | "pending";
  at: string;
}

export interface CaseState {
  agentSteps: AgentStep[];
  agentRunning: boolean;
  draft: string;
  communicationStatus: CommunicationStatus;
  issueStatus: Record<string, IssueStatus>;
  approvedAt?: string;
  approvedBy?: string;
}

interface Store {
  cases: Record<string, CaseState>;
  audit: AuditEvent[];
}

const store: Store = { cases: {}, audit: [] };
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStoreVersion() {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

export function ensureCaseState(caseId: string, draft: string): CaseState {
  let s = store.cases[caseId];
  if (!s) {
    s = {
      agentSteps: [],
      agentRunning: false,
      draft,
      communicationStatus: "DRAFT",
      issueStatus: {},
    };
    store.cases[caseId] = s;
  }
  return s;
}

export function getCaseState(caseId: string): CaseState | undefined {
  return store.cases[caseId];
}

export function getAudit(caseId?: string): AuditEvent[] {
  return store.audit.filter((a) => !caseId || a.caseId === caseId).slice().reverse();
}

let auditSeq = 0;
export function recordAudit(
  caseId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
) {
  auditSeq += 1;
  store.audit.push({
    id: `ae-${auditSeq}`,
    caseId,
    actor: "priya.nair@shaktiprecision.in (FINANCE_MANAGER)",
    action,
    resourceType,
    resourceId,
    ...(metadata ? { metadata } : {}),
    timestamp: new Date().toISOString(),
  });
  emit();
}

export function setDraft(caseId: string, draft: string) {
  const s = store.cases[caseId];
  if (!s) return;
  s.draft = draft;
  if (s.communicationStatus === "DRAFT") s.communicationStatus = "EDITING";
  emit();
}

export function setCommunicationStatus(caseId: string, status: CommunicationStatus) {
  const s = store.cases[caseId];
  if (!s) return;
  s.communicationStatus = status;
  if (status === "APPROVED") {
    s.approvedAt = new Date().toISOString();
    s.approvedBy = "priya.nair@shaktiprecision.in";
  }
  emit();
}

export function setIssueStatus(caseId: string, issueId: string, status: IssueStatus) {
  const s = store.cases[caseId];
  if (!s) return;
  s.issueStatus[issueId] = status;
  emit();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs the four agents in sequence with visible state transitions.
 * All conclusions come from the deterministic assessment, not from the agents.
 */
export async function runAgents(
  c: CaseRecord,
  summary: { facts: number; unsupported: number; criticalIssues: number; readiness: number },
) {
  const s = ensureCaseState(c.id, "");
  if (s.agentRunning) return;
  s.agentRunning = true;
  s.agentSteps = [];
  emit();

  const push = (step: Omit<AgentStep, "at">) => {
    s.agentSteps = [...s.agentSteps, { ...step, at: new Date().toISOString() }];
    emit();
  };

  push({ agent: "DOCUMENT INTAKE AGENT", message: "Classifying uploaded documents…", state: "pending" });
  await sleep(500);
  push({
    agent: "DOCUMENT INTAKE AGENT",
    message: `${c.documents.length} documents classified`,
    state: "ok",
  });
  recordAudit(c.id, "agent.run", "AgentRun", "document-intake");

  await sleep(400);
  push({ agent: "DOCUMENT EXTRACTION", message: `${summary.facts} facts extracted with sources`, state: "ok" });
  recordAudit(c.id, "extraction.completed", "Case", c.id, { facts: summary.facts });

  await sleep(400);
  push({ agent: "RECONCILIATION AGENT", message: "PO, delivery, GRN and invoice linked", state: "ok" });
  if (summary.unsupported > 0)
    push({
      agent: "RECONCILIATION AGENT",
      message: `GRN mismatch detected — ${summary.unsupported} units unsupported`,
      state: "warn",
    });

  await sleep(400);
  if (summary.criticalIssues > 0)
    push({ agent: "RISK AGENT", message: `${summary.criticalIssues} high-severity risk(s) created`, state: "warn" });
  else push({ agent: "RISK AGENT", message: "No high-severity risk detected", state: "ok" });
  recordAudit(c.id, "risk.evaluated", "Case", c.id, { critical: summary.criticalIssues });

  await sleep(400);
  push({
    agent: "ACCEPTANCE PACK AGENT",
    message: `Draft acceptance pack generated (readiness ${summary.readiness}/100)`,
    state: "ok",
  });
  recordAudit(c.id, "acceptance_pack.generated", "AcceptancePack", c.id);

  await sleep(300);
  push({ agent: "HUMAN CHECKPOINT", message: "Awaiting human review — nothing will be sent", state: "pending" });

  s.agentRunning = false;
  emit();
}
