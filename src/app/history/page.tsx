"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Search, Trash2 } from "lucide-react";
import { exportCsv, money, shortDate } from "@/lib/format";
import type { Payslip } from "@/lib/types";
import { listenDataChanged, notifyDataChanged } from "@/lib/client-data";
import { readJsonResponse } from "@/lib/client-response";

type SortKey = "payDate" | "employer" | "grossPay" | "netPay" | "tax" | "nationalInsurance";

export default function HistoryPage() {
  const [records, setRecords] = useState<Payslip[]>([]);
  const [search, setSearch] = useState("");
  const [employer, setEmployer] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("payDate");
  const [ascending, setAscending] = useState(false);
  const [error, setError] = useState("");
  const loadSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const response = await fetch("/api/payslips", { cache: "no-store" });
      const data = await readJsonResponse<Payslip[] | { error: string }>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error("Couldn't load payslips from local storage.");
      if (sequence === loadSequence.current) { setRecords(data); setError(""); }
    } catch (error) { if (sequence === loadSequence.current) setError(error instanceof Error ? error.message : "Couldn't load payslips."); }
  }, []);

  useEffect(() => { void refresh(); return listenDataChanged((cleared) => {
    if (cleared) { setRecords([]); setSearch(""); setEmployer(""); setStartDate(""); setEndDate(""); setSortKey("payDate"); setAscending(false); }
    void refresh();
  }); }, [refresh]);

  const employers = [...new Set(records.map((record) => record.employer).filter((value): value is string => Boolean(value)))].sort();
  const shown = useMemo(() => records.filter((record) => {
    const query = search.trim().toLocaleLowerCase();
    const date = record.payDate ? new Date(record.payDate).getTime() : 0;
    return (!query || `${record.employer ?? ""} ${record.filename} ${record.employeeName ?? ""}`.toLocaleLowerCase().includes(query))
      && (!employer || record.employer === employer)
      && (!startDate || date >= new Date(`${startDate}T00:00:00`).getTime())
      && (!endDate || date <= new Date(`${endDate}T23:59:59`).getTime());
  }).sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
    return ascending ? comparison : -comparison;
  }), [records, search, employer, startDate, endDate, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending(!ascending);
    else { setSortKey(key); setAscending(true); }
  }

  async function remove(record: Payslip) {
    if (!window.confirm(`Delete ${record.filename} and its locally stored original? This cannot be undone.`)) return;
    const response = await fetch(`/api/payslips/${record.id}`, { method: "DELETE" });
    if (response.ok) { notifyDataChanged(); await refresh(); }
    else setError("We couldn't delete this payslip. Please try again.");
  }

  function exportAll() {
    const rows = shown.flatMap((record) => record.lines.length ? record.lines.map((line) => ({
      date: record.payDate ?? "",
      employer: record.employer ?? "",
      filename: record.filename,
      category: line.category,
      label: line.label,
      amount: line.amount ?? "",
      ytdAmount: line.ytdAmount ?? "",
      grossPay: record.grossPay ?? "",
      netPay: record.netPay ?? "",
      tax: record.tax ?? "",
      nationalInsurance: record.nationalInsurance ?? "",
      pension: record.pension ?? "",
      studentLoan: record.studentLoan ?? "",
      hoursWorked: record.hoursWorked ?? "",
      hourlyRate: record.hourlyRate ?? "",
      confidence: line.confidence,
      manuallyCorrected: line.manuallyCorrected,
      sourceText: line.sourceText ?? "",
    })) : [{
      date: record.payDate ?? "",
      employer: record.employer ?? "",
      filename: record.filename,
      category: "",
      label: "",
      amount: "",
      ytdAmount: "",
      grossPay: record.grossPay ?? "",
      netPay: record.netPay ?? "",
      tax: record.tax ?? "",
      nationalInsurance: record.nationalInsurance ?? "",
      pension: record.pension ?? "",
      studentLoan: record.studentLoan ?? "",
      hoursWorked: record.hoursWorked ?? "",
      hourlyRate: record.hourlyRate ?? "",
      confidence: "",
      manuallyCorrected: false,
      sourceText: "",
    }]);
    exportCsv(rows, "payslip-history.csv");
  }

  const headings: Array<{ key: SortKey; label: string }> = [
    { key: "payDate", label: "Date" }, { key: "employer", label: "Employer" }, { key: "grossPay", label: "Gross" },
    { key: "netPay", label: "Net" }, { key: "tax", label: "Tax" }, { key: "nationalInsurance", label: "NI" },
  ];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Payslip history</h1><p className="mt-1 text-sm text-muted">Search, sort and review everything stored locally.</p></div>
      <button onClick={exportAll} disabled={!shown.length} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3.5 py-2 text-sm font-medium disabled:opacity-50"><Download size={15} />Export CSV</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <section className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="relative sm:col-span-2"><span className="sr-only">Search payslips</span><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employer or filename" className="w-full rounded-md border border-line py-2 pl-9 pr-3 text-sm" /></label>
      <label><span className="sr-only">Filter employer</span><select value={employer} onChange={(event) => setEmployer(event.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"><option value="">All employers</option>{employers.map((name) => <option key={name}>{name}</option>)}</select></label>
      <div className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">From date</span><input aria-label="From date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-md border border-line px-2 py-2 text-sm" /></label><label className="min-w-0 flex-1"><span className="sr-only">To date</span><input aria-label="To date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-md border border-line px-2 py-2 text-sm" /></label></div>
    </section>
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[740px] border-collapse text-left text-sm">
        <thead><tr className="border-b border-line bg-[#fbfcfa] text-xs text-muted">{headings.map(({ key, label }) => <th key={key} className={`px-4 py-3 font-medium ${key !== "employer" ? "text-right" : ""}`}><button onClick={() => toggleSort(key)} className="hover:text-ink">{label}{sortKey === key ? ascending ? " ↑" : " ↓" : ""}</button></th>)}<th className="px-4 py-3 text-right font-medium"> </th></tr></thead>
        <tbody>
          {shown.map((record) => <tr key={record.id} className="border-b border-line last:border-0 hover:bg-[#fbfcfa]">
            <td className="px-4 py-3"><Link href={`/payslips/${record.id}`} className="font-medium text-ink hover:text-accent">{shortDate(record.payDate)}</Link><span className="mt-0.5 block max-w-40 truncate text-xs text-muted">{record.filename}</span></td>
            <td className="px-4 py-3">{record.employer || "—"}</td>
            {[record.grossPay, record.netPay, record.tax, record.nationalInsurance].map((value, index) => <td key={index} className="tabular px-4 py-3 text-right">{money(value)}</td>)}
            <td className="px-4 py-3 text-right"><button aria-label={`Delete ${record.filename}`} onClick={() => void remove(record)} className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-700"><Trash2 size={15} /></button></td>
          </tr>)}
          {!shown.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted">{records.length ? "No payslips match these filters." : "No payslips imported yet."}</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="text-xs text-muted">{shown.length} of {records.length} payslip{records.length === 1 ? "" : "s"}</p>
  </div>;
}
