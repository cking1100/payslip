import { afterEach, describe, expect, it, vi } from "vitest";
import { clearClientData, gmailCollapsedKey } from "./client-data";

function storage(values: Record<string, string>) {
  const data = new Map(Object.entries(values));
  return { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());
describe("local client reset", () => {
  it("removes only payslip preferences and temporary state and broadcasts a full reset", () => {
    const local = storage({ [gmailCollapsedKey]: "true", "payslip-statistics-filters": "fixture", unrelated: "keep" });
    const session = storage({ "payslip-pin": "synthetic", unrelated: "keep" });
    const dispatchEvent = vi.fn(), postMessage = vi.fn(), close = vi.fn();
    vi.stubGlobal("localStorage", local); vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("BroadcastChannel", class { postMessage = postMessage; close = close; });
    clearClientData();
    expect(local.getItem(gmailCollapsedKey)).toBeNull();
    expect(local.getItem("payslip-statistics-filters")).toBeNull();
    expect(session.getItem("payslip-pin")).toBeNull();
    expect(local.getItem("unrelated")).toBe("keep");
    expect(dispatchEvent.mock.calls[0][0].detail.cleared).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ cleared: true });
    expect(close).toHaveBeenCalled();
  });
  it("still invalidates in-memory UI state if browser storage removal fails", () => {
    vi.stubGlobal("localStorage", { get length() { throw new Error("denied"); } });
    vi.stubGlobal("sessionStorage", storage({}));
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent }); vi.stubGlobal("BroadcastChannel", undefined);
    expect(() => clearClientData()).toThrow("denied");
    expect(dispatchEvent.mock.calls[0][0].detail.cleared).toBe(true);
  });
});
