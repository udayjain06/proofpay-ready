import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { AppShell } from "@/components/proofpay/shell";
import { ReadinessBadge, SectionCard } from "@/components/proofpay/atoms";
import { assessCase, money } from "@/lib/proofpay/engine";
import { CASES } from "@/lib/proofpay/seed";

export const Route = createFileRoute("/cases")({
  head: () => ({
    meta: [
      { title: "Cases — ProofPay evidence readiness" },
      {
        name: "description",
        content:
          "Browse invoice acceptance cases with readiness scores, open risks and reconciliation status across buyers.",
      },
      { property: "og:title", content: "Cases — ProofPay" },
      {
        property: "og:description",
        content: "Invoice acceptance cases with readiness scores, risks and reconciliation status.",
      },
    ],
  }),
  component: CasesPage,
});

function CasesPage() {
  const [query, setQuery] = useState("");
  const rows = CASES.map((c) => ({ c, a: assessCase(c) })).filter(({ c }) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.code, c.buyer, c.invoiceNumber, c.poNumber, c.buyerGSTIN, c.scenario]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Cases</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Search across case ID, buyer, invoice number, PO number or GSTIN.
            </p>
          </div>
          <label className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cases…"
              className="w-full rounded-md border bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>

        <SectionCard title={`${rows.length} case(s)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Case</th>
                  <th className="pb-2 pr-3 font-medium">Buyer</th>
                  <th className="pb-2 pr-3 font-medium">Invoice</th>
                  <th className="pb-2 pr-3 font-medium">PO / Del / GRN / Inv</th>
                  <th className="pb-2 pr-3 font-medium">Amount</th>
                  <th className="pb-2 pr-3 font-medium">Readiness</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, a }) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{c.code}</div>
                      <div className="text-xs text-muted-foreground">
                        Scenario {c.scenario} · {c.title}
                      </div>
                    </td>
                    <td className="py-3 pr-3">{c.buyer}</td>
                    <td className="py-3 pr-3 text-xs">{c.invoiceNumber}</td>
                    <td className="py-3 pr-3 tabular-nums text-xs">
                      {[c.quantities.po, c.quantities.delivered, c.quantities.accepted, c.quantities.invoiced]
                        .map((v) => (v === undefined ? "—" : v))
                        .join(" / ")}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-xs">{money(c.invoiceTotal)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-xs">{a.readinessScore}</span>
                        <ReadinessBadge status={a.readinessStatus} />
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        to="/cases/$caseId"
                        params={{ caseId: c.id }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        Open <ArrowRight className="size-3" />
                      </Link>
                    </td>
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
