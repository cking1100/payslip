import type { Payslip, PayslipLine } from "./types";

export const metricDefinitions = {
  grossPay: ["Gross pay", "money"], netPay: ["Net pay", "money"], deductions: ["Gross - net difference", "money"],
  totalDeductions: ["Total deductions", "money"],
  tax: ["PAYE", "money"], nationalInsurance: ["National Insurance", "money"], pension: ["Employee pension", "money"],
  studentLoan: ["Student loan", "money"], otherDeductions: ["Other deductions", "money"],
  hoursWorked: ["Hours worked", "number"], holidayHours: ["Holiday hours", "number"], totalPaidHours: ["Total paid hours", "number"],
  grossHourly: ["Effective gross hourly rate", "money"], netHourly: ["Effective net hourly rate", "money"],
  hourlyRate: ["BaseA hourly rate", "money"], netPercent: ["Net % of gross", "percent"],
  deductionRate: ["Gross - net difference as % of gross", "percent"], taxRate: ["Effective PAYE rate", "percent"], niRate: ["Effective NI rate", "percent"],
  overtime: ["Overtime pay", "money"], overtimeHours: ["Overtime hours", "number"], overtimeRate: ["Effective overtime rate", "money"],
  overtimePercent: ["Overtime % of gross", "percent"], bonus: ["Bonuses", "money"], holiday: ["Holiday pay", "money"],
  employerPension: ["Employer pension", "money"], combinedPension: ["Combined pension", "money"],
  pensionRatio: ["Employee / employer pension ratio", "number"],
} as const;
export type Metric = keyof typeof metricDefinitions;
export type Unit = "money" | "number" | "percent";
export const metrics = Object.keys(metricDefinitions) as Metric[];
export const deductionKeys = ["tax", "nationalInsurance", "pension", "studentLoan", "otherDeductions"] as const;
export type Summary = {
  count: number; total: number | null; mean: number | null; median: number | null;
  min: number | null; max: number | null; range: number | null;
};
export type Filter = { range: "all" | "year" | "12" | "6" | "3" | "custom"; employer: string; frequency: string; start?: string; end?: string };
export const defaultFilter: Filter = { range: "all", employer: "", frequency: "" };
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const dayMs = 86400000;
export function dateOf(record: Payslip): number | null {
  if (!record.payDate) return null;
  const date = Date.parse(record.payDate);
  return Number.isFinite(date) ? date : null;
}
export function quantile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const index = Math.floor(position);
  return sorted[index] + (sorted[Math.min(index + 1, sorted.length - 1)] - sorted[index]) * (position - index);
}
export function summarize(values: Array<number | null | undefined>): Summary {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, total: null, mean: null, median: null, min: null, max: null, range: null };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return { count: sorted.length, total, mean: total / sorted.length, median: quantile(sorted, 0.5), min: sorted[0], max: sorted[sorted.length - 1], range: sorted[sorted.length - 1] - sorted[0] };
}

function currentLine(line: PayslipLine): boolean {
  return finite(line.amount) && !/\bytd\b|year\s*to\s*date|cumulative/i.test(line.label);
}
function lineAmount(record: Payslip, expression: RegExp, category?: string): number | null {
  return summarize(record.lines.filter((line) => currentLine(line) && expression.test(line.label)
    && (!category || line.category === category)).map((line) => line.amount)).total;
}
export function earningCategory(line: PayslipLine): string | null {
  if (!currentLine(line) || line.category === "employer_contribution" || /\b(?:gross|net|total|tax|paye|pension|loan|insurance|ni|hours?|rate)\b/i.test(line.label)) return null;
  if (/^basea$/i.test(line.label)) return "Basic pay";
  if (/^holw$/i.test(line.label)) return "Holiday pay";
  if (/overtime/i.test(line.label)) return "Overtime";
  if (/holiday/i.test(line.label)) return "Holiday pay";
  if (/bonus/i.test(line.label)) return "Bonus";
  if (/commission/i.test(line.label)) return "Commission";
  if (/basic|salary|hourly\s+pay/i.test(line.label)) return "Basic pay";
  return line.category === "earning" ? "Other earnings" : null;
}
function fieldAmount(record: Payslip, key: string): number | null {
  const value = record.fields?.find((field) => field.key === key)?.value;
  if (value === null || value === undefined || !value.trim()) return null;
  const amount = Number(value);
  return finite(amount) ? amount : null;
}
export function metricValue(record: Payslip, metric: Metric): number | null {
  const gross = finite(record.grossPay) ? record.grossPay : null;
  const net = finite(record.netPay) ? record.netPay : null;
  const hours = finite(record.hoursWorked) && record.hoursWorked > 0 ? record.hoursWorked : null;
  switch (metric) {
    case "totalDeductions": return fieldAmount(record, "totalDeductions");
    case "holidayHours": return fieldAmount(record, "holidayHours");
    case "totalPaidHours": {
      const holidayHours = fieldAmount(record, "holidayHours");
      return hours !== null && holidayHours !== null ? hours + holidayHours : null;
    }
    case "deductions": return gross !== null && net !== null ? gross - net : null;
    case "grossHourly": return gross !== null && hours !== null ? gross / hours : null;
    case "netHourly": return net !== null && hours !== null ? net / hours : null;
    case "netPercent": return gross !== null && gross > 0 && net !== null ? net / gross * 100 : null;
    case "deductionRate": return gross !== null && gross > 0 && net !== null ? (gross - net) / gross * 100 : null;
    case "taxRate": return gross !== null && gross > 0 && finite(record.tax) ? record.tax / gross * 100 : null;
    case "niRate": return gross !== null && gross > 0 && finite(record.nationalInsurance) ? record.nationalInsurance / gross * 100 : null;
    case "overtime": return lineAmount(record, /\bovertime\b(?!.*(?:hours?|rate))/i, "earning");
    case "overtimeHours": return lineAmount(record, /\bovertime\b.*\bhours?\b/i);
    case "overtimeRate": {
      const amount = metricValue(record, "overtime"), worked = metricValue(record, "overtimeHours");
      return amount !== null && worked !== null && worked > 0 ? amount / worked : null;
    }

    case "overtimePercent": {
      const amount = metricValue(record, "overtime");
      return amount !== null && gross !== null && gross > 0 ? amount / gross * 100 : null;
    }
    case "bonus": return lineAmount(record, /\bbonus\b/i, "earning");
    case "holiday": return lineAmount(record, /(?:\bholiday\b(?!.*hours?)|^holw$)/i, "earning");
    case "employerPension": return lineAmount(record, /\bpension\b/i, "employer_contribution");
    case "combinedPension": {
      const employer = metricValue(record, "employerPension");
      return employer !== null && finite(record.pension) ? employer + record.pension : null;
    }
    case "pensionRatio": {
      const employer = metricValue(record, "employerPension");
      return employer !== null && employer > 0 && finite(record.pension) ? record.pension / employer : null;
    }
    case "otherDeductions": {
      if (finite(record.otherDeductions)) return record.otherDeductions;
      return lineAmount(record, /union|attachment\s+of\s+earnings|charity|other\s+deductions?|health|insurance\s+premium/i, "deduction");
    }
    default: return finite(record[metric]) ? record[metric] : null;
  }
}

export function filterBounds(filter: Filter, now = new Date()): { start: number | null; end: number | null } {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter.range === "all") return { start: null, end: null };
  if (filter.range === "custom") return {
    start: filter.start && Number.isFinite(Date.parse(filter.start)) ? Date.parse(filter.start) : null,
    end: filter.end && Number.isFinite(Date.parse(filter.end)) ? Date.parse(filter.end) + dayMs - 1 : null,
  };
  const start = filter.range === "year" ? Date.UTC(now.getFullYear(), 0, 1)
    : Date.UTC(now.getFullYear(), now.getMonth() - Number(filter.range), now.getDate());
  return { start, end: today + dayMs - 1 };
}
export function calculateFrequency(records: Payslip[]) {
  const dates = [...new Set(records.map(dateOf).filter(finite))].sort((a, b) => a - b);
  const gaps = dates.slice(1).map((date, index) => (date - dates[index]) / dayMs);
  const summary = summarize(gaps);
  const bands = [
    { name: "Weekly", low: 5, high: 9 }, { name: "Fortnightly", low: 12, high: 16 },
    { name: "Four-weekly", low: 26, high: 29 }, { name: "Monthly", low: 28, high: 33 },
  ];
  const candidates = bands.map((band) => ({ ...band, score: gaps.filter((gap) => gap >= band.low && gap <= band.high).length / (gaps.length || 1) }));
  const likely = candidates.sort((a, b) => b.score - a.score)[0];
  const classification = gaps.length < 2 ? "Uncertain" : likely.score >= 0.7 ? likely.name : "Other";
  return { ...summary, classification, confidence: gaps.length >= 2 && likely.score >= 0.7 ? likely.score * 100 : null, gaps };
}
function frequencyMap(records: Payslip[]) {
  const groups = new Map<string, Payslip[]>();
  for (const record of records) {
    const group = record.employer || "Unknown employer";
    groups.set(group, [...(groups.get(group) ?? []), record]);
  }
  return new Map([...groups].map(([key, group]) => [key, calculateFrequency(group).classification]));
}
export function filterPayslips(records: Payslip[], filter: Filter, now = new Date()): Payslip[] {
  const { start, end } = filterBounds(filter, now);
  const frequency = frequencyMap(records);
  return records.filter((record) => {
    const date = dateOf(record);
    return (!filter.employer || (record.employer || "Unknown employer") === filter.employer)
      && (!filter.frequency || frequency.get(record.employer || "Unknown employer") === filter.frequency)
      && (start === null || date !== null && date >= start) && (end === null || date !== null && date <= end);
  });
}

export function aggregateMetric(records: Payslip[], metric: Metric): number | null {
  const numerator: Partial<Record<Metric, Metric>> = {
    grossHourly: "grossPay", netHourly: "netPay", netPercent: "netPay",
    deductionRate: "deductions", taxRate: "tax", niRate: "nationalInsurance", overtimePercent: "overtime",
  };
  const source = numerator[metric];
  if (source) {
    const denominator = metric === "grossHourly" || metric === "netHourly" ? "hoursWorked" : "grossPay";
    const pairs = records.filter((record) => metricValue(record, metric) !== null);
    const total = summarize(pairs.map((record) => metricValue(record, source))).total;
    const base = summarize(pairs.map((record) => metricValue(record, denominator))).total;
    return total !== null && base !== null && base > 0 ? total / base * (denominator === "grossPay" ? 100 : 1) : null;
  }
  if (["hourlyRate", "overtimeRate", "pensionRatio"].includes(metric)) return summarize(records.map((record) => metricValue(record, metric))).mean;
  return summarize(records.map((record) => metricValue(record, metric))).total;
}
export type PeriodStatistics = {
  key: string; count: number; ids: string[]; values: Record<Metric, number | null>;
  averageGross: number | null; averageNet: number | null; averageHourly: number | null;
  grossChange: number | null; netChange: number | null; grossPercentChange: number | null; netPercentChange: number | null;
};
function groupStatistics(records: Payslip[], keyFor: (record: Payslip) => string | null): PeriodStatistics[] {
  const groups = new Map<string, Payslip[]>();
  for (const record of records) {
    const key = keyFor(record);
    if (key !== null) { const group = groups.get(key) ?? []; group.push(record); groups.set(key, group); }
  }
  const result = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({
    key, ids: group.map((record) => record.id), count: group.length,
    values: Object.fromEntries(metrics.map((metric) => [metric, aggregateMetric(group, metric)])) as Record<Metric, number | null>,
    averageGross: summarize(group.map((record) => record.grossPay)).mean,
    averageNet: summarize(group.map((record) => record.netPay)).mean,
    averageHourly: summarize(group.map((record) => metricValue(record, "grossHourly"))).mean,
    grossChange: null as number | null, netChange: null as number | null,
    grossPercentChange: null as number | null, netPercentChange: null as number | null,
  }));
  result.forEach((period, index) => {
    const previous = result[index - 1];
    if (!previous) return;
    for (const [metric, change, percent] of [["grossPay", "grossChange", "grossPercentChange"], ["netPay", "netChange", "netPercentChange"]] as const) {
      const before = previous.values[metric], after = period.values[metric];
      period[change] = before !== null && after !== null ? after - before : null;
      period[percent] = period[change] !== null && before !== null && before !== 0 ? period[change]! / Math.abs(before) * 100 : null;
    }
  });
  return result;
}
export function calculateMonthlyStatistics(records: Payslip[]) {
  return groupStatistics(records, (record) => dateOf(record) !== null ? new Date(record.payDate!).toISOString().slice(0, 7) : null);
}
export function calculateYearlyStatistics(records: Payslip[]) {
  return groupStatistics(records, (record) => dateOf(record) !== null ? new Date(record.payDate!).getUTCFullYear().toString() : null);
}
export function calculateEmployerStatistics(records: Payslip[]) {
  return groupStatistics(records, (record) => record.employer || "Unknown employer");
}
export function calculateDeductionStatistics(records: Payslip[]) {
  return deductionKeys.map((key) => {
    const summary = summarize(records.map((record) => metricValue(record, key)));
    const grossPairs = records.filter((record) => metricValue(record, key) !== null && finite(record.grossPay) && record.grossPay > 0);
    const deductedPairs = records.filter((record) => metricValue(record, key) !== null && metricValue(record, "deductions") !== null && metricValue(record, "deductions")! > 0);
    const ratio = (group: Payslip[], base: Metric) => {
      const numerator = summarize(group.map((record) => metricValue(record, key))).total;
      const denominator = summarize(group.map((record) => metricValue(record, base))).total;
      return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator * 100 : null;
    };
    return { key, ...summary, percentGross: ratio(grossPairs, "grossPay"), percentDeductions: ratio(deductedPairs, "deductions") };
  });
}
export function calculateHourlyStatistics(records: Payslip[]) {
  return { gross: summarize(records.map((record) => metricValue(record, "grossHourly"))), net: summarize(records.map((record) => metricValue(record, "netHourly"))) };
}
export function calculatePayChanges(records: Payslip[]) {
  const sorted = records.filter((record) => dateOf(record) !== null).sort((a, b) => dateOf(a)! - dateOf(b)! || a.id.localeCompare(b.id));
  const previousByEmployer = new Map<string, Payslip>();
  return sorted.flatMap((record) => {
    const employer = record.employer || "Unknown employer";
    const before = previousByEmployer.get(employer);
    previousByEmployer.set(employer, record);
    if (!before || dateOf(before) === dateOf(record)) return [];
    return [{
      id: record.id, previousId: before.id, date: record.payDate!, employer,
      changes: Object.fromEntries(metrics.map((metric) => {
        const old = metricValue(before, metric), current = metricValue(record, metric);
        const amount = old !== null && current !== null ? current - old : null;
        return [metric, { amount, percentage: amount !== null && old !== null && old !== 0 ? amount / Math.abs(old) * 100 : null }];
      })) as Record<Metric, { amount: number | null; percentage: number | null }>,
    }];
  });
}
export function calculateConsistency(values: Array<number | null>) {
  const observed = values.filter(finite), summary = summarize(observed);
  const variance = observed.length && summary.mean !== null ? observed.reduce((sum, value) => sum + (value - summary.mean!) ** 2, 0) / observed.length : null;
  const standardDeviation = variance !== null ? Math.sqrt(variance) : null;
  const coefficient = standardDeviation !== null && summary.mean !== null
    ? summary.mean !== 0 ? standardDeviation / Math.abs(summary.mean) * 100 : standardDeviation === 0 ? 0 : null : null;
  const classification = observed.length < 2 || coefficient === null ? "Not enough data" : coefficient <= 5 ? "Very consistent" : coefficient <= 15 ? "Mostly consistent" : coefficient <= 30 ? "Variable" : "Highly variable";
  return { ...summary, variance, standardDeviation, coefficient, classification };
}
export function calculateDistributions(values: Array<number | null>) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  const summary = summarize(sorted);
  const binCount = sorted.length ? Math.min(12, Math.max(1, Math.ceil(Math.sqrt(sorted.length)))) : 0;
  const width = summary.min !== null && summary.max !== null ? (summary.max - summary.min) / binCount || 1 : 1;
  const bins = Array.from({ length: binCount }, (_, index) => ({ start: summary.min! + index * width, end: summary.min! + (index + 1) * width, count: 0 }));
  for (const value of sorted) bins[Math.min(binCount - 1, Math.floor((value - summary.min!) / width))].count++;
  return { ...summary, q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75), bins };
}
export function calculateCorrelations(records: Payslip[]) {
  const pairs: Array<[Metric, Metric]> = [["hoursWorked", "grossPay"], ["hoursWorked", "netPay"], ["grossPay", "tax"], ["grossPay", "nationalInsurance"], ["grossPay", "pension"], ["grossPay", "netPay"], ["overtime", "grossPay"]];
  return pairs.map(([x, y]) => {
    const points = records.flatMap((record) => {
      const a = metricValue(record, x), b = metricValue(record, y);
      return a !== null && b !== null ? [{ x: a, y: b, id: record.id }] : [];
    });
    const meanX = summarize(points.map((point) => point.x)).mean, meanY = summarize(points.map((point) => point.y)).mean;
    let numerator = 0, dx = 0, dy = 0;
    for (const point of points) { const a = point.x - (meanX ?? 0), b = point.y - (meanY ?? 0); numerator += a * b; dx += a * a; dy += b * b; }
    return { x, y, points, count: points.length, coefficient: points.length >= 3 && dx > 0 && dy > 0 ? Math.max(-1, Math.min(1, numerator / Math.sqrt(dx * dy))) : null };
  });
}
export function calculateDataQuality(records: Payslip[]) {
  const keys = ["grossPay", "netPay", "totalDeductions", "hoursWorked", "holidayHours", "totalPaidHours", "hourlyRate", "tax", "nationalInsurance", "pension", "studentLoan", "ytd", "employer", "payDate"] as const;
  return keys.map((key) => {
    const available = records.filter((record) => key === "ytd"
      ? [record.grossYtd, record.netYtd, record.taxYtd, record.nationalInsuranceYtd, record.pensionYtd].some(finite)
      : key === "payDate" ? dateOf(record) !== null
        : key === "employer" ? Boolean(record.employer?.trim())
          : key in metricDefinitions ? metricValue(record, key as Metric) !== null
            : finite(record[key as keyof Payslip])).length;
    return { key, available, total: records.length, percentage: records.length ? available / records.length * 100 : 0 };
  });
}
export function calculateGrossNetAnomalies(records: Payslip[]) {
  const paired = records.filter((record) => finite(record.grossPay) && finite(record.netPay));
  const netAboveGross = paired.filter((record) => record.netPay! > record.grossPay!);
  const explained = netAboveGross.filter((record) => {
    const deductions = metricValue(record, "totalDeductions");
    return deductions !== null && Math.abs(record.grossPay! - deductions - record.netPay!) <= 0.02;
  });
  const unexplained = netAboveGross.filter((record) => !explained.includes(record));
  return {
    paired: paired.length,
    netAboveGross: netAboveGross.length,
    explained: explained.length,
    unexplained: unexplained.length,
    ids: unexplained.map((record) => record.id),
  };
}
export function calculateTemplateValidation(records: Payslip[]) {
  const baseRows = records.flatMap((record) => {
    const value = record.fields.find((field) => field.key === "baseRowValidation")?.value;
    return value ? [{ id: record.id, value }] : [];
  });
  return {
    checked: baseRows.length,
    passed: baseRows.filter((row) => row.value === "passed").length,
    reviewIds: baseRows.filter((row) => row.value === "review").map((row) => row.id),
  };
}
export function calculateReconciliation(records: Payslip[]) {
  const checks = records.flatMap((record) => {
    if (!finite(record.grossPay) || !finite(record.netPay)) return [];
    const values = deductionKeys.map((key) => metricValue(record, key));
    // Missing optional deductions do not imply zero or prove a complete payroll breakdown.
    if (values.some((value) => value === null)) return [];
    const discrepancy = Math.round((record.grossPay - values.reduce<number>((sum, value) => sum + value!, 0) - record.netPay) * 100) / 100;
    return [{ id: record.id, discrepancy }];
  });
  const summary = summarize(checks.map((check) => Math.abs(check.discrepancy)));
  return { checks, checked: checks.length, reconciled: checks.filter((check) => Math.abs(check.discrepancy) <= 0.01).length,
    discrepancies: checks.filter((check) => Math.abs(check.discrepancy) > 0.01).length, largest: summary.max, average: summary.mean };
}
export function calculateYtd(records: Payslip[]) {
  const employers = calculateEmployerStatistics(records);
  return employers.flatMap((group) => {
    const dated = records.filter((record) => group.ids.includes(record.id) && dateOf(record) !== null).sort((a, b) => dateOf(a)! - dateOf(b)!);
    const latest = [...dated].reverse().find((record) => [record.grossYtd, record.taxYtd, record.nationalInsuranceYtd, record.pensionYtd, record.netYtd].some(finite));
    if (!latest) return [];
    const date = new Date(latest.payDate!);
    const year = date.getUTCMonth() > 3 || date.getUTCMonth() === 3 && date.getUTCDate() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    const start = Date.UTC(year, 3, 6);
    const contributing = dated.filter((record) => dateOf(record)! >= start && dateOf(record)! <= dateOf(latest)!);
    const mapping = { grossPay: "grossYtd", tax: "taxYtd", nationalInsurance: "nationalInsuranceYtd", pension: "pensionYtd", netPay: "netYtd" } as const;
    const values = Object.fromEntries((Object.keys(mapping) as Array<keyof typeof mapping>).map((key) => {
      const printed = latest[mapping[key]];
      const calculated = summarize(contributing.map((record) => metricValue(record, key as Metric))).total;
      return [key, { printed: finite(printed) ? printed : null, calculated, discrepancy: finite(printed) && calculated !== null ? printed - calculated : null }];
    })) as Record<keyof typeof mapping, { printed: number | null; calculated: number | null; discrepancy: number | null }>;
    return [{ employer: group.key, id: latest.id, date: latest.payDate!, start: new Date(start).toISOString(), ids: contributing.map((record) => record.id),
      completePeriod: contributing.length > 0 && dateOf(contributing[0])! - start <= 35 * dayMs, values }];
  });
}
export function calculatePayDates(records: Payslip[]) {
  const dates = records.map(dateOf).filter(finite).map((date) => new Date(date));
  const days = dates.map((date) => date.getUTCDate());
  const frequencies = new Map<number, number>();
  days.forEach((day) => frequencies.set(day, (frequencies.get(day) ?? 0) + 1));
  const ranked = [...frequencies].sort((a, b) => b[1] - a[1]);
  return { ...summarize(days), mostCommon: ranked.filter((entry) => entry[1] === ranked[0]?.[1]).map(([day]) => day),
    first: dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString() : null,
    latest: dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString() : null };
}
function calculateEarnings(records: Payslip[]) {
  const groups = new Map<string, { amounts: number[]; ids: Set<string> }>();
  for (const record of records) for (const line of record.lines) {
    const key = earningCategory(line);
    if (!key) continue;
    const group = groups.get(key) ?? { amounts: [], ids: new Set<string>() };
    group.amounts.push(line.amount!); group.ids.add(record.id); groups.set(key, group);
  }
  return [...groups].map(([label, group]) => ({ label, ...summarize(group.amounts), ids: [...group.ids] })).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
}
export function calculateStatistics(records: Payslip[]) {
  const summary = Object.fromEntries(metrics.map((metric) => [metric, summarize(records.map((record) => metricValue(record, metric)))])) as Record<Metric, Summary>;
  const monthly = calculateMonthlyStatistics(records);
  const changes = calculatePayChanges(records);
  const observations: Array<{ text: string; ids: string[] }> = [];
  const highestMonth = [...monthly].filter((month) => month.values.netPay !== null).sort((a, b) => b.values.netPay! - a.values.netPay!)[0];
  if (highestMonth) observations.push({ text: `Your highest-net month in this selection was ${highestMonth.key}.`, ids: highestMonth.ids });
  const lastChange = changes.at(-1);
  if (lastChange?.changes.netPay.percentage !== null && lastChange?.changes.netPay.percentage !== undefined) observations.push({
    text: `Latest net pay ${lastChange.changes.netPay.percentage >= 0 ? "increased" : "decreased"} ${Math.abs(lastChange.changes.netPay.percentage).toFixed(1)}% compared with the previous dated payslip for that employer.`,
    ids: [lastChange.previousId, lastChange.id],
  });
  if (lastChange && lastChange.changes.deductions.amount !== null && lastChange.changes.deductions.amount > 0) observations.push({
    text: `The gross-minus-net difference increased by ${lastChange.changes.deductions.amount.toFixed(2)} GBP compared with the previous dated payslip for that employer.`,
    ids: [lastChange.previousId, lastChange.id],
  });
  const deductions = calculateDeductionStatistics(records);
  if (deductions[0].percentGross !== null) observations.push({ text: `PAYE represented ${deductions[0].percentGross.toFixed(1)}% of gross on payslips with both figures.`, ids: records.filter((record) => finite(record.tax) && finite(record.grossPay) && record.grossPay > 0).map((record) => record.id) });
  const latest = [...records].filter((record) => dateOf(record) !== null).sort((a, b) => dateOf(a)! - dateOf(b)!).at(-1);
  if (latest && finite(latest.hoursWorked) && summary.hoursWorked.mean !== null) {
    const difference = latest.hoursWorked - summary.hoursWorked.mean;
    observations.push({ text: `Latest hours were ${Math.abs(difference).toFixed(1)} ${difference >= 0 ? "above" : "below"} your observed average.`, ids: [latest.id] });
  }
  return {
    count: records.length, ids: records.map((record) => record.id), metrics: summary, monthly,
    yearly: calculateYearlyStatistics(records), employers: calculateEmployerStatistics(records), deductions,
    earnings: calculateEarnings(records), hourly: calculateHourlyStatistics(records), changes,
    consistency: (["grossPay", "netPay", "hoursWorked", "grossHourly"] as Metric[]).map((key) => ({ key, ...calculateConsistency(records.map((record) => metricValue(record, key))) })),
    distributions: (["grossPay", "netPay", "hoursWorked", "grossHourly", "netHourly", "tax", "deductions"] as Metric[]).map((key) => ({ key, ...calculateDistributions(records.map((record) => metricValue(record, key))) })),
    correlations: calculateCorrelations(records), quality: calculateDataQuality(records), reconciliation: calculateReconciliation(records),
      grossNetAnomalies: calculateGrossNetAnomalies(records), templateValidation: calculateTemplateValidation(records),
    frequency: calculateEmployerStatistics(records).map((group) => ({ employer: group.key, ...calculateFrequency(records.filter((record) => group.ids.includes(record.id))) })),
    payDates: calculatePayDates(records), ytd: calculateYtd(records), observations,
  };
}
export type Statistics = ReturnType<typeof calculateStatistics>;

export function previousPeriod(records: Payslip[], filter: Filter, now = new Date()) {
  const bounds = filterBounds(filter, now);
  if (bounds.start === null || bounds.end === null || bounds.start > bounds.end) return null;
  const length = bounds.end - bounds.start + 1;
  const filtered = filterPayslips(records, { ...filter, range: "all" }, now);
  const previous = filtered.filter((record) => dateOf(record) !== null && dateOf(record)! >= bounds.start! - length && dateOf(record)! < bounds.start!);
  return previous.length ? { start: new Date(bounds.start - length).toISOString(), end: new Date(bounds.start - 1).toISOString(), statistics: calculateStatistics(previous) } : null;
}
