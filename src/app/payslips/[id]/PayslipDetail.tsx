"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Save, Trash2 } from "lucide-react";
import { exportCsv, money, shortDate } from "@/lib/format";
import type { Payslip } from "@/lib/types";
import { listenDataChanged, notifyDataChanged } from "@/lib/client-data";
import { calculateReconciliation } from "@/lib/statistics";

const amountFields = [
  ["grossPay", "Gross pay"], ["netPay", "Net pay"], ["tax", "Tax"], ["nationalInsurance", "National Insurance"],
  ["pension", "Pension"], ["studentLoan", "Student loan"], ["otherDeductions", "Other deductions"],
  ["hoursWorked", "BaseA hours worked"], ["hourlyRate", "BaseA hourly rate"], ["grossYtd", "Gross YTD"],
  ["taxYtd", "Tax YTD"], ["nationalInsuranceYtd", "NI YTD"], ["pensionYtd", "Pension YTD"], ["netYtd", "Net YTD"],
] as const;
type AmountKey = typeof amountFields[number][0];

function amountInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function amountOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, "").replace(/^£\s*/, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function MetricInput({ label, value, onChange, confidence, manuallyCorrected }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  confidence?: string;
  manuallyCorrected?: boolean;
}) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-muted">{label}{confidence === "Low" && <span className="ml-1 text-amber-700">· Needs checking</span>}</span>
    <input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Needs checking" className="tabular w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-[#a1a9a4]" />
    {manuallyCorrected && <span className="mt-1 block text-[11px] text-accent">✓ Manually corrected</span>}
  </label>;
}

export default function PayslipDetail({ id }: { id: string }) {
  const [record, setRecord] = useState<Payslip | null>(null);
  const [amounts, setAmounts] = useState<Record<AmountKey, string>>({} as Record<AmountKey, string>);
  const [employer, setEmployer] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [payDate, setPayDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [lineEdits, setLineEdits] = useState<Array<{ id: string; label: string; amount: string; ytdAmount: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const response = await fetch(`/api/payslips/${id}`);
    if (sequence !== loadSequence.current) return;
    if (!response.ok) { setMessage("This payslip could not be found in local storage."); return; }
    const item = await response.json() as Payslip;
    if (sequence !== loadSequence.current) return;
    setRecord(item);
    setAmounts(Object.fromEntries(amountFields.map(([key]) => [key, amountInput(item[key] as number | null)])) as Record<AmountKey, string>);
    setEmployer(item.employer ?? "");
    setEmployeeName(item.employeeName ?? "");
    setPayDate(item.payDate ? item.payDate.slice(0, 10) : "");
    setPeriodStart(item.periodStart ? item.periodStart.slice(0, 10) : "");
    setPeriodEnd(item.periodEnd ? item.periodEnd.slice(0, 10) : "");
    setLineEdits(item.lines.map((line) => ({ id: line.id, label: line.label, amount: amountInput(line.amount), ytdAmount: amountInput(line.ytdAmount) })));
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => listenDataChanged((cleared) => {
    if (cleared) { loadSequence.current++; setRecord(null); setMessage("This payslip was removed from local storage."); setLineEdits([]); setAmounts({} as Record<AmountKey, string>); setEmployeeName(""); setEmployer(""); setPayDate(""); setPeriodStart(""); setPeriodEnd(""); }
    else void load();
  }), [load]);
  if (!record) return <div className="py-10 text-sm text-muted">{message || "Loading payslip…"}</div>;

  async function save() {
    const numericValues = Object.fromEntries(amountFields.map(([key]) => [key, amountOrNull(amounts[key])]));
    if (Object.values(numericValues).some((value) => typeof value === "number" && Number.isNaN(value))) {
      setMessage("Enter a valid number for each amount.");
      return;
    }
    const lines = lineEdits.map((line) => ({
      id: line.id,
      label: line.label,
      amount: amountOrNull(line.amount),
      ytdAmount: amountOrNull(line.ytdAmount),
    }));
    if (lines.some((line) => Number.isNaN(line.amount) || Number.isNaN(line.ytdAmount))) {
      setMessage("Enter a valid number for each earnings and deduction line.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/payslips/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...numericValues, employer: employer || null, employeeName: employeeName || null, payDate: payDate || null, periodStart: periodStart || null, periodEnd: periodEnd || null, lines }),
      });
      const result = await response.json() as Payslip | { error?: string };
      if (!response.ok || !("lines" in result)) { setMessage("error" in result ? result.error ?? "We couldn't save these changes." : "We couldn't save these changes."); return; }
      setRecord(result);
      setMessage("Changes saved locally.");
      notifyDataChanged();
    } catch {
      setMessage("We couldn't save these changes. Check that the local app is running.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!record) return;
    if (!window.confirm(`Permanently delete ${record.filename} and its locally stored original?`)) return;
    const response = await fetch(`/api/payslips/${id}`, { method: "DELETE" });
    if (response.ok) { notifyDataChanged(); window.location.assign("/"); }
    else setMessage("We couldn't delete this payslip.");
  }

  function exportThis() {
    if (!record) return;
    const rows = record.lines.length ? record.lines.map((line) => ({
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
      confidence: line.confidence,
      manuallyCorrected: line.manuallyCorrected,
      sourceText: line.sourceText ?? "",
    })) : [{
      date: record.payDate ?? "",
      employer: record.employer ?? "",
      filename: record.filename,
      grossPay: record.grossPay ?? "",
      netPay: record.netPay ?? "",
      tax: record.tax ?? "",
      nationalInsurance: record.nationalInsurance ?? "",
      pension: record.pension ?? "",
    }];
    exportCsv(rows, `payslip-${record.id}.csv`);
  }

  const core = [
    { key: "grossPay", label: "GROSS PAY" },
    { key: "netPay", label: "NET PAY" },
    { key: "tax", label: "TAX" },
    { key: "nationalInsurance", label: "NATIONAL INSURANCE" },
    { key: "pension", label: "PENSION" },
  ] as const;
  const currentNumber = (key: AmountKey) => amounts[key] ? amountOrNull(amounts[key]) : null;
  const gross = currentNumber("grossPay");
  const net = currentNumber("netPay");
  const editedRecord = { ...record, ...Object.fromEntries(amountFields.map(([key]) => [key, currentNumber(key)])),
    lines: record.lines.map((line) => { const edit = lineEdits.find((item) => item.id === line.id); return edit ? { ...line, label: edit.label, amount: amountOrNull(edit.amount) } : line; }) };
  const reconciliation = calculateReconciliation([editedRecord]).checks[0]?.discrepancy ?? null;
  const sections = [
    { category: "earning", title: "Earnings" },
    { category: "deduction", title: "Deductions" },
    { category: "employer_contribution", title: "Employer contributions" },
    { category: "other", title: "Other lines" },
  ];
  const fieldFor = (key: string) => record.fields.find((field) => field.key === key);

  return <div className="space-y-7">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href="/history" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"><ArrowLeft size={14} />Payslip history</Link>
        <h1 className="text-2xl font-semibold tracking-tight">{record.employer || record.filename}</h1>
        <p className="mt-1 text-sm text-muted">{shortDate(record.payDate)} · {record.filename}</p>
      </div>
      <div className="flex gap-2">
        <button onClick={exportThis} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm"><Download size={14} />Export this payslip</button>
        <button onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-red-700"><Trash2 size={14} />Delete</button>
      </div>
    </div>

    {record.attachment && <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold">Gmail source</h2>
      <dl className="mt-2 space-y-1 break-words text-xs text-muted">
        <div>Sender: {record.attachment.email.sender || "Not available"}</div>
        <div>Subject: {record.attachment.email.subject || "Not available"}</div>
        <div>Email date: {shortDate(record.attachment.email.emailDate)}</div>
        <div>Original attachment: {record.attachment.filename}</div>
      </dl>
      {fieldFor("payDate")?.label === "Email date (fallback)" && <p className="mt-2 text-xs text-amber-800">Pay date came from the email. Check it against the payslip.</p>}
    </section>}
    <section className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
      {[{ key: "employer", label: "Employer", value: employer, change: setEmployer }, { key: "employeeName", label: "Employee name", value: employeeName, change: setEmployeeName }].map(({ key, label, value, change }) => <label key={key}><span className="mb-1 block text-xs font-medium text-muted">{label}</span><input value={value} onChange={(event) => change(event.target.value)} className="w-full rounded-md border border-line px-3 py-2 text-sm" /><span className="mt-1 block text-[11px] text-muted">{fieldFor(key)?.manuallyCorrected ? "✓ Manually corrected" : fieldFor(key)?.confidence ? `${fieldFor(key)?.confidence} confidence` : "Not identified"}</span></label>)}
      {[{ key: "payDate", label: "Pay date", value: payDate, change: setPayDate }, { key: "periodStart", label: "Period start", value: periodStart, change: setPeriodStart }, { key: "periodEnd", label: "Period end", value: periodEnd, change: setPeriodEnd }].map(({ key, label, value, change }) => <label key={key}><span className="mb-1 block text-xs font-medium text-muted">{label}</span><input type="date" value={value} onChange={(event) => change(event.target.value)} className="w-full rounded-md border border-line px-3 py-2 text-sm" /><span className={`mt-1 block text-[11px] ${fieldFor(key)?.confidence === "Low" ? "text-amber-700" : "text-muted"}`}>{fieldFor(key)?.manuallyCorrected ? "✓ Manually corrected" : fieldFor(key)?.confidence === "Low" ? "Needs checking" : fieldFor(key)?.confidence ? `${fieldFor(key)?.confidence} confidence` : "Not identified"}</span></label>)}
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {core.map(({ key, label }) => {
        const value = currentNumber(key as AmountKey);
        const field = fieldFor(key);
        return <div key={key} className="rounded-lg border border-line bg-white p-4">
          <span className="block text-[10px] font-semibold tracking-[0.09em] text-muted">{label}</span>
          <span className={`tabular mt-1 block text-lg font-semibold ${value === null ? "text-muted" : "text-ink"}`}>{value === null ? "Needs checking" : money(value)}</span>
          <span className="mt-1 block text-[11px] text-muted">{field?.confidence === "Low" ? "Check extracted value" : field?.manuallyCorrected ? "✓ Manually corrected" : field?.confidence ? `${field.confidence} confidence` : "Not found in document"}</span>
          <input aria-label={`Edit ${label.toLocaleLowerCase()}`} inputMode="decimal" value={amounts[key as AmountKey]} onChange={(event) => setAmounts((items) => ({ ...items, [key]: event.target.value }))} placeholder="Needs checking" className="tabular mt-2 w-full rounded-md border border-line px-2.5 py-2 text-sm placeholder:text-[#a1a9a4]" />
        </div>;
      })}
    </section>

    <section className="rounded-lg border border-line bg-white p-5 sm:p-6">
      <div className="mb-4"><h2 className="font-semibold">Earnings and deductions</h2><p className="mt-1 text-xs text-muted">Edit any value. The source text and original extraction are kept locally.</p></div>
      {record.lines.length === 0 ? <p className="py-5 text-sm text-muted">No individual pay lines were identified in this document.</p> : <div className="space-y-6">
        {sections.map(({ category, title }) => {
          const rows = lineEdits.map((edit) => ({ edit, line: record.lines.find((line) => line.id === edit.id)! })).filter(({ line }) => line.category === category);
          if (!rows.length) return null;
          return <div key={category}><h3 className="mb-2 text-sm font-medium">{title}</h3><div className="divide-y divide-line border-y border-line">
            {rows.map(({ edit, line }) => <div key={line.id} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(140px,1fr)_minmax(110px,160px)_minmax(110px,160px)_120px] sm:items-center">
              <div><input aria-label={`${title} label`} value={edit.label} onChange={(event) => setLineEdits((items) => items.map((item) => item.id === edit.id ? { ...item, label: event.target.value } : item))} className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium hover:border-line focus:border-accent" />
                <span className="ml-1 text-[11px] text-muted">{line.manuallyCorrected ? "✓ Manually corrected" : `${line.confidence} confidence`}</span>
                {line.confidence === "Low" && <span className="ml-1 text-[11px] text-amber-700">Needs checking</span>}
                {line.sourceText && <details className="mt-1 text-[11px] text-muted"><summary className="cursor-pointer">Original text</summary><p className="mt-1 break-words">{line.sourceText}</p></details>}
              </div>
              <label className="text-xs text-muted sm:hidden">Amount</label><input aria-label={`${edit.label} amount`} inputMode="decimal" value={edit.amount} onChange={(event) => setLineEdits((items) => items.map((item) => item.id === edit.id ? { ...item, amount: event.target.value } : item))} placeholder="Amount" className="tabular rounded-md border border-line px-3 py-2 text-sm sm:text-right" />
              <label className="text-xs text-muted sm:hidden">Year to date</label><input aria-label={`${edit.label} year to date`} inputMode="decimal" value={edit.ytdAmount} onChange={(event) => setLineEdits((items) => items.map((item) => item.id === edit.id ? { ...item, ytdAmount: event.target.value } : item))} placeholder="YTD amount" className="tabular rounded-md border border-line px-3 py-2 text-sm sm:text-right" />
              <span className="hidden text-right text-xs text-muted sm:block">{line.page ? `Page ${line.page}` : ""}</span>
            </div>)}
          </div></div>;
        })}
      </div>}
    </section>

    <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="font-semibold">Year to date</h2>
        <div className="mt-4 divide-y divide-line">{(["grossYtd", "taxYtd", "nationalInsuranceYtd", "pensionYtd", "netYtd"] as AmountKey[]).map((key) => <div key={key} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="text-muted">{amountFields.find(([candidate]) => candidate === key)![1]}</span><input aria-label={`Edit ${amountFields.find(([candidate]) => candidate === key)![1]}`} inputMode="decimal" value={amounts[key]} onChange={(event) => setAmounts((items) => ({ ...items, [key]: event.target.value }))} placeholder="Needs checking" className="tabular w-36 rounded-md border border-line px-2.5 py-1.5 text-right text-sm placeholder:text-xs placeholder:text-[#a1a9a4]" /></div>)}</div>
      </div>
      <div className="space-y-4 rounded-lg border border-line bg-white p-5">
        <div><h2 className="font-semibold">Pay checks</h2><p className="mt-1 text-xs text-muted">Helpful estimates, not official payroll calculations.</p></div>
        <div className="flex items-center justify-between border-b border-line pb-3 text-sm"><span className="text-muted">Effective hourly rate</span><span className="tabular font-medium">{gross !== null && Number(amounts.hoursWorked) > 0 ? money(gross / Number(amounts.hoursWorked)) : "Not enough information"}</span></div>
        <div className="flex items-center justify-between border-b border-line pb-3 text-sm"><span className="text-muted">Gross less net</span><span className="tabular font-medium">{gross !== null && net !== null ? money(gross - net) : "Not enough information"}</span></div>
        <div className="text-sm">
          <span className="block text-muted">Deductions reconciliation</span>
          <span className={`mt-1 block font-medium ${reconciliation !== null && Math.abs(reconciliation) < 0.01 ? "text-accent" : "text-ink"}`}>
            {reconciliation === null ? "Not enough explicit deduction information" : Math.abs(reconciliation) <= 0.01 ? "Payslip totals reconcile" : `${money(reconciliation)} difference — check deductions`}
          </span>
        </div>
      </div>
    </section>

    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="font-semibold">Other extracted figures</h2><p className="mt-1 text-xs text-muted">Blank values remain unknown; they are never treated as zero.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{amountFields.filter(([key]) => ["studentLoan", "otherDeductions", "hoursWorked", "hourlyRate"].includes(key)).map(([key, label]) => <MetricInput key={key} label={label} value={amounts[key]} onChange={(value) => setAmounts((items) => ({ ...items, [key]: value }))} confidence={fieldFor(key)?.confidence} manuallyCorrected={fieldFor(key)?.manuallyCorrected} />)}</div>
    </section>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-accent">{message}</p>
      <button onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Save size={15} />{busy ? "Saving…" : "Save changes locally"}</button>
    </div>
    <p className="text-xs text-muted">Original document is stored in the local app data folder. PINs are never stored.</p>
  </div>;
}
