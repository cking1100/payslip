import type { MboxResult } from "./mbox-types";

export function gmailIsActive(results: Pick<MboxResult, "status">[], uploading: boolean, unlocking: boolean): boolean {
  return uploading || unlocking || results.some((result) => ["uploading", "writing", "processing", "unlocking"].includes(result.status));
}
export function initialGmailCollapsed(results: Pick<MboxResult, "status">[], preference: string | null): boolean {
  if (!results.length || gmailIsActive(results, false, false)) return false;
  return preference !== null ? preference === "true" : results[0].status === "complete";
}
