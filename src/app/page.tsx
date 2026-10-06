"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, FileUp, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { money, payPeriod } from "@/lib/format";
import type { Payslip } from "@/lib/types";
import { GmailImports, type GmailImportsHandle } from "@/components/GmailImports";
import { LocalResponseError, readJsonResponse } from "@/lib/client-response";
import { listenDataChanged, notifyDataChanged } from "@/lib/client-data";

type ImportRow = { id: string; file: File; state: "reading" | "done" | "locked" | "error"; message?: string; details?: string };

function prettyError(message: string): string {
  return message || "We couldn't read this payslip. It may be scanned or protected by a password.";
}

export default function Dashboard() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [pinQueue, setPinQueue] = useState<File[]>([]);
  const [pin, setPin] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const gmailRef = useRef<GmailImportsHandle>(null);
  const loadSequence = useRef(0);
  const loadPayslips = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const response = await fetch("/api/payslips", { cache: "no-store" });
      const data = await readJsonResponse<Payslip[] | { error: string }>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error("Payslips couldn't be loaded from local storage.");
      if (sequence === loadSequence.current) setPayslips(data);
    } catch (error) { if (sequence === loadSequence.current) setNotice(error instanceof Error ? error.message : "Payslips couldn't be loaded."); }
  }, []);

  useEffect(() => { void loadPayslips(); }, [loadPayslips]);
  useEffect(() => listenDataChanged((cleared) => {
    if (cleared) {
      setPayslips([]); setImports([]); setPinQueue([]); setPin(""); setApplyToAll(false);
      setNotice(""); setDragging(false); setBusy(false);
    }
    void loadPayslips();
  }), [loadPayslips]);

  function setFileState(file: File, state: ImportRow["state"], message?: string, details?: string) {
    setImports((rows) => rows.map((row) => row.file === file ? { ...row, state, message, details } : row));
  }

  async function uploadOne(file: File, secret?: string): Promise<"done" | "locked" | "error"> {
    setFileState(file, "reading");
    try {
      if (/\.mbox$/i.test(file.name)) {
        if (!gmailRef.current) throw new Error("The Gmail importer isn't ready yet. Please try again.");
        await gmailRef.current.upload(file);
        setFileState(file, "done", "MBOX processed — review Gmail import results below.");
        return "done";
      }
      if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) {
        setFileState(file, "error", "Please choose a PDF, JPG, PNG or MBOX.");
        return "error";
      }
      const form = new FormData();
      form.set("file", file);
      if (secret !== undefined) form.set("pin", secret);
      const response = await fetch("/api/payslips", { method: "POST", body: form });
      const result = await readJsonResponse<{ error?: string; requiresPin?: boolean; ocrUsed?: boolean; payslip?: Payslip; duplicate?: boolean }>(response);
      if (response.status === 423 && result.requiresPin) {
        setFileState(file, "locked", "PIN required");
        return "locked";
      }
      if (!response.ok) {
        setFileState(file, "error", prettyError(result.error ?? ""));
        return "error";
      }
      setFileState(file, "done", result.duplicate ? "Duplicate payslip skipped" : result.ocrUsed ? "Scanned page read locally" : "Processed");
      if (result.payslip) setPayslips((items) => [result.payslip!, ...items.filter((item) => item.id !== result.payslip!.id)]);
      if (result.ocrUsed) setNotice("This looks like a scanned payslip. We read the page on this computer.");
      notifyDataChanged();
      return "done";
    } catch (error) {
      setFileState(file, "error", error instanceof Error && error.name !== "TypeError" ? error.message
        : "The upload couldn't reach the local server. Start the app locally and choose the file again.",
      error instanceof LocalResponseError ? error.details : undefined);
      return "error";
    }
  }

  async function startImport(files: FileList | File[]) {
    const selected = Array.from(files);
    if (!selected.length) return;
    setNotice("");
    setImports((rows) => [...rows, ...selected.map((file) => ({ id: crypto.randomUUID(), file, state: "reading" as const }))]);
    setBusy(true);
    const locked: File[] = [];
    for (const file of selected) {
      const result = await uploadOne(file);
      if (result === "locked") locked.push(file);
    }
    if (locked.length) setPinQueue(locked);
    setBusy(false);
    await loadPayslips();
  }

  async function unlockQueue() {
    if (!pinQueue.length || !pin) return;
    setBusy(true);
    const [current, ...remaining] = pinQueue;
    const batch = applyToAll ? pinQueue : [current];
    const failed: File[] = [];
    for (const file of batch) {
      const result = await uploadOne(file, pin);
      if (result !== "done") failed.push(file);
    }
    setPin("");
    setPinQueue([...failed, ...(applyToAll ? [] : remaining)]);
    setBusy(false);
    await loadPayslips();
  }

  const recent = payslips.slice(0, 5);
  const chartValues = payslips.slice(0, 8).reverse();
  const chartMetrics = [
    { key: "netPay" as const, label: "Net pay" },
    { key: "grossPay" as const, label: "Gross pay" },
    { key: "tax" as const, label: "Tax" },
    { key: "nationalInsurance" as const, label: "National Insurance" },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-[24px] font-semibold tracking-tight">Your payslips</h1>
        <p className="mt-1 text-sm text-muted">A clear view of your pay, stored privately on this computer.</p>
      </section>

      <section
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy) setNotice("An import is already running. Wait for it to finish, then drop these files again.");
          else void startImport(event.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed px-6 py-8 transition-colors sm:px-8 ${dragging ? "border-accent bg-[#edf2ee]" : "border-[#cdd5ce] bg-white"}`}
      >
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#edf2ee] text-accent"><FileUp size={21} strokeWidth={1.7} /></span>
            <div>
              <h2 className="text-base font-semibold">Drop payslips or a Gmail export here</h2>
              <p className="mt-1 text-sm text-muted">PDF, JPG, PNG or MBOX</p>
              <p className="mt-1 text-xs text-muted">Documents up to 20 MB · Gmail exports up to 5 GB</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} className="text-accent" /> Everything is read and stored locally.</p>
            </div>
          </div>
          <button onClick={() => inputRef.current?.click()} disabled={busy} className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#305744] disabled:opacity-60">Choose files</button>
          <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.mbox,application/pdf,image/png,image/jpeg,application/mbox" className="hidden" onChange={(event) => { if (event.target.files) void startImport(event.target.files); event.currentTarget.value = ""; }} />
        </div>
      </section>

      {notice && <p role="status" className="rounded-md border border-[#d7e3d9] bg-[#edf2ee] px-4 py-3 text-sm text-accent">{notice}</p>}

      {imports.length > 0 && <section className="rounded-lg border border-line bg-white">
        <div className="border-b border-line px-5 py-4"><h2 className="font-semibold">Import activity</h2><p className="mt-0.5 text-xs text-muted">Files remain on this computer. Nothing is sent to an external service.</p></div>
        <ul className="divide-y divide-line">
          {imports.map((item) => <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
            <span className="mt-0.5 text-accent">
              {item.state === "done" ? <Check size={16} /> : item.state === "locked" ? <LockKeyhole size={16} /> : item.state === "error" ? <X size={16} className="text-red-600" /> : <span className="block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.file.name}</span>
              <span className={`block text-xs ${item.state === "error" ? "text-red-700" : "text-muted"}`}>{item.message ?? (item.state === "reading" ? "Reading payslip…" : item.state === "locked" ? "PIN required" : item.state === "done" ? "Processed" : "")}</span>
              {item.details && <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Details</summary><p className="mt-1">{item.details}</p></details>}
            </span>
          </li>)}
        </ul>
      </section>}

      <GmailImports ref={gmailRef} onImported={loadPayslips} />

      {pinQueue.length > 0 && <div role="dialog" aria-modal="true" aria-labelledby="pin-heading" className="fixed inset-0 z-20 grid place-items-center bg-[#18221e]/40 p-4">
        <form onSubmit={(event) => { event.preventDefault(); void unlockQueue(); }} className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-xl">
          <div className="mb-5 flex items-start justify-between">
            <div><span className="mb-3 grid h-9 w-9 place-items-center rounded-md bg-[#edf2ee] text-accent"><LockKeyhole size={17} /></span><h2 id="pin-heading" className="text-lg font-semibold">This PDF needs its PIN</h2><p className="mt-1 text-sm text-muted">The PIN is only used to unlock this file here. It is never saved.</p></div>
            <button type="button" onClick={() => { setPinQueue([]); setPin(""); }} aria-label="Close PIN dialog" className="rounded p-1 text-muted hover:bg-paper"><X size={18} /></button>
          </div>
          <p className="mb-3 truncate rounded bg-paper px-3 py-2 text-xs text-muted">{pinQueue[0]?.name}{pinQueue.length > 1 ? ` · and ${pinQueue.length - 1} more protected file(s)` : ""}</p>
          <label htmlFor="pdf-pin" className="mb-1.5 block text-sm font-medium">Password or PIN</label>
          <input id="pdf-pin" type="password" autoComplete="off" autoFocus value={pin} onChange={(event) => setPin(event.target.value)} className="w-full rounded-md border border-line px-3 py-2.5 outline-none focus:border-accent" />
          {pinQueue.length > 1 && <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-muted"><input type="checkbox" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} className="mt-1 accent-accent" />Apply this PIN to all {pinQueue.length} protected files.</label>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setPinQueue([]); setPin(""); }} className="rounded-md px-3 py-2 text-sm text-muted hover:bg-paper">Cancel</button><button disabled={!pin || busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Unlocking…" : "Unlock locally"}</button></div>
        </form>
      </div>}

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <div><h2 className="text-base font-semibold">Recent payslips</h2><p className="mt-0.5 text-xs text-muted">Only payslips you have imported appear here.</p></div>
          {payslips.length > 0 && <Link href="/history" className="text-sm font-medium text-accent hover:underline">View history</Link>}
        </div>
        {recent.length === 0 ? <div className="rounded-lg border border-line bg-white px-5 py-8 text-center">
          <p className="text-sm font-medium">No payslips yet</p><p className="mt-1 text-sm text-muted">Choose a file above to get started.</p>
        </div> : <div className="overflow-hidden rounded-lg border border-line bg-white">
          {recent.map((item, index) => <Link key={item.id} href={`/payslips/${item.id}`} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 text-ink no-underline transition-colors hover:bg-[#fbfcfa] ${index ? "border-t border-line" : ""}`}>
            <span><span className="block font-medium">{payPeriod(item.payDate, item.periodStart, item.periodEnd)}</span><span className="mt-0.5 block text-xs text-muted">{item.employer || item.filename}</span></span>
            <span className="flex gap-7 text-right">
              <span><span className="block text-[10px] font-medium tracking-wide text-muted">GROSS</span><span className="tabular block font-medium">{money(item.grossPay)}</span></span>
              <span><span className="block text-[10px] font-medium tracking-wide text-muted">NET</span><span className="tabular block font-medium">{money(item.netPay)}</span></span>
            </span>
          </Link>)}
        </div>}
      </section>

      {chartValues.length >= 2 && <section className="rounded-lg border border-line bg-white p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">Pay over time</h2><p className="mt-0.5 text-xs text-muted">Latest eight payslips. Only extracted values are shown.</p></div><Link href="/statistics" className="text-sm text-accent hover:underline">Explore statistics</Link></div>
        <div className="grid gap-6 sm:grid-cols-2">
          {chartMetrics.map(({ key, label }) => {
            const points = chartValues.filter((item) => item[key] !== null);
            const max = Math.max(1, ...points.map((item) => item[key] ?? 0));
            if (points.length < 2) return null;
            return <div key={key}><p className="mb-2 text-xs font-medium text-muted">{label}</p><div className="flex h-28 items-end gap-2 border-b border-line px-1">
              {points.map((item) => <div key={item.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                <span className="tabular text-[9px] text-muted">{money(item[key])}</span>
                <div className="w-full max-w-10 rounded-t-sm bg-accent/80" style={{ height: `${Math.max(5, ((item[key] ?? 0) / max) * 72)}%` }} />
                <span className="truncate text-[9px] text-muted">{payPeriod(item.payDate).split(" ")[0]}</span>
              </div>)}
            </div></div>;
          })}
        </div>
      </section>}

      <p className="flex items-center gap-2 text-xs text-muted"><CircleAlert size={14} /> Figures are extracted from your documents; check anything marked as needing attention.</p>
    </div>
  );
}
