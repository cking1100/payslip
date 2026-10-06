"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { money, payPeriod } from "@/lib/format";
import type { Payslip } from "@/lib/types";
import { listenDataChanged } from "@/lib/client-data";
import { readJsonResponse } from "@/lib/client-response";

const metrics: Array<{ key: keyof Payslip; label: string; currency?: boolean }> = [
  { key: "grossPay", label: "Gross pay", currency: true },
  { key: "netPay", label: "Net pay", currency: true },
  { key: "tax", label: "Tax", currency: true },
  { key: "nationalInsurance", label: "National Insurance", currency: true },
  { key: "pension", label: "Pension", currency: true },
  { key: "hoursWorked", label: "Hours worked" },
  { key: "hourlyRate", label: "BaseA hourly rate", currency: true },
];

function valueOf(record: Payslip, key: keyof Payslip): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

export default function ComparePage() {
  const [records, setRecords] = useState<Payslip[]>([]);
  const [previousId, setPreviousId] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let generation = 0;
    const load = async () => {
      const sequence = ++generation;
      try {
        const response = await fetch("/api/payslips", { cache: "no-store" });
        const items = await readJsonResponse<Payslip[] | { error: string }>(response);
        if (!response.ok || !Array.isArray(items)) throw new Error("Comparison data couldn't be loaded.");
        if (sequence !== generation) return;
        setRecords(items); setError("");
        setCurrentId((id) => items.some((item) => item.id === id) ? id : items[0]?.id ?? "");
        setPreviousId((id) => items.some((item) => item.id === id) ? id : items[1]?.id ?? "");
      } catch (failure) { if (sequence === generation) setError(failure instanceof Error ? failure.message : "Comparison data couldn't be loaded."); }
    };
    void load();
    return listenDataChanged((cleared) => { if (cleared) { setRecords([]); setCurrentId(""); setPreviousId(""); } void load(); });
  }, []);
  const previous = records.find((record) => record.id === previousId);
  const current = records.find((record) => record.id === currentId);

  return <div className="space-y-7">
    <div><h1 className="text-2xl font-semibold tracking-tight">Compare payslips</h1><p className="mt-1 text-sm text-muted">See how your pay has changed between two imported periods.</p></div>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {records.length < 2 ? <section className="rounded-lg border border-line bg-white px-5 py-10 text-center"><p className="font-medium">Two payslips are needed to compare.</p><p className="mt-1 text-sm text-muted">Import another payslip and come back here.</p></section> : <>
      <section className="grid gap-4 sm:grid-cols-2">
        {[{ label: "Previous", id: previousId, set: setPreviousId }, { label: "Current", id: currentId, set: setCurrentId }].map(({ label, id, set }) => <label key={label} className="rounded-lg border border-line bg-white p-4"><span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">{label} payslip</span><select value={id} onChange={(event) => set(event.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm">{records.map((record) => <option key={record.id} value={record.id}>{payPeriod(record.payDate, record.periodStart, record.periodEnd)} · {record.employer || record.filename}</option>)}</select></label>)}
      </section>
      {previous && current && previous.id === current.id && <p role="alert" className="text-sm text-amber-800">Choose two different payslips to compare.</p>}
      {previous && current && previous.id !== current.id && <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-2 border-b border-line bg-[#fbfcfa] px-4 py-3 text-xs font-medium text-muted sm:px-6">
          <span>Measure</span><span className="text-right">Previous</span><span className="text-right">Current</span><span className="text-right">Change</span>
        </div>
        {metrics.map(({ key, label, currency }) => {
          let before = valueOf(previous, key);
          let after = valueOf(current, key);
          if (key === "hourlyRate") {
            if (before === null && previous.grossPay !== null && previous.grossPay !== undefined && previous.hoursWorked && previous.hoursWorked > 0) before = previous.grossPay / previous.hoursWorked;
            if (after === null && current.grossPay !== null && current.grossPay !== undefined && current.hoursWorked && current.hoursWorked > 0) after = current.grossPay / current.hoursWorked;
          }
          const difference = before === null || after === null ? null : after - before;
          const percentage = difference === null || before === null || after === null || before === 0 ? null : difference / Math.abs(before) * 100;
          const Icon = difference === null || difference === 0 ? Minus : difference > 0 ? ArrowUp : ArrowDown;
          return <div key={key} className="grid grid-cols-[1.3fr_1fr_1fr_1fr] items-center gap-2 border-b border-line px-4 py-4 last:border-0 sm:px-6">
            <span className="text-sm font-medium">{label}</span>
            <span className="tabular text-right text-sm">{before === null ? "—" : currency ? money(before) : before.toLocaleString("en-GB")}</span>
            <span className="tabular text-right text-sm">{after === null ? "—" : currency ? money(after) : after.toLocaleString("en-GB")}</span>
            <span className={`tabular flex flex-col items-end text-right text-sm ${difference === null || difference === 0 ? "text-muted" : difference > 0 ? "text-accent" : "text-red-700"}`}>
              <span className="inline-flex items-center gap-0.5"><Icon size={13} />{difference === null ? "—" : `${difference > 0 ? "+" : ""}${currency ? money(difference) : difference.toFixed(2)}`}</span>
              <span className="text-[11px]">{percentage === null ? " " : `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`}</span>
            </span>
          </div>;
        })}
      </div>}
    </>}
  </div>;
}
