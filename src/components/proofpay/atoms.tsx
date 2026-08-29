import { FileSearch } from "lucide-react";
import type { MatchResult, ReadinessStatus, Severity } from "@/lib/proofpay/types";

export function Pill({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warning" | "critical" | "info" | "accent";
  children: React.ReactNode;
}) {
  // Each tone is rendered as translucent glass — status color preserved, just made glassy
  const tones: Record<string, string> = {
    neutral:
      "bg-white/10 text-muted-foreground border-white/20 backdrop-blur-sm shadow-sm",
    success:
      "bg-success/15 text-success border-success/35 backdrop-blur-sm shadow-sm",
    warning:
      "bg-warning/20 text-warning-foreground border-warning/40 backdrop-blur-sm shadow-sm",
    critical:
      "bg-destructive/15 text-destructive border-destructive/35 backdrop-blur-sm shadow-sm",
    info:
      "bg-info/15 text-info border-info/35 backdrop-blur-sm shadow-sm",
    accent:
      "bg-accent/15 text-accent border-accent/35 backdrop-blur-sm shadow-sm",
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
      className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur-sm shadow-sm transition-all hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
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
    <div className="rounded-2xl border border-white/50 bg-white/40 p-4 shadow-lg backdrop-blur-md backdrop-saturate-150 [box-shadow:0_8px_32px_rgba(30,50,100,0.10),inset_0_1px_0_rgba(255,255,255,0.60)]">
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
    <section className="rounded-2xl border border-white/50 bg-white/40 shadow-lg backdrop-blur-md backdrop-saturate-150 [box-shadow:0_8px_32px_rgba(30,50,100,0.10),inset_0_1px_0_rgba(255,255,255,0.60)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/30 px-4 py-3">
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

