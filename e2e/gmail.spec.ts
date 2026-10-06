import { test, expect } from "@playwright/test";
import { reset, assertLocalRequests } from "./helpers";
import { sampleEmail, samplePdf } from "../src/lib/test-fixtures";

test("MBOX imports, real counters, accordion persistence and local protected PDF unlock", async ({ page, request }) => {
  await reset(request); assertLocalRequests(page);
  await page.goto("/");
  const gmail = page.getByRole("button", { name: /^Gmail import/ });
  await expect(gmail).toHaveAttribute("aria-expanded", "true");
  const ordinary = samplePdf(), locked = samplePdf("1234");
  const archive = Buffer.concat([
    sampleEmail([], "Ordinary message"),
    sampleEmail([{ filename: "synthetic.pdf", type: "application/pdf", content: ordinary }]),
    sampleEmail([{ filename: "duplicate.pdf", type: "application/pdf", content: ordinary }]),
    sampleEmail([{ filename: "protected.pdf", type: "application/pdf", content: locked }]),
  ]);
  await page.route("**/api/mbox", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.locator('input[type="file"]').setInputFiles({ name: "fixture.mbox", mimeType: "application/mbox", buffer: archive });
  await expect(gmail).toBeDisabled();
  await expect(gmail).toHaveAttribute("aria-expanded", "true");
  await expect(gmail).toContainText("4 emails", { timeout: 30000 });
  await expect(gmail).toContainText("3 attachments");
  await expect(gmail).toContainText("1 duplicates");
  await expect(gmail).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(gmail).toHaveAttribute("aria-expanded", "false");
  await gmail.click(); await expect(gmail).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("These payslips are password protected.", { exact: false })).toBeVisible();
  await page.getByLabel("Gmail payslip PIN").fill("wrong");
  await page.getByRole("button", { name: "Unlock payslips", exact: true }).click();
  await expect(page.getByText("0 payslips unlocked", { exact: false })).toBeVisible();
  await page.getByLabel("Gmail payslip PIN").fill("1234");
  await page.getByRole("button", { name: "Unlock payslips", exact: true }).click();
  await expect(page.getByText("1 payslip unlocked", { exact: false })).toBeVisible();
  const payslips = await (await request.get("/api/payslips")).json();
  expect(payslips).toHaveLength(2);
  expect(payslips.every((record: { attachment: unknown }) => record.attachment)).toBe(true);
  await page.reload(); await expect(gmail).toHaveAttribute("aria-expanded", "true");
  await reset(request);
});
