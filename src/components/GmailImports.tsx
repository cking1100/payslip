"use client";

import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, LockKeyhole, Mail } from "lucide-react";
import { payPeriod, shortDate } from "@/lib/format";
import { LocalResponseError, readJsonResponse } from "@/lib/client-response";
import type { MboxProgress, MboxResult } from "@/lib/mbox-types";
import { gmailCollapsedKey, listenDataChanged, notifyDataChanged } from "@/lib/client-data";
import { gmailIsActive, initialGmailCollapsed } from "@/lib/gmail-state";

export type GmailImportsHandle = { upload: (file: File) => Promise<void> };

function PinForm({ result, onUpdated, onBusy }: { result: MboxResult; onUpdated: (result: MboxResult) => void; onBusy: (busy: boolean) => void }) {
  const protectedFiles = result.emails.flatMap((email) => email.attachments).filter((attachment) => attachment.status === "protected");
  const [pin, setPin] = useState("");
  const [applyAll, setApplyAll] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!protectedFiles.length) return message ? <p role="status" className="mt-4 text-sm text-accent">{message}</p> : null;

  async function unlock() {
    setBusy(true);
    onBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/mbox/${result.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, ...(!applyAll ? { attachmentId: selectedId || protectedFiles[0].id } : {}) }),
      });
      const data = await readJsonResponse<{ result?: MboxResult; unlocked?: number; error?: string }>(response);
      if (!response.ok || !data.result) throw new Error(data.error || "The protected payslips couldn't be unlocked.");
      const remaining = data.result.emails.flatMap((email) => email.attachments).filter((attachment) => attachment.status === "protected").length;
      const unlocked = data.unlocked ?? 0;
      setMessage(`✓ ${unlocked} payslip${unlocked === 1 ? "" : "s"} unlocked${remaining ? ` · ${remaining} ${remaining === 1 ? "needs" : "need"} a different PIN` : ""}`);
      onUpdated(data.result);
      notifyDataChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The PIN request couldn't reach the local server.");
    } finally {
      setPin("");
      setBusy(false);
      onBusy(false);
    }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void unlock(); }} className="mt-5 border-t border-line pt-4">
    <h3 className="flex items-center gap-2 text-sm font-medium"><LockKeyhole size={15} />These payslips are password protected.</h3>
    <p className="mt-1 text-xs text-muted">Enter the PIN to unlock locally. The PIN is never saved.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <label><span className="sr-only">Payslip password or PIN</span><input aria-label="Gmail payslip PIN" type="password" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} className="rounded-md border border-line px-3 py-2" placeholder="Password or PIN" /></label>
      <button disabled={!pin || busy} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Unlocking locally…" : "Unlock payslips"}</button>
    </div>
    <label className="mt-3 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={applyAll} onChange={(event) => setApplyAll(event.target.checked)} className="accent-accent" />Apply this PIN to all protected payslips</label>
    {!applyAll && <select aria-label="Protected attachment" value={selectedId || protectedFiles[0]?.id} onChange={(event) => setSelectedId(event.target.value)} className="mt-3 w-full rounded-md border border-line bg-white px-3 py-2">{protectedFiles.map((attachment, index) => <option key={attachment.id} value={attachment.id}>{index + 1}. {attachment.filename}</option>)}</select>}
    {message && <p role="status" className="mt-3 text-sm text-accent">{message}</p>}
  </form>;
}

export const GmailImports = forwardRef<GmailImportsHandle, { onImported: () => Promise<void> }>(function GmailImports({ onImported }, ref) {
  const [results, setResults] = useState<MboxResult[]>([]);
  const [progress, setProgress] = useState<Record<string, MboxProgress>>({});
  const [uploadStatus, setUploadStatus] = useState("");
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [pages, setPages] = useState<Record<string, number>>({});
  const loadGeneration = useRef(0);
  function rememberCollapsed(value: boolean) {
    setCollapsed(value);
    try { localStorage.setItem(gmailCollapsedKey, String(value)); }
    catch { setError("Your browser couldn't save the Gmail panel preference. Importing still works locally."); }
  }

  const updateResult = (result: MboxResult) => setResults((items) => [result, ...items.filter((item) => item.id !== result.id)]);
  useEffect(() => {
    const generation = loadGeneration.current;
    void fetch("/api/mbox").then(async (response) => {
      const data = await readJsonResponse<MboxResult[] | { error: string }>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error("Gmail import history couldn't be loaded.");
      if (generation !== loadGeneration.current) return;
      setResults(data);
      try { setCollapsed(location.hash === "#gmail-import" ? false : initialGmailCollapsed(data, localStorage.getItem(gmailCollapsedKey))); }
      catch { setCollapsed(initialGmailCollapsed(data, null)); setError("Your browser couldn't read the Gmail panel preference. Imports still work locally."); }
    }).catch(() => { if (generation === loadGeneration.current) setError("Gmail import history couldn't be loaded from the local server."); });
  }, []);
  useEffect(() => {
    if (location.hash === "#gmail-import") setCollapsed(false);
    const showFromLink = () => { if (location.hash === "#gmail-import") setCollapsed(false); };
    window.addEventListener("hashchange", showFromLink);
    const stop = listenDataChanged((cleared) => {
      if (cleared) {
        loadGeneration.current++;
        setResults([]); setProgress({}); setUploadStatus(""); setError(""); setErrorDetails("");
        setCollapsed(false); setUnlocking(false); setPages({});
      }
    });
    return () => { stop(); window.removeEventListener("hashchange", showFromLink); };
  }, []);

  const hasActiveImport = results.some((result) => ["processing", "unlocking"].includes(result.status));
  const active = gmailIsActive(results, Boolean(uploadStatus), unlocking);
  const expanded = active || !collapsed;
  useEffect(() => {
    if (!hasActiveImport) return;
    const timer = setInterval(() => {
      const generation = loadGeneration.current;
      void fetch("/api/mbox").then(async (response) => {
        const data = await readJsonResponse<MboxResult[]>(response);
        if (!response.ok || !Array.isArray(data)) throw new Error("Gmail import progress couldn't be loaded.");
        if (generation !== loadGeneration.current) return;
        setResults(data);
        if (!data.some((result) => ["processing", "unlocking"].includes(result.status))) await onImported();
      }).catch(() => setError("Gmail import progress couldn't be loaded. Reload to review its locally saved results."));
    }, 1500);
    return () => clearInterval(timer);
  }, [hasActiveImport, onImported]);

  useImperativeHandle(ref, () => ({
    async upload(file: File) {
      let id: string | undefined;
      let processing = false;
      setError("");
      setErrorDetails("");
      setUploadStatus("Uploading Gmail export to this computer…");
      setCollapsed(false);
      try {
        const created = await fetch("/api/mbox", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size: file.size }),
        });
        const session = await readJsonResponse<{ id?: string; chunkBytes?: number; error?: string }>(created);
        if (!created.ok || !session.id) throw new Error(session.error || "That MBOX couldn't be prepared for local import.");
        id = session.id;
        const chunkSize = session.chunkBytes ?? 4 * 1024 * 1024;
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
          const response = await fetch(`/api/mbox/${id}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": String(offset) }, body: chunk });
          const data = await readJsonResponse<{ error?: string }>(response);
          if (!response.ok) throw new Error(data.error || "The local Gmail upload was interrupted.");
          setUploadStatus(`Uploading Gmail export locally… ${Math.round(Math.min(offset + chunkSize, file.size) / file.size * 100)}%`);
        }
        const response = await fetch(`/api/mbox/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ process: true }) });
        if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
          const data = await readJsonResponse<{ error?: string }>(response);
          throw new Error(data.error || "That MBOX couldn't be read. It may be incomplete or corrupted.");
        }
        processing = true;
        setUploadStatus("Reading Gmail export…");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let finished = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const data = JSON.parse(line) as { progress?: MboxProgress; result?: MboxResult; error?: string };
              if (data.error) throw new Error(data.error);
              if (data.progress) setProgress((items) => ({ ...items, [id!]: data.progress! }));
              if (data.result) {
                updateResult(data.result);
                finished = true;
                if (data.result.status === "error") throw new Error(data.result.error || "That MBOX couldn't be read. It may be incomplete or corrupted.");
              }
            }
            if (done) break;
          }
        } finally {
          reader.releaseLock();
        }
        if (!finished) throw new Error("The Gmail import connection was interrupted. Its results remain local; reload to review the import.");
        await onImported();
        notifyDataChanged();
        rememberCollapsed(true);
      } catch (failure) {
        const message = failure instanceof Error && failure.name !== "TypeError" ? failure.message
          : "The Gmail upload couldn't reach the local server. Your MBOX has not left this computer.";
        setError(message);
        setErrorDetails(failure instanceof LocalResponseError ? failure.details : "");
        throw new Error(message);
      } finally {
        setUploadStatus("");
        if (id && !processing) await fetch(`/api/mbox/${id}`, { method: "DELETE" });
      }
    },
  }));

  const latest = results[0];
  return <section id="gmail-import" aria-label="Gmail imports" className="rounded-lg border border-line bg-white">
    <button type="button" aria-expanded={expanded} aria-controls="gmail-import-content" disabled={active} onClick={() => rememberCollapsed(!collapsed)} className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left hover:bg-paper sm:px-5">
      <span className="flex items-center gap-3"><Mail size={18} className="shrink-0 text-accent" /><span><span className="block text-sm font-semibold">Gmail import</span><span className="mt-0.5 block text-xs text-muted">{active ? "Import in progress on this computer" : latest ? `${latest.status === "complete" ? "Import complete" : "Import needs attention"} · ${latest.emailsScanned.toLocaleString()} emails · ${latest.attachmentsFound.toLocaleString()} attachments · ${latest.duplicatesSkipped.toLocaleString()} duplicates` : "Import your Gmail MBOX archive."}</span></span></span>
      <ChevronDown size={17} className={`shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
    <div id="gmail-import-content" hidden={!expanded} className="space-y-4 border-t border-line p-4 sm:p-5">
    {!latest && !uploadStatus && <p className="text-sm text-muted">Choose a Gmail Takeout .mbox file in the drop zone above. Messages and attachments are read entirely on this computer.</p>}
    {uploadStatus && <div role="status" className="rounded-lg border border-line bg-white p-5"><h2 className="text-xs font-semibold tracking-wide text-accent">GMAIL IMPORT</h2><p className="mt-2 text-sm">{uploadStatus}</p>{Object.entries(progress).slice(-1).map(([id, data]) => <p key={id} className="mt-1 text-xs text-muted">{data.stage} · Emails scanned: {data.emailsScanned.toLocaleString()} · Payslip attachments found: {data.attachmentsFound.toLocaleString()}</p>)}</div>}
    {error && <div role="alert" className="rounded-md border border-red-200 bg-white p-4 text-sm text-red-800"><p>{error}</p>{errorDetails && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Details</summary><p>{errorDetails}</p></details>}</div>}
    {results.map((result) => <div key={result.id} className="rounded-lg border border-line bg-white p-5">
      <h2 className="text-xs font-semibold tracking-wide text-accent">GMAIL IMPORT</h2>
      <p className="mt-2 flex items-center gap-2 font-medium">{result.status === "complete" ? <Check size={15} /> : <CircleAlert size={15} />}{result.status === "complete" ? "MBOX processed" : result.status === "error" ? "MBOX import needs attention" : "Gmail import in progress"}</p>
      <p className="mt-1 truncate text-xs text-muted">{result.filename}</p>
      {result.error && <p role="alert" className="mt-3 text-sm text-amber-800">{result.error}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          ["Emails scanned", result.emailsScanned], ["Payslip emails found", result.payslipEmailsFound],
          ["Payslip attachments found", result.attachmentsFound], ["Skipped", result.emailsSkipped], ["Duplicates", result.duplicatesSkipped],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="tabular mt-1 text-lg font-semibold">{Number(value).toLocaleString("en-GB")}</dd></div>)}
      </dl>
      {result.duplicatesSkipped > 0 && <p className="mt-3 text-xs text-muted">{result.duplicatesSkipped} duplicate payslips skipped.</p>}
      {result.malformedEmails > 0 && <p className="mt-2 text-xs text-amber-800">{result.malformedEmails} malformed email(s) could not be parsed and were skipped.</p>}
      <div className="mt-4 divide-y divide-line">
        {result.emails.flatMap((email) => email.attachments.map((attachment) => ({ email, attachment }))).slice((pages[result.id] || 0) * 12, (pages[result.id] || 0) * 12 + 12).map(({ email, attachment }) => <div key={attachment.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>{attachment.payslip ? <Link href={`/payslips/${attachment.payslip.id}`} className="font-medium text-accent hover:underline">{payPeriod(attachment.payslip.payDate || email.emailDate)}</Link> : <p className="font-medium">{payPeriod(email.emailDate)}</p>}
              <p className="mt-0.5 break-words text-xs text-muted">{attachment.filename} · {attachment.mimeType === "application/pdf" ? "PDF" : attachment.mimeType === "image/png" ? "PNG" : "JPG"}</p>
            </div>
            <p className={`text-xs ${attachment.status === "imported" ? "text-accent" : attachment.status === "error" ? "text-red-700" : "text-muted"}`}>{attachment.status === "protected" ? "🔒 Password protected" : attachment.status === "imported" ? "✓ Ready" : attachment.error || "Reading payslip…"}</p>
          </div>
          <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Details</summary><dl className="mt-2 space-y-1"><div>Sender: {email.sender || "Not available"}</div><div>Subject: {email.subject || "Not available"}</div><div>Email date: {shortDate(email.emailDate)}</div><div>Attachment size: {attachment.size.toLocaleString()} bytes</div>{attachment.error && <div>{attachment.error}</div>}<div>Import status: {attachment.status}</div></dl></details>
        </div>)}
      </div>
      {result.emails.reduce((sum, email) => sum + email.attachments.length, 0) > 12 && <div className="mt-3 flex items-center justify-end gap-3 text-xs">
        <button disabled={!pages[result.id]} onClick={() => setPages({ ...pages, [result.id]: (pages[result.id] || 0) - 1 })} className="rounded border border-line px-3 py-1 disabled:opacity-40">Previous</button>
        <span>Page {(pages[result.id] || 0) + 1} of {Math.ceil(result.emails.reduce((sum, email) => sum + email.attachments.length, 0) / 12)}</span>
        <button disabled={((pages[result.id] || 0) + 1) * 12 >= result.emails.reduce((sum, email) => sum + email.attachments.length, 0)} onClick={() => setPages({ ...pages, [result.id]: (pages[result.id] || 0) + 1 })} className="rounded border border-line px-3 py-1 disabled:opacity-40">Next</button>
      </div>}
      <PinForm result={result} onBusy={setUnlocking} onUpdated={(updated) => { updateResult(updated); void onImported(); }} />
    </div>)}
    </div>
  </section>;
});
