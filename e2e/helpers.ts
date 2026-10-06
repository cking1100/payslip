import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { samplePdf } from "../src/lib/test-fixtures";

export async function reset(request: APIRequestContext) {
  const counts = await request.get("/api/data");
  expect(counts.headers()["x-payslip-test-instance"], "Never delete a non-isolated instance").toBe("isolated-browser-test");
  const response = await request.delete("/api/data", { data: { confirmation: "DELETE", acknowledged: true } });
  expect(response.ok()).toBe(true);
}
export async function seed(request: APIRequestContext) {
  await reset(request);
  for (let index = 0; index < 3; index++) {
    const pdf = Buffer.from(samplePdf(undefined, ["Basic Pay 1500.00", "Overtime 500.00", "Overtime Hours 25.00", "Bonus 150.00", "Holiday Pay 50.00", "Employer Pension 100.00", "Tax Code: 1257L", "NI Category: A", "Student Loan Plan: 2", "Gross YTD 9000.00"]).toString("binary").replace("2100.00", `${index + 2}100.00`).replace("1780.00", `${index + 1}780.00`), "binary");
    const response = await request.post("/api/payslips", { multipart: { file: { name: `synthetic-${index}.pdf`, mimeType: "application/pdf", buffer: pdf } } });
    expect(response.ok()).toBe(true);
    const { payslip } = await response.json();
    const patch = await request.patch(`/api/payslips/${payslip.id}`, { data: {
      payDate: `2026-0${index + 1}-28`, employer: index === 2 ? "Second Fixture Ltd" : "Fixture Ltd",
      grossPay: (index + 2) * 1000, netPay: (index + 2) * (index < 2 ? 1200 : 800), tax: (index + 2) * 100,
      nationalInsurance: (index + 2) * 50, pension: (index + 2) * 50, studentLoan: 0, otherDeductions: 0, hoursWorked: 100,
    } });
    expect(patch.ok()).toBe(true);
  }
}
export function assertLocalRequests(page: Page) {
  page.on("request", (request) => {
    const url = new URL(request.url());
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname);
  });
}
