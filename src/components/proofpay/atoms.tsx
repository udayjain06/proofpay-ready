import { FileSearch } from "lucide-react";
import type { MatchResult, ReadinessStatus, Severity } from "@/lib/proofpay/types";

export function Pill({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warning" | "critical" | "info" | "accent";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground border-border",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/15 text-warning-foreground border-warning/40",
    critical: "bg-destructive/10 text-destructive border-destructive/30",
    info: "bg-info/10 text-info border-info/30",
    accent: "bg-accent/10 text-accent border-accent/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone =
    severity === "CRITICAL" || severity === "HIGH"
      ? "critical"
      : severity === "MEDIUM"
        ? "warning"
        : severity === "LOW"
          ? "info"
          : "neutral";
  return <Pill tone={tone as never}>{severity}</Pill>;
}

export function MatchBadge({ result }: { result: MatchResult }) {
  const tone =
    result === "MATCH"
      ? "success"
      : result === "MISMATCH"
        ? "critical"
        : result === "PARTIAL"
          ? "warning"
          : "neutral";
  return <Pill tone={tone as never}>{result}</Pill>;
}

export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  const tone =
    status === "READY"
      ? "success"
      : status === "READY_WITH_REVIEW"
        ? "info"
        : status === "BLOCKED"
          ? "critical"
          : "warning";
  return <Pill tone={tone as never}>{status.replace(/_/g, " ")}</Pill>;
}

export function ConfidenceBadge({ value, critical }: { value: number; critical?: boolean }) {
  const threshold = critical ? 0.9 : 0.75;
  const tone = value >= threshold ? "success" : value >= 0.6 ? "warning" : "critical";
  return <Pill tone={tone as never}>{Math.round(value * 100)}% confidence</Pill>;
}

export function SourceReference({
  fileName,
  page,
  snippet,
  onClick,
}: {
  fileName: string;
  page: number;
  snippet: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={snippet}
      className="inline-flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
    >
      <FileSearch className="size-3" />
      {fileName} · p{page}
    </button>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  right,
  children,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
