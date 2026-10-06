import { describe, expect, it } from "vitest";
import { LocalResponseError, readJsonResponse } from "./client-response";

describe("upload error responses", () => {
  it("retains useful JSON errors from the local importer", async () => {
    const response = new Response(JSON.stringify({ error: "That MBOX couldn't be read." }), { status: 422, headers: { "Content-Type": "application/json" } });
    expect(await readJsonResponse(response)).toEqual({ error: "That MBOX couldn't be read." });
  });
  it("does not expose a server HTML response or a stack trace in the main error", async () => {
    const response = new Response("<html>private server details</html>", { status: 500, headers: { "Content-Type": "text/html" } });
    try {
      await readJsonResponse(response);
      throw new Error("Expected a local upload error.");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalResponseError);
      expect((error as LocalResponseError).message).toBe("The local server couldn't read this upload. Restart the local app and try again.");
      expect((error as LocalResponseError).details).toContain("HTTP 500");
      expect((error as LocalResponseError).details).not.toContain("private server details");
    }
  });
  it("reports oversized rejected uploads in plain English", async () => {
    await expect(readJsonResponse(new Response("Too large", { status: 413 }))).rejects.toThrow("The upload is too large for the local server.");
  });
});
