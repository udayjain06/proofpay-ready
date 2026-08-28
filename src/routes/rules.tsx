import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/proofpay/shell";
import { SectionCard, SeverityBadge, Pill } from "@/components/proofpay/atoms";
import { RULES, RULE_VERSION } from "@/lib/proofpay/rules";
import { simulateRules } from "@/lib/proofpay/engine";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Rule library — ProofPay deterministic checks" },
      {
        name: "description",
        content:
          "Inspect every deterministic reconciliation, tax and acceptance rule ProofPay applies, and simulate outcomes before sending anything.",
      },
      { property: "og:title", content: "Rule library — ProofPay" },
      {
        property: "og:description",
        content: "Deterministic rules for quantity, price, tax and acceptance checks, with a live simulator.",
      },
    ],
  }),
  component: RulesPage,
});

function RulesPage() {
  const [po, setPo] = useState(100);
  const [delivered, setDelivered] = useState(100);
  const [accepted, setAccepted] = useState(80);
  const [invoiced, setInvoiced] = useState(100);

  const sim = simulateRules({ po, delivered, accepted, invoiced });

  const fields: { label: string; value: number; set: (n: number) => void }[] = [
    { label: "PO quantity", value: po, set: setPo },
    { label: "Delivered", value: delivered, set: setDelivered },
    { label: "Accepted (GRN)", value: accepted, set: setAccepted },
    { label: "Invoiced", value: invoiced, set: setInvoiced },
  ];

  return (
    <AppShell>
      <div className="space-y-5 p-5 lg:p-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rule library</h1>
          <p className="text-sm text-muted-foreground">
            {RULES.length} deterministic rules · version {RULE_VERSION}. No arithmetic is delegated to a model.
          </p>
        </div>

        <SectionCard title="Rule simulator" description="Change quantities to see which rules fire and the resulting action">
          <div className="grid gap-3 sm:grid-cols-4">
            {fields.map((f) => (
              <label key={f.label} className="text-xs text-muted-foreground">
                {f.label}
                <input
                  type="number"
                  value={f.value}
                  onChange={(e) => f.set(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Pill>Result: {sim.result}</Pill>
            {sim.fired.length === 0 ? (
              <span className="text-sm text-muted-foreground">No rules fired.</span>
            ) : (
              sim.fired.map((f) => (
                <span key={f.ruleId} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  <SeverityBadge severity={f.severity} />
                  {f.ruleId} · {f.action}
                </span>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="All rules" description="Category, severity and the action taken when the rule fires">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Rule</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.description}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.id}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{r.category.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3">
                      <SeverityBadge severity={r.severity} />
                    </td>
                    <td className="py-2 pr-3 text-xs">{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
