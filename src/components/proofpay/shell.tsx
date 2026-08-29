import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  FileCheck2,
  FilePlus2,
  FileStack,
  Gavel,
  LayoutDashboard,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { DISCLAIMER, ORGANIZATION } from "@/lib/proofpay/seed";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/cases", label: "Cases", icon: FileStack },
  { to: "/cases/new", label: "New case", icon: FilePlus2 },
  { to: "/rules", label: "Rules", icon: Gavel },
  { to: "/audit", label: "Audit trail", icon: ScrollText },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — glass-sidebar applies backdrop-blur-lg + semi-transparent bg via CSS utility */}
      <aside className="glass-sidebar hidden w-60 shrink-0 flex-col text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5">
          <ShieldCheck className="size-5 text-sidebar-primary" />
          <div>
            <div className="text-sm font-semibold tracking-tight">ProofPay</div>
            <div className="text-[11px] text-sidebar-foreground/60">Check before you chase.</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent shadow-sm font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4 text-[11px] leading-relaxed text-sidebar-foreground/55">
          <div className="mb-1 font-medium text-sidebar-foreground/80">{ORGANIZATION.name}</div>
          GSTIN {ORGANIZATION.gstin}
          <div className="mt-2">Signed in as Priya Nair · FINANCE_MANAGER</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top header — frosted glass floating bar */}
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/40 bg-white/55 px-5 py-3 backdrop-blur-md backdrop-saturate-150 lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <ShieldCheck className="size-5 text-accent" />
            <span className="font-semibold">ProofPay</span>
          </div>
          <nav className="flex gap-4 text-sm lg:hidden">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="text-muted-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <ShieldAlert className="size-3.5 text-accent" />
            Nothing is sent without recorded human approval.
          </div>
          <div className="hidden items-center gap-4 text-xs text-muted-foreground lg:flex">
            <span className="flex items-center gap-1">
              <FileCheck2 className="size-3.5" /> Rule engine v1.0.0
            </span>
            <span className="flex items-center gap-1">
              <BarChart3 className="size-3.5" /> Deterministic scoring
            </span>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-5 py-6 lg:px-8">{children}</main>
        <footer className="border-t border-white/40 bg-white/45 px-5 py-4 text-[11px] leading-relaxed text-muted-foreground backdrop-blur-sm lg:px-8">
          {DISCLAIMER}
        </footer>
      </div>
    </div>
  );
}
