"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesCombined, FileText, GitCompareArrows, History, Settings2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Payslips", icon: FileText },
  { href: "/history", label: "History", icon: History },
  { href: "/statistics", label: "Statistics", icon: ChartNoAxesCombined },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/settings", label: "Data", icon: Settings2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link className="flex items-center gap-3 text-ink no-underline" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-white"><FileText size={19} strokeWidth={1.8} /></span>
            <span>
              <span className="block text-[15px] font-semibold tracking-[0.13em]">PAYSLIP</span>
              <span className="block text-[11px] text-muted">Your payslips, understood.</span>
            </span>
          </Link>
          <nav aria-label="Main navigation" className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" || pathname.startsWith("/payslips") : pathname === href;
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} aria-label={href === "/settings" ? "Data management" : label} className={`flex items-center gap-1.5 rounded-md px-2 py-2 text-[12px] transition-colors sm:px-3 sm:text-[13px] ${active ? "bg-[#edf2ee] font-medium text-accent" : "text-muted hover:bg-paper hover:text-ink"}`}>
                  <Icon size={15} strokeWidth={1.8} /><span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-145px)] max-w-6xl px-5 py-8 sm:px-8 sm:py-10">{children}</main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-5 text-xs text-muted sm:px-8">
        <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-accent" /> Everything stays on this computer.</span>
        <span>Stored locally on this computer.</span>
      </footer>
    </div>
  );
}
