import { describe, expect, it } from "vitest";
import type { Payslip } from "./types";
import {
  calculateStatistics, calculateConsistency, calculateDistributions, calculateCorrelations,
  calculateMonthlyStatistics, calculateYearlyStatistics, calculatePayChanges, filterPayslips,
  summarize, metricValue, calculateReconciliation, calculateYtd, calculateFrequency,
  previousPeriod, aggregateMetric,
  calculateGrossNetAnomalies,
  metricDefinitions,
} from "./statistics";
import { statisticsRows } from "./statistics-export";

export function slip(id: string, values: Partial<Payslip> = {}): Payslip {
  return {
    id, filename: "synthetic.pdf", employer: "Fixture Ltd", employeeName: null,
    payDate: "2026-01-30T00:00:00.000Z", periodStart: null, periodEnd: null,
    grossPay: null, netPay: null, tax: null, nationalInsurance: null, pension: null, studentLoan: null,
    otherDeductions: null, hoursWorked: null, hourlyRate: null, grossYtd: null, taxYtd: null,
    nationalInsuranceYtd: null, pensionYtd: null, netYtd: null, importedAt: "2026-01-31T00:00:00.000Z",
    lines: [], fields: [], ...values,
  };
}
const records = [
  slip("a", { grossPay: 1000, netPay: 800, tax: 100, nationalInsurance: 60, pension: 40, hoursWorked: 50 }),
  slip("b", { payDate: "2026-02-28", grossPay: 2000, netPay: 1500, tax: 300, nationalInsurance: 100, pension: 100, hoursWorked: 80 }),
  slip("c", { payDate: "2026-03-30", grossPay: 3000, netPay: 2100, tax: 600, nationalInsurance: 200, pension: 100, hoursWorked: 100 }),
];

describe("pay statistics", () => {
  it("calculates totals, averages, medians and observed coverage", () => {
    const result = calculateStatistics(records);
    expect(result.metrics.grossPay).toMatchObject({ total: 6000, mean: 2000, median: 2000, min: 1000, max: 3000, count: 3 });
    expect(result.metrics.netPay.total).toBe(4400);
    expect(result.metrics.deductions.total).toBe(1600);
    expect(result.metrics.tax.total).toBe(1000);
    expect(result.metrics.hoursWorked.total).toBe(230);
    expect(result.quality.find((row) => row.key === "grossPay")?.available).toBe(3);
  });
  it("excludes missing values, includes observed zero and never divides by zero", () => {
    const result = calculateStatistics([slip("missing"), slip("zero", { grossPay: 0, netPay: 0, tax: 0, hoursWorked: 0 })]);
    expect(result.metrics.grossPay).toMatchObject({ total: 0, mean: 0, count: 1 });
    expect(result.metrics.pension.total).toBeNull();
    expect(result.metrics.grossHourly.count).toBe(0);
    expect(result.metrics.netPercent.count).toBe(0);
    expect(summarize([]).median).toBeNull();
  });
  it("uses paired observations for rates and requires hours even when a printed rate exists", () => {
    expect(metricValue(records[0], "grossHourly")).toBe(20);
    expect(metricValue(records[1], "netHourly")).toBe(18.75);
    expect(metricValue(records[0], "netPercent")).toBe(80);
    expect(metricValue(slip("a", { hourlyRate: 15 }), "grossHourly")).toBeNull();
    expect(calculateStatistics([records[0], slip("missing", { grossPay: 5000 })]).deductions[0].percentGross).toBe(10);
  });
  it("aggregates calendar months and years without adding rates or YTD", () => {
    const month = calculateMonthlyStatistics([records[0], slip("d", { ...records[0], id: "d", grossPay: 500, netPay: 300, hoursWorked: 25 })])[0];
    expect(month.count).toBe(2);
    expect(month.values.grossPay).toBe(1500);
    expect(month.values.grossHourly).toBe(20);
    expect(calculateYearlyStatistics(records)[0].values.grossPay).toBe(6000);
  });
  it("sorts changes by date and does not cross employer boundaries", () => {
    const changes = calculatePayChanges([...records].reverse());
    expect(changes[0].changes.netPay).toMatchObject({ amount: 700, percentage: 87.5 });
    expect(changes[1].changes.grossPay.amount).toBe(1000);
    expect(calculatePayChanges([records[0], slip("other", { employer: "Other", grossPay: 100 })])).toHaveLength(0);
  });
  it("classifies consistency deterministically and computes population variance", () => {
    expect(calculateConsistency([10, 10, 10])).toMatchObject({ variance: 0, coefficient: 0, classification: "Very consistent" });
    expect(calculateConsistency([0, 100])).toMatchObject({ variance: 2500, standardDeviation: 50, coefficient: 100, classification: "Highly variable" });
    expect(calculateConsistency([0, 0]).classification).toBe("Very consistent");
    expect(calculateConsistency([1]).classification).toBe("Not enough data");
  });
  it("computes interpolated quartiles and histograms", () => {
    const dist = calculateDistributions([0, 10, 20, 30, 40]);
    expect(dist).toMatchObject({ min: 0, q1: 10, median: 20, q3: 30, max: 40 });
    expect(dist.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
  });
  it("computes Pearson correlation only for enough nonconstant pairs", () => {
    const corr = calculateCorrelations(records).find((row) => row.x === "grossPay" && row.y === "netPay")!;
    expect(corr.coefficient).toBeGreaterThan(0.99);
    expect(calculateCorrelations(records.slice(0, 2))[0].coefficient).toBeNull();
    expect(calculateCorrelations(records.map((record) => ({ ...record, grossPay: 1 })))[0].coefficient).toBeNull();
  });
  it("filters dates, employers and pay frequency; excludes undated records from date filters", () => {
    expect(filterPayslips([...records, slip("unknown", { payDate: null })], { range: "custom", start: "2026-02-01", end: "2026-02-28", employer: "", frequency: "" })).toHaveLength(1);
    expect(filterPayslips(records, { range: "all", employer: "Other", frequency: "" })).toHaveLength(0);
    expect(filterPayslips(records, { range: "all", employer: "", frequency: "Monthly" })).toHaveLength(3);
    expect(calculateFrequency(records).classification).toBe("Monthly");
  });
  it("compares latest printed YTD per employer in the UK tax year, never sums printed YTD", () => {
    const ytd = calculateYtd([
      slip("old", { payDate: "2025-12-31", grossPay: 1000, grossYtd: 8000 }),
      slip("new", { payDate: "2026-01-31", grossPay: 1200, grossYtd: 9200 }),
    ]);
    expect(ytd[0].values.grossPay).toMatchObject({ printed: 9200, calculated: 2200, discrepancy: 7000 });
    expect(ytd[0].completePeriod).toBe(false);
  });
  it("reconciles only sufficient explicit deductions and never forces a missing value to zero", () => {
    expect(calculateReconciliation(records).checked).toBe(0);
    const complete = records.map((record) => ({ ...record, studentLoan: 0, otherDeductions: 0 }));
    expect(calculateReconciliation(complete)).toMatchObject({ checked: 3, reconciled: 3, discrepancies: 0, largest: 0 });
    const incorrect = { ...complete[0], pension: 20 };
    expect(calculateReconciliation([incorrect]).largest).toBe(20);
    expect(incorrect.pension).toBe(20);
  });
  it("does not double count summary, YTD, rate or hours lines as earnings", () => {
    const line = (label: string, amount: number) => ({ id: label, label, amount, category: "earning", ytdAmount: null, sourceText: label, confidence: "High", page: 1, manuallyCorrected: false, originalAmount: amount });
    const result = calculateStatistics([slip("a", { lines: [line("Gross Pay", 2000), line("Net Pay", 1500), line("Basic pay", 1500), line("Overtime", 500), line("Hours", 100), line("Gross YTD", 10000), line("PAYE", 200)] })]);
    expect(result.earnings.map((item) => item.total)).toEqual([1500, 500]);
  });
  it("scales to 1,000+ records and returns a complete empty report", () => {
    const many = Array.from({ length: 1500 }, (_, index) => slip(String(index), { ...records[index % 3], id: String(index) }));
    expect(calculateStatistics(many).count).toBe(1500);
    expect(calculateStatistics([]).monthly).toEqual([]);
    expect(calculateStatistics([]).quality.every((row) => row.percentage === 0)).toBe(true);
  });
  it("does not invent a previous comparison and uses the actual adjacent equal-length window", () => {
    const filter = { range: "custom", start: "2026-02-01", end: "2026-02-28", employer: "", frequency: "" } as const;
    expect(previousPeriod(records, { range: "all", employer: "", frequency: "" })).toBeNull();
    expect(previousPeriod(records.slice(1), filter)).toBeNull();
    expect(previousPeriod(records, filter)?.statistics.metrics.grossPay.total).toBe(1000);
    expect(previousPeriod(records, { ...filter, start: "2026-03-01", end: "2026-02-01" })).toBeNull();
  });
  it("distinguishes per-record hourly average from a paired hours-weighted aggregate", () => {
    const group = [slip("a", { grossPay: 1000, hoursWorked: 100 }), slip("b", { grossPay: 1000, hoursWorked: 50 }), slip("missing", { grossPay: 9000 })];
    expect(calculateStatistics(group).metrics.grossHourly.mean).toBe(15);
    expect(aggregateMetric(group, "grossHourly")).toBeCloseTo(2000 / 150);
  });
  it("requires matched observations for retention and keeps negative deduction refunds", () => {
    const group = [slip("refund", { grossPay: 1000, netPay: 1100, tax: -100 }), slip("gross-only", { grossPay: 9000 })];
    expect(calculateStatistics(group).metrics.deductions.total).toBe(-100);
    expect(aggregateMetric(group, "netPercent")).toBeCloseTo(110);
    expect(calculateStatistics(group).deductions[0].percentGross).toBe(-10);
  });
  it("flags rather than silently correcting records with net pay above gross", () => {
    const records = [slip("review", { grossPay: 10, netPay: 200 }), slip("ordinary", { grossPay: 200, netPay: 150 }), slip("missing", { grossPay: 10 })];
    expect(calculateGrossNetAnomalies(records)).toEqual({ paired: 2, netAboveGross: 1, explained: 0, unexplained: 1, ids: ["review"] });
    expect(calculateStatistics(records).metrics.grossPay.total).toBe(220);
    expect(calculateStatistics(records).metrics.netPay.total).toBe(350);
    expect(calculateStatistics(records).grossNetAnomalies.ids).toEqual(["review"]);
    expect(metricDefinitions.deductions[0]).toBe("Gross - net difference");
    expect(metricDefinitions.deductionRate[0]).toBe("Gross - net difference as % of gross");
  });
  it("uses labelled total deductions and separates worked, holiday and paid hours", () => {
    const record = slip("structured", {
      grossPay: 254.54,
      netPay: 234.54,
      hoursWorked: 14.25,
      hourlyRate: 11.44,
      fields: [
        { id: "deductions", key: "totalDeductions", value: "20", originalValue: "20", label: "Total Deductions", confidence: "High", sourceText: "Total Payments Total Deductions Net Pay", page: 1, manuallyCorrected: false },
        { id: "holiday-hours", key: "holidayHours", value: "8", originalValue: "8", label: "HOLW", confidence: "High", sourceText: "HOLW 8.00 11.44 91.52", page: 1, manuallyCorrected: false },
      ],
    });
    expect(metricValue(record, "totalDeductions")).toBe(20);
    expect(metricValue(record, "hoursWorked")).toBe(14.25);
    expect(metricValue(record, "holidayHours")).toBe(8);
    expect(metricValue(record, "totalPaidHours")).toBe(22.25);
    expect(metricDefinitions.hoursWorked[0]).toBe("Hours worked");
    expect(metricDefinitions.hourlyRate[0]).toBe("BaseA hourly rate");
  });
  it("explains net above gross only when labelled negative deductions reconcile", () => {
    const reconciled = slip("refund", {
      grossPay: 100,
      netPay: 150,
      fields: [{ id: "deductions", key: "totalDeductions", value: "-50", originalValue: "-50", label: "Total Deductions", confidence: "High", sourceText: "Total Payments Total Deductions Net Pay", page: 1, manuallyCorrected: false }],
    });
    expect(calculateGrossNetAnomalies([reconciled])).toEqual({
      paired: 1, netAboveGross: 1, explained: 1, unexplained: 0, ids: [],
    });
  });
  it("isolates multiple-employer YTD snapshots and the April 6 boundary", () => {
    const ytd = calculateYtd([
      slip("previous-year", { payDate: "2026-04-05", grossPay: 1000, grossYtd: 12000 }),
      slip("current-year", { payDate: "2026-04-06", grossPay: 2000, grossYtd: 2000 }),
      slip("other", { employer: "Other", payDate: "2026-04-07", grossPay: 500, grossYtd: 500 }),
    ]);
    expect(ytd).toHaveLength(2);
    expect(ytd.find((row) => row.employer === "Fixture Ltd")?.values.grossPay).toMatchObject({ printed: 2000, calculated: 2000, discrepancy: 0 });
    expect(ytd.find((row) => row.employer === "Other")?.values.grossPay.printed).toBe(500);
  });
  it("handles a single payslip, undated records and constant distributions", () => {
    const report = calculateStatistics([slip("undated", { payDate: null, grossPay: 1000 })]);
    expect(report.metrics.grossPay.total).toBe(1000);
    expect(report.monthly).toHaveLength(0);
    expect(report.payDates.first).toBeNull();
    expect(report.changes).toHaveLength(0);
    const dist = calculateDistributions([10, 10, 10]);
    expect(dist.q1).toBe(10); expect(dist.q3).toBe(10);
    expect(dist.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
  });
  it("exports actual observed metrics and all calculated sections without null-to-zero conversion", () => {
    const report = calculateStatistics(records);
    const rows = statisticsRows(report);
    expect(rows.find((row) => row.section === "overview" && row.metric === "Gross pay" && row.measure === "total")?.value).toBe(6000);
    expect(rows.find((row) => row.section === "overview" && row.metric === "Student loan" && row.measure === "total")?.value).toBe("");
    for (const section of ["monthly", "yearly", "consistency", "distributions", "correlations", "quality"]) expect(rows.some((row) => row.section === section)).toBe(true);
  });
});
