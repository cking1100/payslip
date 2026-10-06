"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, ShieldCheck, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { readJsonResponse } from "@/lib/client-response";
import { clearClientData, listenDataChanged } from "@/lib/client-data";
import type { DataCounts } from "@/lib/data-management";

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(2)} MB`;
}
export default function SettingsPage() {
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const loadSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const result = await readJsonResponse<DataCounts | { error: string }>(response);
      if (!response.ok || !("payslips" in result)) throw new Error("error" in result ? result.error : "Storage counts couldn't be loaded.");
      if (sequence === loadSequence.current) { setCounts(result); setLoadError(""); }
    } catch (error) { if (sequence === loadSequence.current) { setCounts(null); setLoadError(error instanceof Error ? error.message : "Storage couldn't be inspected."); } }
  }, []);
  useEffect(() => { void refresh(); return listenDataChanged(() => void refresh()); }, [refresh]);
  const cancel = () => { if (!deleting) { setStep(0); setConfirmation(""); } };
  async function beginDelete() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const result = await readJsonResponse<DataCounts | { error: string }>(response);
      if (!response.ok || !("payslips" in result)) throw new Error("error" in result ? result.error : "Storage counts couldn't be verified.");
      setCounts(result); setConfirmation(""); setStep(1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Local storage couldn't be inspected."); }
    finally { setBusy(false); }
  }
  async function deleteAll() {
    if (confirmation !== "DELETE" || step !== 2 || deleting) return;
    setDeleting(true); setMessage("");
    try {
      const response = await fetch("/api/data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation, acknowledged: true }) });
      const result = await readJsonResponse<{ error?: string; deleted?: number; counts?: DataCounts }>(response);
      if (!response.ok || !result.counts) throw new Error(result.error || "Local data couldn't be cleared.");
      loadSequence.current++; setCounts(result.counts); setConfirmation(""); setStep(0);
      try { clearClientData(); } catch { setMessage("Local records and documents were deleted, but browser preferences could not be removed. Clear this site's browser storage."); return; }
      setMessage("All payslip data has been removed from this computer. You can import again.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Local data couldn't be cleared safely."); await refresh(); }
    finally { setDeleting(false); }
  }
  const countsGrid = counts && <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
    {[["Payslips", counts.payslips.toLocaleString()], ["Imported emails", counts.emails.toLocaleString()], ["Original documents", counts.originals.toLocaleString()], ["Attachments", counts.attachments.toLocaleString()], ["Gmail imports", counts.imports.toLocaleString()], ["Local storage used", bytes(counts.storageBytes)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="tabular mt-1 text-lg font-semibold">{value}</dd></div>)}
  </dl>;
  return <div className="max-w-3xl space-y-6">
    <header><h1 className="text-2xl font-semibold tracking-tight">Data management</h1><p className="mt-1 text-sm text-muted">Your local storage and privacy controls.</p></header>
    <section className="rounded-lg border border-line bg-white p-5 sm:p-6"><div className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-accent" size={19} /><div><h2 className="font-semibold">Private by design</h2><p className="mt-1 text-sm leading-relaxed text-muted">Documents, extracted values and PINs never leave this computer. No external OCR, cloud storage or AI service is used. PINs unlock locally and are never saved.</p></div></div></section>
    <section className="rounded-lg border border-line bg-white p-5 sm:p-6"><h2 className="mb-5 flex items-center gap-2 font-semibold"><HardDrive size={18} />Local storage</h2>
      {countsGrid || <p role={loadError ? "alert" : "status"} className="text-sm text-muted">{loadError || "Inspecting local storage..."}{loadError && <button onClick={() => void refresh()} className="ml-2 text-accent underline">Retry</button>}</p>}
      {counts && <p className="mt-4 text-xs text-muted">Documents: {bytes(counts.documentBytes)}. Database and journals: {bytes(counts.databaseBytes)}. Temporary / derived data: {bytes(counts.temporaryBytes)}. Storage total also includes the reusable local OCR language cache; it is not financial data. File sizes are measured on disk without following symbolic links.</p>}
      <div className="mt-5 border-t border-line pt-4"><Link href="/#gmail-import" className="text-sm font-medium text-accent hover:underline">Import a Gmail MBOX archive</Link><p className="mt-2 text-xs text-muted">SQLite records and generated-name originals are stored in the controlled local app data directory. No Gmail account is connected.</p></div>
    </section>
    <section className="rounded-lg border border-line bg-white p-5 sm:p-6"><h2 className="font-semibold">Clear all data</h2><p className="mt-1 text-sm leading-relaxed text-muted">Remove payslips, original documents, protected attachments, email metadata, import histories, duplicate hashes, temporary files and derived previews / caches. App code, configuration and the reusable OCR model are kept. This cannot be undone.</p>
      <button onClick={() => void beginDelete()} disabled={busy || deleting || !counts} className="mt-4 inline-flex items-center gap-2 rounded-md border border-red-200 px-3.5 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} />{busy ? "Checking local data..." : "Clear all data"}</button>
      {message && <p role="status" className="mt-4 text-sm text-muted">{message}</p>}
    </section>
    {step !== 0 && <Modal titleId="clear-data-heading" onClose={cancel} busy={deleting}>
      <p className="mb-2 text-xs font-medium text-muted">Confirmation {step} of 2</p><h2 id="clear-data-heading" className="text-lg font-semibold">{step === 1 ? "Remove all locally stored payslip data?" : "Type DELETE to confirm"}</h2>
      {step === 1 ? <><p className="my-4 text-sm leading-relaxed text-muted">This permanently removes all the records and documents counted below, including Gmail metadata, protected files, import results, previews, hashes and local temporary data. It does not delete anything in Gmail or remove this application. <strong className="text-red-800">This cannot be undone.</strong></p>{countsGrid}
        <div className="mt-6 flex justify-end gap-2"><button autoFocus type="button" onClick={cancel} className="rounded border border-line px-4 py-2 text-sm">Cancel</button><button type="button" onClick={() => setStep(2)} className="rounded border border-red-200 px-4 py-2 text-sm text-red-800">Continue to final confirmation</button></div></> :
        <><p className="mt-3 text-sm text-muted">The next button permanently deletes everything listed in the first confirmation. Type the exact word <strong>DELETE</strong>. Pressing Enter in this field will not delete anything.</p>
          <label className="mt-4 block text-sm font-medium">Confirmation<input autoFocus autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} className="mt-2 block w-full rounded border border-line px-3 py-2 font-mono" placeholder="DELETE" disabled={deleting} /></label>
          {message && <p role="alert" className="mt-3 text-sm text-red-800">{message}</p>}
          <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={deleting} onClick={cancel} className="rounded border border-line px-4 py-2 text-sm disabled:opacity-40">Cancel</button><button type="button" onClick={() => void deleteAll()} disabled={confirmation !== "DELETE" || deleting} className="rounded bg-red-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{deleting ? "Deleting locally..." : "Delete everything"}</button></div>
        </>}
    </Modal>}
  </div>;
}
