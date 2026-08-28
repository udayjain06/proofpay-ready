import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldQuestion } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/proofpay/shell";
import { MetricCard, ReadinessBadge, SectionCard, SeverityBadge } from "@/components/proofpay/atoms";
import { assessCase } from "@/lib/proofpay/engine";
import { CASES } from "@/lib/proofpay/seed";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ProofPay — Invoice acceptance readiness overview" },
      {
        name: "description",
        content:
          "Check invoice evidence before you chase payment: reconciliation, risk detection and human-approved clarifications for Indian MSME suppliers.",
      },
      { property: "og:title", content: "ProofPay — Check before you chase" },
      {
        property: "og:description",
        content:
          "Pre-dispute invoice acceptance intelligence: evidence readiness, deterministic reconciliation and a human approval gate.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const assessed = CASES.map((c) => ({ c, a: assessCase(c) }));
  const blocked = assessed.filter((x) => x.a.readinessStatus === "BLOCKED").length;
  const incomplete = assessed.filter((x) => x.a.readinessStatus === "INCOMPLETE").length;
  const clarification = assessed.filter((x) => x.a.readinessStatus === "NEEDS_CLARIFICATION").length;
  const ready = assessed.filter((x) => x.a.readinessStatus.startsWith("READY")).length;
  const criticalRisks = assessed.reduce(
    (s, x) => s + x.a.issues.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").length,
    0,
  );

  const mismatchCategories = Object.entries(
    assessed
      .flatMap((x) => x.a.issues)
      .reduce<Record<string, number>>((acc, i) => {
        acc[i.category] = (acc[i.category] ?? 0) + 1;
        return acc;
      }, {}),
  )
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const readinessDistribution = assessed.map((x) => ({
    name: x.c.code.replace("PP-2026-", ""),
    score: x.a.readinessScore,
    status: x.a.readinessStatus,
  }));

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Evidence readiness overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nine live cases across the seeded scenarios. Readiness is an operational signal, not legal
            certainty.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Active cases" value={CASES.length} hint="All scenarios seeded" />
          <MetricCard label="Ready for review" value={ready} hint="Human approval still required" />
          <MetricCard label="Blocked" value={blocked} hint="Blocking rule fired" />
          <MetricCard label="Needs clarification" value={clarification + incomplete} hint="Evidence gaps" />
          <MetricCard label="High/critical risks" value={criticalRisks} hint="Across all cases" />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Readiness distribution" description="Deterministic score out of 100">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={readinessDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                    {readinessDistribution.map((d) => (
                      <Cell
                        key={d.name}
                        fill={
                          d.score >= 85
                            ? "var(--success)"
                            : d.score >= 60
                              ? "var(--warning)"
                              : "var(--destructive)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="Top issue categories" description="Rule results grouped by category">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mismatchCategories} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={150}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Recent cases"
          description="Every conclusion below is computed by deterministic code"
          right={
            <Link to="/cases" className="text-xs font-medium text-accent hover:underline">
              View all cases
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Case</th>
                  <th className="pb-2 pr-3 font-medium">Buyer</th>
                  <th className="pb-2 pr-3 font-medium">Readiness</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Top risk</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {assessed.map(({ c, a }) => {
                  const top = [...a.issues].sort((x, y) =>
                    x.severity === "HIGH" || x.severity === "CRITICAL" ? -1 : y.severity === "HIGH" ? 1 : 0,
                  )[0];
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{c.code}</div>
                        <div className="text-xs text-muted-foreground">Scenario {c.scenario}</div>
                      </td>
                      <td className="py-3 pr-3">{c.buyer}</td>
                      <td className="py-3 pr-3 tabular-nums">{a.readinessScore}/100</td>
                      <td className="py-3 pr-3">
                        <ReadinessBadge status={a.readinessStatus} />
                      </td>
                      <td className="max-w-72 py-3 pr-3">
                        {top ? (
                          <div className="flex items-center gap-2">
                            <SeverityBadge severity={top.severity} />
                            <span className="truncate text-xs text-muted-foreground">{top.title}</span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <CheckCircle2 className="size-3.5" /> No open issues
                          </span>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <ShieldQuestion className="size-4 text-accent" /> Refusal to overclaim
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Facts, inferences, unknowns and contradictions are kept apart. Unsupported quantities are never
              presented as owed.
            </p>
          </div>
          <div className="rounded-lg border p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 text-warning" /> Deterministic maths
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Totals, comparisons, duplicate detection and readiness scoring are computed in code — never by a
              language model.
            </p>
          </div>
          <div className="rounded-lg border p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 text-success" /> Human approval gate
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Drafts become send-ready only after a recorded human approval. ProofPay never sends anything by
              itself.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
