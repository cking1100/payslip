import { describe, expect, it } from "vitest";
import { parsePayslip } from "./parser";

describe("parsePayslip", () => {
  it("recognises common UK pay and deduction labels with formatted amounts", () => {
    const result = parsePayslip([
      "Gross Pay                 £2,184.32   £19,400.00",
      "Net Payment               £1,847.61",
      "PAYE Tax                  £221.40",
      "Employee NI               £84.16",
      "Employee Pension          £31.15",
      "Student Loan              £0.00",
      "Overtime                  £120.50",
      "Holiday Pay               £80.00",
      "Employer Pension          £62.30",
      "Gross YTD                 £19,400.00",
    ].join("\n"));

    expect(result.fields.grossPay.amount).toBe(2184.32);
    expect(result.fields.grossPay.ytdAmount).toBe(19400);
    expect(result.fields.netPay.amount).toBe(1847.61);
    expect(result.fields.tax.amount).toBe(221.4);
    expect(result.fields.nationalInsurance.amount).toBe(84.16);
    expect(result.fields.pension.amount).toBe(31.15);
    expect(result.fields.studentLoan.amount).toBe(0);
    expect(result.lines.some((line) => line.category === "employer_contribution")).toBe(true);
  });

  it("does not invent missing values and handles parentheses as negative", () => {
    const result = parsePayslip("Gross Earnings: £2,100.00\nUnion deduction (£12.40)\nTax YTD £900.00");
    expect(result.fields.grossPay.amount).toBe(2100);
    expect(result.fields.pension).toBeUndefined();
    expect(result.lines.find((line) => line.label.includes("Union"))?.amount).toBe(-12.4);
    expect(result.fields.taxYtd.amount).toBe(900);
  });

  it("supports unusual spacing, decimal values, and explicit dates", () => {
    const result = parsePayslip("Pay date: 31/10/2026\nTotal Gross  950.5\nTake-home: £ 811.27\nHours worked 37.5");
    expect(result.payDate).toBe("2026-10-31T00:00:00.000Z");
    expect(result.fields.grossPay.amount).toBe(950.5);
    expect(result.fields.netPay.amount).toBe(811.27);
    expect(result.fields.hoursWorked.amount).toBe(37.5);
  });

  it("keeps labeled employee and employer metadata with source text and page", () => {
    const result = parsePayslip("Employer: Firth & Co\nEmployee Name: Casey Example\nPay date: 31/10/2026", 2);
    expect(result.attributes.employer).toMatchObject({ value: "Firth & Co", page: 2, confidence: "High" });
    expect(result.attributes.employeeName).toMatchObject({ value: "Casey Example", page: 2 });
    expect(result.attributes.payDate.sourceText).toBe("Pay date: 31/10/2026");
  });

  it("does not mistake tax codes, NI numbers, dates or student loan plan numbers for pay", () => {
    const result = parsePayslip([
      "Tax code: 1257L",
      "National Insurance number: QQ123456C",
      "Payroll number: 123456",
      "Pay date: 31/10/2026",
      "Student Loan Plan 2 £25.00",
      "PAYE Tax £120.00",
    ].join("\n"));

    expect(result.fields.tax.amount).toBe(120);
    expect(result.fields.studentLoan.amount).toBe(25);
    expect(result.fields.nationalInsurance).toBeUndefined();
    expect(result.lines).toHaveLength(2);
  });

  it("parses BaseA and HOLW column rows separately and takes totals from their labelled columns", () => {
    const result = parsePayslip([
      "BaseA(HRS)    14.25    11.44    163.02",
      "HOLW           8.00    11.44     91.52",
      "Total Payments    Total Deductions    Net Pay    254.54    20.00    234.54",
      "This Emp YTD Txble Gross    2,100.00",
    ].join("\n"));

    expect(result.fields.baseHours.amount).toBe(14.25);
    expect(result.fields.baseRate.amount).toBe(11.44);
    expect(result.fields.baseGross.amount).toBe(163.02);
    expect(result.fields.hoursWorked.amount).toBe(14.25);
    expect(result.fields.hourlyRate.amount).toBe(11.44);
    expect(result.fields.holidayHours.amount).toBe(8);
    expect(result.fields.holidayRate.amount).toBe(11.44);
    expect(result.fields.holidayGross.amount).toBe(91.52);
    expect(result.lines.find((line) => line.label === "BaseA")).toMatchObject({ category: "earning", amount: 163.02, ytdAmount: null });
    expect(result.lines.find((line) => line.label === "HOLW")).toMatchObject({ category: "earning", amount: 91.52, ytdAmount: null });
    expect(result.fields.grossPay.amount).toBe(254.54);
    expect(result.fields.totalDeductions.amount).toBe(20);
    expect(result.fields.netPay.amount).toBe(234.54);
    expect(result.fields.grossYtd.amount).toBe(2100);
    expect(result.attributes.baseRowValidation.value).toBe("passed");
  });

  it("keeps printed BaseA gross authoritative and marks an unreconciled row for review", () => {
    const result = parsePayslip("BaseA(HRS)    14.25    11.44    170.00");

    expect(result.fields.baseGross.amount).toBe(170);
    expect(result.fields.hoursWorked.amount).toBe(14.25);
    expect(result.fields.hourlyRate.amount).toBe(11.44);
    expect(result.fields.grossPay).toBeUndefined();
    expect(result.attributes.baseRowValidation).toMatchObject({ value: "review", confidence: "Low" });
  });

  it("keeps explicitly labelled YTD values separate from period gross and net", () => {
    const result = parsePayslip("YTD Gross £12,000.00\nYTD Net £9,000.00");

    expect(result.fields.grossYtd.amount).toBe(12000);
    expect(result.fields.netYtd.amount).toBe(9000);
    expect(result.fields.grossPay).toBeUndefined();
    expect(result.fields.netPay).toBeUndefined();
  });

  it("recognizes reconciled negative deductions without treating the signed amounts as invalid", () => {
    const result = parsePayslip("Total Payments    Total Deductions    Net Pay    100.00    (50.00)    150.00");

    expect(result.fields.grossPay.amount).toBe(100);
    expect(result.fields.totalDeductions.amount).toBe(-50);
    expect(result.fields.netPay.amount).toBe(150);
  });

  it("parses the observed Marston's layout with separate period totals and YTD columns", () => {
    const result = parsePayslip([
      "BaseA(HRS) 14.25 11.44 163.02",
      "NEST EE Contribution 1.73",
      "Total Gross YTD 7,981.20",
      "This Emp YTD Txble Gross 7,981.20",
      "This Emp YTD Tax Paid 0.00",
      "NI To Date 49.24",
      "Total Payments 163.02",
      "Total Deductions 1.73",
      "Net Pay 161.29",
    ].join("\n"));

    expect(result.fields).toMatchObject({
      grossPay: { amount: 163.02, label: "Total Payments" },
      totalDeductions: { amount: 1.73, label: "Total Deductions" },
      netPay: { amount: 161.29, label: "Net Pay" },
      baseHours: { amount: 14.25 },
      hourlyRate: { amount: 11.44 },
      baseGross: { amount: 163.02 },
      grossYtd: { amount: 7981.2 },
      taxYtd: { amount: 0 },
      nationalInsuranceYtd: { amount: 49.24 },
    });
    expect(result.fields.tax).toBeUndefined();
    expect(result.fields.nationalInsurance).toBeUndefined();
    expect(result.lines.find((line) => /NEST EE Contribution/i.test(line.label))).toMatchObject({ category: "deduction", amount: 1.73 });
    expect(result.attributes.totalSummaryValidation.value).toBe("passed");
  });

  it("extracts YTD labels overlaid with earnings rows without consuming BaseA columns", () => {
    const result = parsePayslip("BaseA(HRS) 14.25 11.44 163.02 This Emp YTD Txble Gross 7,981.20 This Emp YTD Tax Paid 0.00");

    expect(result.fields.grossPay).toBeUndefined();
    expect(result.fields.baseGross.amount).toBe(163.02);
    expect(result.fields.grossYtd.amount).toBe(7981.2);
    expect(result.fields.taxYtd.amount).toBe(0);
  });

  it("aggregates repeated BaseA earnings while retaining each printed rate", () => {
    const result = parsePayslip("BaseA(HRS) 10.00 11.44 114.40\nBaseA(HRS) 5.00 12.00 60.00");
    const rows = JSON.parse(result.attributes.baseARows.value) as Array<{ hours: number; rate: number; amount: number }>;

    expect(result.fields.baseHours.amount).toBe(15);
    expect(result.fields.baseGross.amount).toBe(174.4);
    expect(result.fields.hourlyRate).toBeUndefined();
    expect(rows).toEqual([
      expect.objectContaining({ hours: 10, rate: 11.44, amount: 114.4 }),
      expect.objectContaining({ hours: 5, rate: 12, amount: 60 }),
    ]);
  });
});
