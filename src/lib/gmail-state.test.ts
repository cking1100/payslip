import { describe, expect, it } from "vitest";
import { gmailIsActive, initialGmailCollapsed } from "./gmail-state";

describe("Gmail accordion state", () => {
  it("expands the initial importer even with a stale preference", () => {
    expect(initialGmailCollapsed([], "true")).toBe(false);
  });
  it("prefers completed imports collapsed and respects stored choices", () => {
    expect(initialGmailCollapsed([{ status: "complete" }], null)).toBe(true);
    expect(initialGmailCollapsed([{ status: "complete" }], "false")).toBe(false);
    expect(initialGmailCollapsed([{ status: "complete" }], "true")).toBe(true);
  });
  it("never hides running upload, processing or PIN progress", () => {
    expect(initialGmailCollapsed([{ status: "processing" }], "true")).toBe(false);
    expect(gmailIsActive([], true, false)).toBe(true);
    expect(gmailIsActive([], false, true)).toBe(true);
    expect(gmailIsActive([{ status: "unlocking" }], false, false)).toBe(true);
  });
  it("does not default error imports to collapsed", () => {
    expect(initialGmailCollapsed([{ status: "error" }], null)).toBe(false);
  });
});
