import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clock,
  Loader2,
  Lock,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/proofpay/shell";
import {
  ConfidenceBadge,
  MatchBadge,
  Pill,
  ReadinessBadge,
  SectionCard,
  SeverityBadge,
  SourceReference,
} from "@/components/proofpay/atoms";
import { assessCase, money, netClaimable } from "@/lib/proofpay/engine";
import { buildAcceptancePack, draftClarification } from "@/lib/proofpay/pack";
import { CRITICAL_FIELDS } from "@/lib/proofpay/rules";
import { getCase } from "@/lib/proofpay/seed";
import {
  ensureCaseState,
  getAudit,
  getCaseState,
  recordAudit,
  runAgents,
  setCommunicationStatus,
  setDraft,
  setIssueStatus,
  useStoreVersion,
} from "@/lib/proofpay/store";
import type { CaseDocument, ExtractedFact } from "@/lib/proofpay/types";

export const Route = createFileRoute("/cases/$caseId")({
  loader: ({ params }) => {
    const c = getCase(params.caseId);
    if (!c) throw notFound();
    return { code: c.code, buyer: c.buyer };
  },
  head: ({ loaderData }) => {
    if (!loaderData)
      return { meta: [{ title: "Case unavailable — ProofPay" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.code} — ${loaderData.buyer} | ProofPay case workspace`;
    const description = `Evidence reconciliation, risks, acceptance pack and human approval for case ${loaderData.code}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: CaseWorkspace,
});

const TABS = [
  "Overview",
  "Documents",
  "Extraction",
  "Reconciliation",
  "Risks",
  "Evidence graph",
  "Timeline",
  "Acceptance pack",
  "Communications",
  "Audit",
] as const;

function CaseWorkspace() {
  const { caseId } = Route.useParams();
  const record = getCase(caseId)!;
  const assessment = useMemo(() => assessCase(record), [record]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [viewer, setViewer] = useState<{ doc: CaseDocument; fact?: ExtractedFact } | null>(null);
  useStoreVersion();

  const baseDraft = useMemo(() => draftClarification(record, assessment), [record, assessment]);

  useEffect(() => {
    ensureCaseState(record.id, baseDraft);
    const facts = record.documents.reduce((s, d) => s + d.facts.length, 0);
    const q = record.quantities;
    const unsupported =
      q.accepted !== undefined && q.invoiced !== undefined && q.invoiced > q.accepted
        ? q.invoiced - q.accepted
        : 0;
    void runAgents(record, {
      facts,
      unsupported,
      criticalIssues: assessment.issues.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL")
        .length,
      readiness: assessment.readinessScore,
    });
  }, [record, assessment, baseDraft]);

  const state = getCaseState(record.id);
  const openFact = (fact: ExtractedFact) => {
    const doc = record.documents.find((d) => d.id === fact.sourceDocumentId);
    if (doc) setViewer({ doc, fact });
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <Link to="/cases" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent">
          <ArrowLeft className="size-3" /> All cases
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{record.code}</h1>
              <ReadinessBadge status={assessment.readinessStatus} />
              <Pill tone={assessment.decision === "DO_NOT_SEND_YET" ? "critical" : "success"}>
                {assessment.decision === "DO_NOT_SEND_YET" ? "Do not send yet" : "Ready for human review"}
              </Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {record.buyer} · Invoice {record.invoiceNumber} · PO {record.poNumber}
            </p>
            <p className="mt-3 max-w-3xl rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
              {assessment.headline}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Readiness</div>
            <div className="text-3xl font-semibold tabular-nums">{assessment.readinessScore}</div>
            <div className="text-xs text-muted-foreground">operational signal, not legal certainty</div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "Overview" ? <OverviewTab record={record} assessment={assessment} openFact={openFact} /> : null}
            {tab === "Documents" ? <DocumentsTab record={record} onOpen={(d) => setViewer({ doc: d })} /> : null}
            {tab === "Extraction" ? <ExtractionTab record={record} openFact={openFact} /> : null}
            {tab === "Reconciliation" ? <ReconciliationTab assessment={assessment} record={record} /> : null}
            {tab === "Risks" ? <RisksTab record={record} assessment={assessment} /> : null}
            {tab === "Evidence graph" ? <GraphTab record={record} assessment={assessment} /> : null}
            {tab === "Timeline" ? <TimelineTab record={record} /> : null}
            {tab === "Acceptance pack" ? <PackTab record={record} assessment={assessment} /> : null}
            {tab === "Communications" ? (
              <CommunicationsTab record={record} assessment={assessment} baseDraft={baseDraft} />
            ) : null}
            {tab === "Audit" ? <AuditTab caseId={record.id} /> : null}
          </div>

          <aside className="space-y-4">
            <SectionCard title="Agent activity" description="Live orchestration state">
              <ul className="space-y-2 font-mono text-[11px]">
                {(state?.agentSteps ?? []).map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {s.state === "ok" ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                    ) : s.state === "warn" ? (
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    ) : (
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span>
                      <span className="font-semibold">{s.agent}</span>
                      <br />
                      <span className="text-muted-foreground">{s.message}</span>
                    </span>
                  </li>
                ))}
                {state?.agentRunning ? (
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> running…
                  </li>
                ) : null}
              </ul>
            </SectionCard>

            <SectionCard title="Open risks" description={`${assessment.issues.length} detected`}>
              <ul className="space-y-2">
                {assessment.issues.slice(0, 4).map((i) => (
                  <li key={i.id} className="rounded-md border p-2.5">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={i.severity} />
                      <span className="text-xs font-medium">{i.category}</span>
                    </div>
                    <p className="mt-1 text-xs">{i.title}</p>
                  </li>
                ))}
                {assessment.issues.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No issues detected.</li>
                ) : null}
              </ul>
            </SectionCard>

            <SectionCard title="Human actions">
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 p-2.5">
                  <Lock className="size-3.5 text-accent" />
                  Communication status: <strong>{state?.communicationStatus ?? "DRAFT"}</strong>
                </div>
                <button
                  onClick={() => setTab("Communications")}
                  className="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                >
                  Go to approval gate
                </button>
              </div>
            </SectionCard>
          </aside>
        </div>
      </div>

      {viewer ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setViewer(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{viewer.doc.fileName}</h3>
                <p className="text-xs text-muted-foreground">
                  {viewer.doc.type.replace(/_/g, " ")} · page {viewer.fact?.sourcePage ?? 1} · OCR{" "}
                  {Math.round(viewer.doc.ocrConfidence * 100)}%
                </p>
              </div>
              <button onClick={() => setViewer(null)} className="text-xs text-muted-foreground hover:text-accent">
                Close
              </button>
            </div>
            <div className="relative mt-4 rounded border bg-white p-4">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
                {highlight(viewer.doc.rawText, viewer.fact?.sourceSnippet)}
              </pre>
              {viewer.fact ? (
                <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-2 text-[11px]">
                  Highlighted region: x{viewer.fact.boundingBox.x} y{viewer.fact.boundingBox.y} w
                  {viewer.fact.boundingBox.w} h{viewer.fact.boundingBox.h} · extracted by{" "}
                  {viewer.fact.extractionMethod} ({viewer.fact.extractionVersion})
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function highlight(text: string, snippet?: string) {
  if (!snippet) return text;
  const idx = text.indexOf(snippet);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/40">{snippet}</mark>
      {text.slice(idx + snippet.length)}
    </>
  );
}

type Assessment = ReturnType<typeof assessCase>;
type Record_ = NonNullable<ReturnType<typeof getCase>>;

function OverviewTab({
  record,
  assessment,
  openFact,
}: {
  record: Record_;
  assessment: Assessment;
  openFact: (f: ExtractedFact) => void;
}) {
  const q = record.quantities;
  const facts = record.documents.flatMap((d) => d.facts);
  const findFact = (label: string) => facts.find((f) => f.label === label);

  const keyRows: { label: string; value: string; fact?: ExtractedFact }[] = [
    { label: "Ordered quantity", value: q.po === undefined ? "UNKNOWN" : `${q.po} NOS`, ...(findFact("Ordered Quantity") ? { fact: findFact("Ordered Quantity") } : {}) },
    { label: "Delivered quantity", value: q.delivered === undefined ? "UNKNOWN" : `${q.delivered} NOS`, ...(findFact("Delivered Quantity") ? { fact: findFact("Delivered Quantity") } : {}) },
    { label: "Accepted quantity (GRN)", value: q.accepted === undefined ? "UNKNOWN" : `${q.accepted} NOS`, ...(findFact("Accepted Quantity") ? { fact: findFact("Accepted Quantity") } : {}) },
    { label: "Invoiced quantity", value: `${q.invoiced} NOS`, ...(findFact("Invoiced Quantity") ? { fact: findFact("Invoiced Quantity") } : {}) },
    { label: "Invoice total", value: money(record.invoiceTotal), ...(findFact("Invoice Total") ? { fact: findFact("Invoice Total") } : {}) },
    { label: "Net claimable", value: money(netClaimable(record)) },
  ];

  return (
    <div className="space-y-4">
      <SectionCard title="Source-linked facts" description="Click any source chip to open the document at its page">
        <div className="grid gap-2 sm:grid-cols-2">
          {keyRows.map((r) => (
            <div key={r.label} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{r.label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{r.value}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.fact ? (
                  <>
                    <SourceReference
                      fileName={record.documents.find((d) => d.id === r.fact!.sourceDocumentId)?.fileName ?? ""}
                      page={r.fact.sourcePage}
                      snippet={r.fact.sourceSnippet}
                      onClick={() => openFact(r.fact!)}
                    />
                    <ConfidenceBadge
                      value={r.fact.confidence}
                      critical={CRITICAL_FIELDS.includes(r.fact.label)}
                    />
                  </>
                ) : (
                  <Pill tone="neutral">Derived by code</Pill>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Readiness breakdown" description="Deterministic scoring components">
        <div className="space-y-2">
          {assessment.breakdown.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-xs">
                <span>{b.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {b.score}/{b.max}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-muted">
                <div
                  className="h-1.5 rounded bg-primary"
                  style={{ width: `${(b.score / b.max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function DocumentsTab({ record, onOpen }: { record: Record_; onOpen: (d: CaseDocument) => void }) {
  return (
    <SectionCard title="Documents" description="Uploaded evidence is treated strictly as data">
      <div className="space-y-2">
        {record.documents.map((d) => (
          <button
            key={d.id}
            onClick={() => onOpen(d)}
            className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:border-accent"
          >
            <div>
              <div className="text-sm font-medium">{d.fileName}</div>
              <div className="text-xs text-muted-foreground">
                {d.type.replace(/_/g, " ")} · {d.pages} page(s) · {d.facts.length} facts · {d.hash.slice(0, 22)}…
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ConfidenceBadge value={d.ocrConfidence} />
              <Pill tone={d.state === "VERIFIED" ? "success" : "warning"}>{d.state}</Pill>
            </div>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

function ExtractionTab({ record, openFact }: { record: Record_; openFact: (f: ExtractedFact) => void }) {
  return (
    <SectionCard title="Extracted facts" description="Every fact carries document, page, snippet and confidence">
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
            {record.documents.flatMap((d) =>
              d.facts.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{f.label}</td>
                  <td className="py-2 pr-3 font-medium tabular-nums">{String(f.value)}</td>
                  <td className="py-2 pr-3">
                    <ConfidenceBadge value={f.confidence} critical={CRITICAL_FIELDS.includes(f.label)} />
                  </td>
                  <td className="py-2">
                    <SourceReference
                      fileName={d.fileName}
                      page={f.sourcePage}
                      snippet={f.sourceSnippet}
                      onClick={() => openFact(f)}
                    />
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function ReconciliationTab({ assessment, record }: { assessment: Assessment; record: Record_ }) {
  const q = record.quantities;
  const cols = [
    { label: "PO", value: q.po },
    { label: "Delivery", value: q.delivered },
    { label: "GRN accepted", value: q.accepted },
    { label: "Invoice", value: q.invoiced },
  ];
  return (
    <div className="space-y-4">
      <SectionCard title="Comparison view" description="PO | Delivery | GRN | Invoice">
        <div className="grid gap-2 sm:grid-cols-4">
          {cols.map((c) => (
            <div key={c.label} className="rounded-md border p-3 text-center">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {c.value === undefined ? "—" : c.value}
              </div>
              {c.value === undefined ? <Pill tone="neutral">Missing</Pill> : null}
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Reconciliation matrix" description="Computed by deterministic comparison code">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Pair</th>
                <th className="pb-2 pr-3 font-medium">Left</th>
                <th className="pb-2 pr-3 font-medium">Right</th>
                <th className="pb-2 pr-3 font-medium">Result</th>
                <th className="pb-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {assessment.reconciliation.map((r) => (
                <tr key={r.pair} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{r.pair}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.left}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.right}</td>
                  <td className="py-2 pr-3">
                    <MatchBadge result={r.result} />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function RisksTab({ record, assessment }: { record: Record_; assessment: Assessment }) {
  useStoreVersion();
  const state = getCaseState(record.id);
  return (
    <SectionCard title="Risks and issues" description="Waiving an issue records an audit event">
      <div className="space-y-3">
        {assessment.issues.map((i) => {
          const status = state?.issueStatus[i.id] ?? i.status;
          return (
            <div key={i.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={i.severity} />
                <Pill tone="neutral">{i.category}</Pill>
                <Pill tone={status === "WAIVED" ? "warning" : status === "RESOLVED" ? "success" : "info"}>
                  {status}
                </Pill>
              </div>
              <h3 className="mt-2 text-sm font-semibold">{i.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{i.description}</p>
              <p className="mt-2 text-xs">
                <strong>Recommended action:</strong> {i.recommendedAction}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Evidence: {i.evidence.join(", ")}</p>
              <div className="mt-3 flex gap-2">
                <button
                  className="rounded border px-2.5 py-1 text-xs hover:border-accent"
                  onClick={() => {
                    setIssueStatus(record.id, i.id, "ACKNOWLEDGED");
                    recordAudit(record.id, "risk.acknowledged", "Issue", i.id);
                  }}
                >
                  Acknowledge
                </button>
                <button
                  className="rounded border px-2.5 py-1 text-xs hover:border-accent"
                  onClick={() => {
                    const reason = window.prompt("Reason for waiving this issue (required)");
                    if (!reason) return;
                    setIssueStatus(record.id, i.id, "WAIVED");
                    recordAudit(record.id, "risk.waived", "Issue", i.id, { reason });
                    toast.success("Issue waived — audit event recorded");
                  }}
                >
                  Waive with reason
                </button>
              </div>
            </div>
          );
        })}
        {assessment.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issues detected for this case.</p>
        ) : null}
      </div>
    </SectionCard>
  );
}

function GraphTab({ record, assessment }: { record: Record_; assessment: Assessment }) {
  const nodes = [
    { id: "PO", label: `PO ${record.quantities.po ?? "—"}` },
    { id: "Delivery", label: `Delivery ${record.quantities.delivered ?? "—"}` },
    { id: "GRN", label: `GRN ${record.quantities.accepted ?? "—"}` },
    { id: "Invoice", label: `Invoice ${record.quantities.invoiced ?? "—"}` },
  ];
  const edgeFor = (pair: string) => assessment.reconciliation.find((r) => r.pair === pair);
  const edges = [
    { from: "PO", to: "Delivery", row: edgeFor("PO ↔ Delivery") },
    { from: "Delivery", to: "GRN", row: edgeFor("Delivery ↔ GRN") },
    { from: "GRN", to: "Invoice", row: edgeFor("GRN ↔ Invoice") },
  ];
  return (
    <SectionCard title="Evidence graph" description="Edges express support, partial support or contradiction">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {nodes.map((n, i) => (
            <div key={n.id} className="flex items-center gap-2">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-medium">{n.label}</div>
              {i < edges.length ? (
                <div className="text-center">
                  <CircleDot className="mx-auto size-3 text-muted-foreground" />
                  <MatchBadge result={edges[i]!.row?.result ?? "MISSING"} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <ul className="space-y-2 text-xs">
          {edges.map((e) => (
            <li key={`${e.from}-${e.to}`} className="rounded-md border p-3">
              <strong>
                {e.from} → {e.to}
              </strong>{" "}
              — {relation(e.row?.result)} · {e.row?.detail}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

function relation(result?: string) {
  switch (result) {
    case "MATCH":
      return "SUPPORTS";
    case "PARTIAL":
      return "PARTIALLY_SUPPORTS";
    case "MISMATCH":
      return "CONTRADICTS";
    default:
      return "MISSING_SUPPORT";
  }
}

function TimelineTab({ record }: { record: Record_ }) {
  const events = [
    { date: record.dates.po, label: "Purchase order issued", doc: "purchase-order.pdf" },
    ...(record.dates.delivery
      ? [{ date: record.dates.delivery, label: "Goods delivered", doc: "delivery-challan.pdf" }]
      : []),
    ...(record.dates.grn ? [{ date: record.dates.grn, label: "GRN recorded", doc: "goods-receipt-note.pdf" }] : []),
    { date: record.dates.invoice, label: "Invoice raised", doc: "tax-invoice.pdf" },
    { date: record.dates.due, label: "Payment due per terms", doc: "purchase-order.pdf" },
  ];
  return (
    <SectionCard title="Timeline" description="Each event links back to its source document">
      <ol className="space-y-3 border-l pl-4">
        {events.map((e) => (
          <li key={e.label} className="relative">
            <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-accent" />
            <div className="text-sm font-medium">{e.label}</div>
            <div className="text-xs text-muted-foreground">
              {e.date} · {e.doc}
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function PackTab({ record, assessment }: { record: Record_; assessment: Assessment }) {
  const sections = buildAcceptancePack(record, assessment);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ case: record.code, assessment, sections }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${record.code}-acceptance-pack.json`;
    a.click();
    URL.revokeObjectURL(url);
    recordAudit(record.id, "acceptance_pack.exported", "AcceptancePack", record.id, { format: "json" });
  };
  return (
    <SectionCard
      title="Acceptance pack"
      description="Buyer-ready packet — prepared, not sent"
      right={
        <div className="flex gap-2">
          <button onClick={exportJson} className="rounded border px-2.5 py-1 text-xs hover:border-accent">
            Export JSON
          </button>
          <button onClick={() => window.print()} className="rounded border px-2.5 py-1 text-xs hover:border-accent">
            Print / PDF
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {sections.map((s) => (
          <div key={s.title} className="rounded-md border p-4">
            <h3 className="text-sm font-semibold">{s.title}</h3>
            {s.body ? <p className="mt-1 text-sm text-muted-foreground">{s.body}</p> : null}
            {s.rows ? (
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {s.rows.map((r) => (
                  <div key={r.label} className="text-xs">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-medium">{r.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {s.list ? (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {s.list.map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function CommunicationsTab({
  record,
  assessment,
  baseDraft,
}: {
  record: Record_;
  assessment: Assessment;
  baseDraft: string;
}) {
  useStoreVersion();
  const state = ensureCaseState(record.id, baseDraft);
  const approved = state.communicationStatus === "APPROVED";

  return (
    <div className="space-y-4">
      <SectionCard title="Human approval center" description="No message leaves ProofPay without a recorded approval">
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <ShieldAlert className="size-3.5 text-accent" /> Recommendation
            </div>
            <p className="mt-1">{assessment.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Decision: {assessment.decision.replace(/_/g, " ")} · Readiness {assessment.readinessScore}/100 ·
              Basis: deterministic reconciliation of {record.documents.length} documents.
            </p>
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Status</div>
              <div className="font-semibold">{state.communicationStatus}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Sendable</div>
              <div className="font-semibold">{approved ? "Yes — after human approval" : "No"}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Approved by</div>
              <div className="font-semibold">{state.approvedBy ?? "—"}</div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Clarification draft" description="Neutral, evidence-based, never a legal threat">
        <textarea
          value={state.draft}
          onChange={(e) => setDraft(record.id, e.target.value)}
          rows={16}
          className="w-full rounded-md border bg-card p-3 font-mono text-xs outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
            onClick={() => {
              setCommunicationStatus(record.id, "PENDING_APPROVAL");
              recordAudit(record.id, "communication.submitted_for_approval", "Communication", record.id);
              toast.info("Submitted for human approval");
            }}
          >
            Submit for approval
          </button>
          <button
            className="rounded-md bg-success px-3 py-2 text-xs font-medium text-success-foreground disabled:opacity-40"
            disabled={state.communicationStatus !== "PENDING_APPROVAL"}
            onClick={() => {
              setCommunicationStatus(record.id, "APPROVED");
              recordAudit(record.id, "communication.approved", "Communication", record.id, {
                decision: "APPROVE",
                readinessScore: assessment.readinessScore,
                draftLength: state.draft.length,
              });
              toast.success("Approved — marked send-ready. ProofPay does not send it for you.");
            }}
          >
            Approve (mark send-ready)
          </button>
          <button
            className="rounded-md border px-3 py-2 text-xs font-medium hover:border-accent"
            onClick={() => {
              setCommunicationStatus(record.id, "DRAFT");
              recordAudit(record.id, "communication.held", "Communication", record.id, { decision: "HOLD" });
              toast.message("Held for further evidence");
            }}
          >
            Hold
          </button>
          <button
            className="rounded-md border px-3 py-2 text-xs font-medium hover:border-destructive"
            onClick={() => {
              const reason = window.prompt("Reason for rejection (required)");
              if (!reason) return;
              setCommunicationStatus(record.id, "CANCELLED");
              recordAudit(record.id, "communication.rejected", "Communication", record.id, {
                decision: "REJECT",
                reason,
              });
              toast.error("Draft rejected");
            }}
          >
            Reject
          </button>
        </div>
        {approved ? (
          <p className="mt-3 rounded-md border border-success/30 bg-success/10 p-3 text-xs">
            This clarification is now send-ready. It has NOT been sent — dispatch remains a manual action outside
            ProofPay.
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}

function AuditTab({ caseId }: { caseId: string }) {
  useStoreVersion();
  const events = getAudit(caseId);
  return (
    <SectionCard title="Audit trail" description="Append-only record of every meaningful action">
      <ul className="space-y-2 text-xs">
        {events.map((e) => (
          <li key={e.id} className="rounded-md border p-2.5">
            <div className="font-medium">{e.action}</div>
            <div className="text-muted-foreground">
              {new Date(e.timestamp).toLocaleString()} · {e.actor} · {e.resourceType}/{e.resourceId}
              {e.metadata ? ` · ${JSON.stringify(e.metadata)}` : ""}
            </div>
          </li>
        ))}
        {events.length === 0 ? <li className="text-muted-foreground">No events yet.</li> : null}
      </ul>
    </SectionCard>
  );
}
