import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/proofpay/shell";
import { SectionCard } from "@/components/proofpay/atoms";
import { getAudit, useStoreVersion } from "@/lib/proofpay/store";
import { CASES } from "@/lib/proofpay/seed";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit trail — ProofPay approval history" },
      {
        name: "description",
        content:
          "Immutable record of every extraction, rule run, approval and communication decision made across invoice acceptance cases.",
      },
      { property: "og:title", content: "Audit trail — ProofPay" },
      {
        property: "og:description",
        content: "Every extraction, rule run, approval and send decision, recorded with actor and timestamp.",
      },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  useStoreVersion();
  const events = getAudit();
  const codeFor = (caseId: string) => CASES.find((c) => c.id === caseId)?.code ?? caseId;

  return (
    <AppShell>
      <div className="space-y-5 p-5 lg:p-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
          <p className="text-sm text-muted-foreground">
            Append-only history for this session. Nothing is sent without a recorded human approval.
          </p>
        </div>

        <SectionCard title="Events" description={`${events.length} recorded events`}>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet. Run the agents on a case to generate an audit history.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Case</th>
                    <th className="py-2 pr-3">Actor</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Resource</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(e.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{codeFor(e.caseId)}</td>
                      <td className="py-2 pr-3 text-xs">{e.actor}</td>
                      <td className="py-2 pr-3 font-medium">{e.action}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {e.resourceType} · {e.resourceId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
