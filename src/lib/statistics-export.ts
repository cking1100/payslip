import type { Statistics, Filter } from "./statistics";
import { metricDefinitions } from "./statistics";
import { exportCsv } from "./format";

export function statisticsRows(statistics: Statistics) {
  const rows: Array<Record<string, unknown>> = [];
  const add = (section: string, metric: string, measure: string, value: unknown) => rows.push({ section, metric, measure, value: value ?? "" });
  const visit = (value: unknown, section: string, path = "") => {
    if (value === null || typeof value !== "object") { add(section, path, "value", value); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === "ids" || key === "id" || key === "previousId" || key === "points") continue;
      visit(child, section, path ? `${path}.${key}` : key);
    }
  };
  for (const [key, value] of Object.entries(statistics.metrics)) {
    for (const [measure, amount] of Object.entries(value)) add("overview", metricDefinitions[key as keyof typeof metricDefinitions][0], measure, amount);
  }
  for (const [section, value] of Object.entries(statistics)) if (section !== "metrics" && section !== "ids") visit(value, section);
  return rows;
}
export function exportStatistics(statistics: Statistics, filter: Filter, format: "csv" | "json") {
  if (format === "csv") {
    const rows = statisticsRows(statistics);
    rows.unshift(...Object.entries(filter).map(([key, value]) => ({ section: "filter", metric: key, measure: "value", value })));
    exportCsv(rows, "payslip-statistics.csv");
    return;
  }
  const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), filter, statistics }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "payslip-statistics.json"; link.click();
  URL.revokeObjectURL(url);
}
