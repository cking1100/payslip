"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, X } from "lucide-react";
import type { Payslip } from "@/lib/types";
import {
  calculateStatistics, defaultFilter, filterPayslips, metricDefinitions, metricValue, metrics,
  previousPeriod, type Metric, type Filter, type PeriodStatistics, type Unit,
} from "@/lib/statistics";
import { shortDate, money } from "@/lib/format";
import { readJsonResponse } from "@/lib/client-response";
import { listenDataChanged } from "@/lib/client-data";
import { exportStatistics } from "@/lib/statistics-export";
import { Donut, LineChart, Scatter, statFormat } from "@/components/StatisticsCharts";
import { StatisticsTable, type TableColumn, type TableRow } from "@/components/StatisticsTable";
import { Modal } from "@/components/Modal";

const tabs = ["Overview", "Pay & deductions", "Hours & earnings", "Patterns", "Periods", "Data quality"] as const;
type Tab = typeof tabs[number];
const units = (key: Metric): Unit => metricDefinitions[key][1];
const fmt = (unit: Unit = "money") => (value: string | number | null) => statFormat(typeof value === "number" ? value : null, unit);
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="rounded-lg border border-line bg-white p-4 sm:p-6"><h2 className="text-base font-semibold">{title}</h2>{note && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">{note}</p>}<div className="mt-5">{children}</div></section>;
}
function MetadataHistory({ records, field, title, onSelect }: { records: Payslip[]; field: string; title: string; onSelect: (title: string, ids: string[]) => void }) {
  const rows = records.flatMap((record) => record.fields.filter((item) => item.key === field && item.value).map((item) => ({
    id: item.id, values: [shortDate(record.payDate), record.employer ?? "\u2014", item.value, item.manuallyCorrected ? "Corrected" : item.confidence], ids: [record.id],
  })));
  return rows.length ? <div className="mt-5"><h3 className="mb-2 text-sm font-medium">{title} (observed only)</h3><StatisticsTable label={title} columns={[{ label: "Date" }, { label: "Employer" }, { label: title }, { label: "Confidence" }]} rows={rows} onSelect={onSelect} /></div> : <p className="mt-4 text-xs text-muted">{title} was not extracted. No code or plan has been inferred.</p>;
}

export default function StatisticsPage() {
  const [records, setRecords] = useState<Payslip[]>([]);
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<{ title: string; ids: string[] } | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const response = await fetch("/api/payslips", { cache: "no-store" });
      const result = await readJsonResponse<Payslip[] | { error: string }>(response);
      if (!response.ok || !Array.isArray(result)) throw new Error("Statistics couldn't be loaded from local storage.");
      if (sequence === loadSequence.current) { setRecords(result); setError(""); }
    } catch (failure) { if (sequence === loadSequence.current) setError(failure instanceof Error ? failure.message : "Statistics couldn't be loaded."); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return listenDataChanged((cleared) => { if (cleared) { setRecords([]); setFilter(defaultFilter); setSelection(null); } void load(); }); }, [load]);
  const shown = useMemo(() => filterPayslips(records, filter), [records, filter]);
  const stats = useMemo(() => calculateStatistics(shown), [shown]);
  const prior = useMemo(() => previousPeriod(records, filter), [records, filter]);
  const employers = useMemo(() => [...new Set(records.map((record) => record.employer || "Unknown employer"))].sort(), [records]);
  const select = (title: string, ids: string[]) => { setSelection({ title, ids }); setSelectedPage(0); };
  const hasValue = (key: Metric) => stats.metrics[key].count > 0;
  const contributorIds = (key: Metric) => shown.filter((record) => metricValue(record, key) !== null).map((record) => record.id);
  const series = (keys: Metric[], periods: PeriodStatistics[] = stats.monthly) => keys.map((key) => ({
    label: metricDefinitions[key][0],
    points: periods.map((period) => ({ label: period.key, value: period.values[key], ids: period.ids.filter((id) => {
      const record = shown.find((item) => item.id === id);
      return record && metricValue(record, key) !== null;
    }) })),
  }));
  const summaryColumns: TableColumn[] = [
    { label: "Measure" }, { label: "Available", format: fmt("number") }, { label: "Total", format: fmt() },
    { label: "Average", format: fmt() }, { label: "Median", format: fmt() }, { label: "Lowest", format: fmt() }, { label: "Highest", format: fmt() },
  ];
  const summaryTable = (keys: Metric[]) => <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-right text-xs">
    <thead className="bg-paper"><tr>{summaryColumns.map((column, index) => <th key={column.label} className={`p-3 font-medium text-muted ${index === 0 ? "text-left" : ""}`}>{column.label}</th>)}</tr></thead>
    <tbody>{keys.map((key) => {
      const metric = stats.metrics[key], unit = units(key);
      return <tr key={key} className="tabular border-b border-line last:border-0">
        <th className="p-3 text-left font-medium"><button onClick={() => select(metricDefinitions[key][0], contributorIds(key))} className="text-accent hover:underline">{metricDefinitions[key][0]}</button></th>
        <td className="p-3 text-muted">{metric.count} / {shown.length}</td>
        {[unit === "percent" || key.includes("Hourly") || key === "hourlyRate" || key === "overtimeRate" || key === "pensionRatio" ? null : metric.total, metric.mean, metric.median, metric.min, metric.max].map((value, index) => <td key={index} className="p-3">
          {index >= 3 && value !== null ? <button className="hover:text-accent hover:underline" onClick={() => select(`${index === 3 ? "Lowest" : "Highest"} ${metricDefinitions[key][0]}`, shown.filter((record) => metricValue(record, key) === value).map((record) => record.id))}>{statFormat(value, unit)}</button> : statFormat(value, unit)}
        </td>)}</tr>;
    })}</tbody></table></div>;
  const periodTable = (periods: PeriodStatistics[], kind: string, yearly = false) => {
    const keys: Metric[] = ["grossPay", "netPay", "totalDeductions", "tax", "nationalInsurance", "pension", "studentLoan", "otherDeductions", "deductions", "hoursWorked", "holidayHours", "totalPaidHours", "grossHourly", "netHourly", "netPercent"];
    const columns: TableColumn[] = [{ label: kind }, { label: "Count", format: fmt("number") }, ...keys.map((key) => ({ label: metricDefinitions[key][0], format: fmt(units(key)) })),
      ...(yearly ? [{ label: "Average gross", format: fmt() }, { label: "Average net", format: fmt() }, { label: "Average hourly", format: fmt() }] : []),
      { label: "Gross change", format: fmt() }, { label: "Net change", format: fmt() }, { label: "Gross change %", format: fmt("percent") }, { label: "Net change %", format: fmt("percent") }];
    const rows: TableRow[] = periods.map((period) => ({ id: period.key, ids: period.ids,
      values: [period.key, period.count, ...keys.map((key) => period.values[key]), ...(yearly ? [period.averageGross, period.averageNet, period.averageHourly] : []), period.grossChange, period.netChange, period.grossPercentChange, period.netPercentChange] }));
    return <StatisticsTable columns={columns} rows={rows} label={`${kind} totals`} onSelect={select} />;
  };
  const selectedRecords = useMemo(() => {
    const ids = new Set(selection?.ids ?? []);
    return records.filter((record) => ids.has(record.id));
  }, [selection, records]);
  const allocated = shown.filter((record) => stats.reconciliation.checks.some((check) => check.id === record.id && Math.abs(check.discrepancy) <= 0.01));
  const allocationEntries = (["netPay", "tax", "nationalInsurance", "pension", "studentLoan", "otherDeductions"] as Metric[]).map((key) => ({
    label: metricDefinitions[key][0], value: allocated.reduce((sum, record) => sum + (metricValue(record, key) ?? 0), 0), ids: allocated.map((record) => record.id),
  }));
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Statistics</h1><p className="mt-1 text-sm text-muted">Explore your pay. Calculated locally from observed, editable payslip values.</p></div>
      <div className="flex gap-2">{(["csv", "json"] as const).map((format) => <button key={format} disabled={!shown.length} onClick={() => exportStatistics(stats, filter, format)} className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-xs disabled:opacity-40"><Download size={14} />Export {format.toUpperCase()}</button>)}</div></header>
    {error && <div role="alert" className="rounded border border-red-200 bg-white p-4 text-sm text-red-800">{error} <button className="underline" onClick={() => void load()}>Retry</button></div>}
    {loading ? <p role="status" className="py-10 text-sm text-muted">Loading local statistics...</p> : !records.length ? <Section title="Import payslips to start analysing your pay."><Link href="/" className="text-sm text-accent hover:underline">Import your first payslip</Link></Section> : <>
      <section aria-label="Statistics filters" className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-36 flex-1 text-xs text-muted">Period<select className="mt-1 block w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink" value={filter.range} onChange={(event) => setFilter({ ...filter, range: event.target.value as Filter["range"] })}>
            {[["all", "All time"], ["year", "This year"], ["12", "Last 12 months"], ["6", "Last 6 months"], ["3", "Last 3 months"], ["custom", "Custom"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="min-w-36 flex-1 text-xs text-muted">Employer<select value={filter.employer} onChange={(event) => setFilter({ ...filter, employer: event.target.value })} className="mt-1 block w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink"><option value="">All employers</option>{employers.map((employer) => <option key={employer}>{employer}</option>)}</select></label>
          <label className="min-w-36 flex-1 text-xs text-muted">Pay frequency (inferred)<select value={filter.frequency} onChange={(event) => setFilter({ ...filter, frequency: event.target.value })} className="mt-1 block w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink"><option value="">All frequencies</option>{["Weekly", "Fortnightly", "Four-weekly", "Monthly", "Other", "Uncertain"].map((value) => <option key={value}>{value}</option>)}</select></label>
          {filter.range === "custom" && ["start", "end"].map((key) => <label key={key} className="text-xs text-muted">{key === "start" ? "From" : "To"}<input type="date" value={filter[key as "start" | "end"] || ""} onChange={(event) => setFilter({ ...filter, [key]: event.target.value })} className="mt-1 block rounded border border-line px-2 py-2 text-sm text-ink" /></label>)}
          <button onClick={() => { setFilter(defaultFilter); setSelection(null); }} className="rounded border border-line px-3 py-2 text-sm">Reset filters</button>
        </div>
        <p aria-live="polite" className="mt-3 text-xs text-muted">{stats.count.toLocaleString()} of {records.length.toLocaleString()} payslips included · First: {shortDate(stats.payDates.first)} · Latest: {shortDate(stats.payDates.latest)}</p>
        {filter.start && filter.end && filter.start > filter.end && <p role="alert" className="mt-2 text-xs text-red-700">Start date must be before end date.</p>}
      </section>
      {!shown.length ? <Section title="No payslips match these filters."><button onClick={() => setFilter(defaultFilter)} className="text-sm text-accent underline">Reset filters</button></Section> : <>
        <p className="text-xs leading-relaxed text-muted">Unknown values are excluded, never treated as zero. Each average uses only observed values. Low-confidence extractions and email-date fallbacks may distort results: <button onClick={() => setTab("Data quality")} className="text-accent underline">review data quality</button>. Select figures or chart points to inspect their sources.</p>
        <div role="tablist" aria-label="Statistics sections" className="flex flex-wrap gap-1 border-b border-line pb-2">{tabs.map((item) => <button key={item} id={`tab-${item.replaceAll(" ", "-")}`} role="tab" aria-selected={tab === item} aria-controls="statistics-panel" onClick={() => setTab(item)} className={`rounded-md px-3 py-2 text-sm ${tab === item ? "bg-accent text-white" : "text-muted hover:bg-white"}`}>{item}</button>)}</div>
        <div id="statistics-panel" role="tabpanel" aria-labelledby={`tab-${tab.replaceAll(" ", "-")}`} className="space-y-5">
          {tab === "Overview" && <>
            {stats.grossNetAnomalies.netAboveGross > 0 && <section role="status" className={`rounded-md border px-4 py-3 ${stats.grossNetAnomalies.unexplained ? "border-amber-300 bg-[#fffaf0]" : "border-emerald-300 bg-emerald-50"}`}>
              <p className="text-sm font-semibold text-amber-950">{stats.grossNetAnomalies.unexplained ? "Review gross and net extractions" : "Net above gross reconciles to labelled deductions"}</p>
              <p className="mt-1 text-sm text-amber-900">{stats.grossNetAnomalies.netAboveGross} of {stats.grossNetAnomalies.paired} payslips with both figures have net pay greater than gross; {stats.grossNetAnomalies.explained} reconcile to labelled total deductions and {stats.grossNetAnomalies.unexplained} remain unexplained. Summary figures may be unreliable until the extracted values are reviewed.</p>
              {stats.grossNetAnomalies.ids.length > 0 && <button onClick={() => select("Unexplained net pay above gross", stats.grossNetAnomalies.ids)} className="mt-2 text-sm font-medium text-amber-950 underline underline-offset-2">Review unexplained payslips</button>}
            </section>}
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(["grossPay", "netPay", "totalDeductions", "deductions", "hoursWorked", "holidayHours", "totalPaidHours"] as Metric[]).map((key) => <button key={key} onClick={() => select(metricDefinitions[key][0], contributorIds(key))} className="rounded-lg border border-line bg-white p-4 text-left hover:border-accent">
              <span className="text-xs text-muted">{metricDefinitions[key][0]}</span><strong className="tabular mt-2 block text-xl">{statFormat(stats.metrics[key].total, units(key))}</strong><span className="mt-1 block text-xs text-muted">{stats.metrics[key].count} observed values</span>
              {prior && prior.statistics.metrics[key].total !== null && stats.metrics[key].total !== null && <span className="mt-2 block text-xs text-accent">{statFormat(stats.metrics[key].total! - prior.statistics.metrics[key].total!, units(key))} vs prior equal-length window</span>}
            </button>)}</section>
            {filter.range !== "all" && <p className="text-xs text-muted">{prior ? `Previous equal-length calendar window: ${shortDate(prior.start)} to ${shortDate(prior.end)}. Coverage may differ; this is not a prediction or like-for-like payroll adjustment.` : "No previous equivalent period with observed payslips is available; no comparison has been invented."}</p>}
            <Section title="Gross, net and deductions" note="Gross, net and deductions come from labelled period totals when available. Gross - net difference is shown separately and is not a verified deductions figure."><LineChart series={series(["grossPay", "netPay", "totalDeductions", "deductions"])} onSelect={select} /></Section>
            <div className="grid gap-5 lg:grid-cols-3">
              <Section title="Where gross goes" note={`Only fully itemised, reconciled records (${allocated.length}/${shown.length}) are allocated. Missing deductions do not imply zero.`}><Donut entries={allocationEntries} onSelect={select} /></Section>
              <Section title="Deduction composition" note="Share of the observed component sum, not assumed total deductions. Each component can have different coverage."><Donut entries={stats.deductions.filter((row) => row.total !== null).map((row) => ({ label: metricDefinitions[row.key][0], value: row.total!, ids: contributorIds(row.key) }))} onSelect={select} /></Section>
              <Section title="Earnings composition" note="Observed current-period earning lines only. Gross/net summaries, rates, hours and YTD are excluded."><Donut entries={stats.earnings.map((row) => ({ label: row.label, value: row.total!, ids: row.ids }))} onSelect={select} /></Section>
            </div>
            <Section title="Pay summary" note="Totals are not meaningful for rates and percentages, so those cells remain blank. Hourly averages are per-payslip, not pay-weighted.">{summaryTable(metrics.filter((key) => !["overtime", "overtimeHours", "overtimeRate", "overtimePercent", "bonus", "holiday", "employerPension", "combinedPension", "pensionRatio"].includes(key) || hasValue(key)))}</Section>
            <Section title="Observations" note="Mathematical descriptions of this selection, not tax or financial advice.">{stats.observations.length ? <ul className="space-y-3">{stats.observations.map((item, index) => <li key={index}><button onClick={() => select("Observation sources", item.ids)} className="text-left text-sm hover:text-accent hover:underline">{item.text}</button></li>)}</ul> : <p className="text-sm text-muted">Not enough observed data for comparisons.</p>}</Section>
          </>}
          {tab === "Pay & deductions" && <>
            <Section title="Deduction breakdown" note="Component totals include only extracted values and may have different coverage; missing values are not zero. The separate gross-minus-net difference is a signed arithmetic comparison, not a verified total-deductions figure. Rates use matched observations only. These are observed effective rates, not statutory tax calculations.">
              <StatisticsTable label="Deduction statistics" onSelect={select} columns={[{ label: "Type" }, { label: "Count", format: fmt("number") }, { label: "Total", format: fmt() }, { label: "Average", format: fmt() }, { label: "Median", format: fmt() }, { label: "Lowest", format: fmt() }, { label: "Highest", format: fmt() }, { label: "% gross", format: fmt("percent") }, { label: "% deductions", format: fmt("percent") }]}
                rows={stats.deductions.map((row) => ({ id: row.key, ids: contributorIds(row.key), values: [metricDefinitions[row.key][0], row.count, row.total, row.mean, row.median, row.min, row.max, row.percentGross, row.percentDeductions] }))} />
            </Section>
            <Section title="Deduction rate and retention" note="Gross - net difference and retention ratios use matched gross and net values. Labelled total deductions remain separate.">{summaryTable(["totalDeductions", "deductions", "deductionRate", "netPercent"])}<div className="mt-5"><LineChart series={series(["netPercent", "deductionRate"])} unit="percent" onSelect={select} /></div></Section>
            {(["tax", "nationalInsurance"] as const).map((key) => <Section key={key} title={metricDefinitions[key][0]} note="Includes observed totals, average, median, extrema and per-payslip effective rate.">{summaryTable([key, key === "tax" ? "taxRate" : "niRate"])}
              <div className="mt-5 grid gap-6 lg:grid-cols-2"><LineChart series={series([key])} onSelect={select} /><LineChart series={series([key === "tax" ? "taxRate" : "niRate"])} unit="percent" onSelect={select} /></div>
              <div className="mt-5"><Scatter points={stats.correlations.find((pair) => pair.x === "grossPay" && pair.y === key)!.points} xLabel="Gross pay" yLabel={metricDefinitions[key][0]} xUnit="money" yUnit="money" onSelect={select} /></div>
              <MetadataHistory records={shown} field={key === "tax" ? "taxCode" : "niCategory"} title={key === "tax" ? "Tax code" : "NI category"} onSelect={select} />
            </Section>)}
            <Section title="Pension" note="Employer contributions are shown only where explicitly extracted; combined totals require both employee and employer figures.">{summaryTable(["pension", "employerPension", "combinedPension", "pensionRatio"])}<div className="mt-5"><LineChart series={series(["pension", "employerPension"])} onSelect={select} /></div></Section>
            {hasValue("studentLoan") && <Section title="Student loan" note="Observed repayment figures; no repayment plan is guessed.">{summaryTable(["studentLoan"])}<p className="mt-3 text-xs text-muted">{statFormat(stats.deductions[3].percentGross, "percent")} of matched gross · {statFormat(stats.deductions[3].percentDeductions, "percent")} of matched total deductions</p><LineChart series={series(["studentLoan"])} onSelect={select} /><MetadataHistory records={shown} field="studentLoanPlan" title="Loan plan" onSelect={select} /></Section>}
          </>}
          {tab === "Hours & earnings" && <>
            <Section title="Hours and hourly pay" note="Hours worked and BaseA rate are read from the BaseA(HRS) row. HOLW hours stay separate. Effective rates are derived from pay divided by hours and do not replace printed rates.">{summaryTable(["hoursWorked", "holidayHours", "totalPaidHours", "grossHourly", "netHourly", "hourlyRate"])}
              <div className="mt-6 grid gap-6 lg:grid-cols-2"><LineChart series={series(["hoursWorked", "holidayHours", "totalPaidHours"])} unit="number" onSelect={select} /><LineChart series={series(["grossHourly", "netHourly", "hourlyRate"])} onSelect={select} /></div>
              <div className="mt-6 grid gap-6 lg:grid-cols-3">{(["grossPay", "netPay", "grossHourly"] as Metric[]).map((key) => <Scatter key={key} points={shown.flatMap((record) => { const value = metricValue(record, key); return record.hoursWorked !== null && value !== null ? [{ id: record.id, x: record.hoursWorked, y: value }] : []; })} xLabel="Hours" yLabel={metricDefinitions[key][0]} xUnit="number" yUnit="money" onSelect={select} />)}</div>
            </Section>
            {hasValue("overtime") && <Section title="Overtime" note="Only explicit current-period overtime lines; no missing overtime hours are guessed.">{summaryTable(["overtime", "overtimeHours", "overtimeRate", "overtimePercent"])}<LineChart series={series(["overtime"])} onSelect={select} /><LineChart series={series(["overtimePercent"])} unit="percent" onSelect={select} /></Section>}
            {(["bonus", "holiday"] as const).map((key) => hasValue(key) && <Section key={key} title={key === "bonus" ? "Bonus pay" : "Holiday pay"}>{summaryTable([key])}<p className="mt-3 text-xs text-muted">Found on {stats.metrics[key].count} payslips ({(stats.metrics[key].count / shown.length * 100).toFixed(1)}% of this selection). Positive-payment frequency: {shown.filter((record) => (metricValue(record, key) ?? 0) > 0).length} payslips. Share of matched gross: {statFormat((() => { const pairs = shown.filter((record) => metricValue(record, key) !== null && record.grossPay !== null && record.grossPay > 0); const total = pairs.reduce((sum, record) => sum + record.grossPay!, 0); return total > 0 ? pairs.reduce((sum, record) => sum + metricValue(record, key)!, 0) / total * 100 : null; })(), "percent")}</p><div className="mt-4"><LineChart series={series([key])} onSelect={select} /></div></Section>)}
            {!hasValue("overtime") && !hasValue("bonus") && !hasValue("holiday") && <p className="text-sm text-muted">No explicit overtime, bonus or holiday earnings were extracted in this selection.</p>}
          </>}
          {tab === "Patterns" && <>
            <Section title="Pay changes" note="Compared with the previous dated payslip for the same employer within the selection. Same-day records are not compared; percentages need a nonzero baseline.">
              {(["grossPay", "netPay", "tax", "nationalInsurance", "pension", "hoursWorked", "grossHourly", "netHourly"] as Metric[]).map((key) => {
                const values = stats.changes.filter((change) => change.changes[key].amount !== null).sort((a, b) => a.changes[key].amount! - b.changes[key].amount!);
                return <div key={key} className="mt-3 flex flex-wrap justify-between gap-2 border-b border-line pb-3 text-xs"><span>{metricDefinitions[key][0]}</span>
                  <span className="flex gap-4">{[["Largest decrease", values[0]], ["Largest increase", values.at(-1)]] .map(([label, item]) => {
                    const change = typeof item === "object" ? item : undefined;
                    const available = change && (label === "Largest decrease" ? change.changes[key].amount! < 0 : change.changes[key].amount! > 0);
                    return <button key={String(label)} disabled={!available} onClick={() => change && select(String(label), [change.previousId, change.id])} className="text-accent disabled:text-muted">{String(label)}: {available ? statFormat(change.changes[key].amount, units(key)) : "\u2014"}</button>;
                  })}</span></div>;
              })}
              <div className="mt-5"><LineChart series={["grossPay", "netPay"].map((key) => ({ label: `${metricDefinitions[key as Metric][0]} change`, points: stats.changes.map((change) => ({ label: change.date.slice(0, 10), value: change.changes[key as Metric].amount, ids: [change.previousId, change.id] })) }))} onSelect={select} /></div>
              <StatisticsTable label="Pay change timeline" onSelect={select} columns={[{ label: "Date" }, ...(["grossPay", "netPay", "tax", "nationalInsurance", "pension", "hoursWorked", "grossHourly", "netHourly"] as Metric[]).flatMap((key) => [{ label: `${metricDefinitions[key][0]} change`, format: fmt(units(key)) }, { label: "Change %", format: fmt("percent") }])]}
                rows={stats.changes.map((change) => ({ id: change.id, ids: [change.previousId, change.id], values: [change.date.slice(0, 10), ...(["grossPay", "netPay", "tax", "nationalInsurance", "pension", "hoursWorked", "grossHourly", "netHourly"] as Metric[]).flatMap((key) => [change.changes[key].amount, change.changes[key].percentage])] }))} />
            </Section>
            <Section title="Consistency" note="Population variance and standard deviation. Coefficient of variation = SD / |mean|. Very consistent: CV <=5%; mostly consistent: <=15%; variable: <=30%; highly variable: >30%. Fewer than two observations or undefined CV: insufficient. Units of variance are squared.">
              <StatisticsTable label="Pay consistency" onSelect={select} columns={[{ label: "Metric" }, { label: "Mean", format: fmt("number") }, { label: "Median", format: fmt("number") }, { label: "Min", format: fmt("number") }, { label: "Max", format: fmt("number") }, { label: "Range", format: fmt("number") }, { label: "Variance", format: fmt("number") }, { label: "SD", format: fmt("number") }, { label: "CV", format: fmt("percent") }, { label: "Classification" }]}
                rows={stats.consistency.map((row) => ({ id: row.key, ids: contributorIds(row.key), values: [metricDefinitions[row.key][0], row.mean, row.median, row.min, row.max, row.range, row.variance, row.standardDeviation, row.coefficient, row.classification] }))} />
            </Section>
            <Section title="Distributions" note="Interpolated quartiles (inclusive / type 7), min, Q1, median, Q3 and max. Select a histogram bin to review the records in it.">
              <div className="grid gap-6 sm:grid-cols-2">{stats.distributions.map((distribution) => <div key={distribution.key}><h3 className="text-sm font-medium">{metricDefinitions[distribution.key][0]}</h3>
                <dl className="mt-2 grid grid-cols-5 gap-2 text-[11px] text-muted">{[["Min", distribution.min], ["Q1", distribution.q1], ["Median", distribution.median], ["Q3", distribution.q3], ["Max", distribution.max]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd className="tabular mt-1">{statFormat(typeof value === "number" ? value : null, units(distribution.key))}</dd></div>)}</dl>
                {distribution.min !== null && distribution.max !== null && <svg className="mt-2 h-8 w-full" viewBox="0 0 400 32" role="img" aria-label={`${metricDefinitions[distribution.key][0]} box plot`}><line x1="10" x2="390" y1="16" y2="16" stroke="#95a887" /><rect x={10 + (distribution.q1! - distribution.min) / (distribution.range || 1) * 380} y="6" width={Math.max(1, (distribution.q3! - distribution.q1!) / (distribution.range || 1) * 380)} height="20" fill="#edf2ee" stroke="#3d6952" /><line x1={10 + (distribution.median! - distribution.min) / (distribution.range || 1) * 380} x2={10 + (distribution.median! - distribution.min) / (distribution.range || 1) * 380} y1="6" y2="26" stroke="#3d6952" /></svg>}
                <div className="mt-2 flex h-24 items-end gap-1 border-b border-line">{distribution.bins.map((bin, index) => <button key={index} title={`${statFormat(bin.start, units(distribution.key))} to ${statFormat(bin.end, units(distribution.key))}: ${bin.count} payslips`} aria-label={`${metricDefinitions[distribution.key][0]} bin ${index + 1}, ${bin.count} payslips`} className="min-w-0 flex-1 rounded-t-sm bg-accent/65 hover:bg-accent" style={{ height: `${Math.max(2, bin.count / Math.max(1, ...distribution.bins.map((item) => item.count)) * 100)}%` }}
                  onClick={() => select(`${metricDefinitions[distribution.key][0]} distribution`, shown.filter((record) => { const value = metricValue(record, distribution.key); return value !== null && value >= bin.start && (index === distribution.bins.length - 1 ? value <= bin.end : value < bin.end); }).map((record) => record.id))} />)}</div>
                {!distribution.count && <p className="mt-2 text-xs text-muted">No observed values.</p>}
              </div>)}</div>
            </Section>
            <Section title="Correlations" note="Pearson r requires at least three nonconstant paired observations. Correlation does not prove causation.">
              <div className="grid gap-6 lg:grid-cols-2">{stats.correlations.filter((pair) => pair.x !== "overtime" || hasValue("overtime")).map((pair) => <div key={`${pair.x}-${pair.y}`}><h3 className="text-sm font-medium">{metricDefinitions[pair.x][0]} / {metricDefinitions[pair.y][0]}</h3><p className="mt-1 text-xs text-muted">r = {pair.coefficient === null ? "Not enough nonconstant data" : pair.coefficient.toFixed(3)} · {pair.points.length} pairs</p><Scatter points={pair.points} xLabel={metricDefinitions[pair.x][0]} yLabel={metricDefinitions[pair.y][0]} xUnit={units(pair.x)} yUnit={units(pair.y)} onSelect={select} /></div>)}</div>
            </Section>
          </>}
          {tab === "Periods" && <>
            <Section title="Monthly breakdown" note="Totals use observed dated values. Hourly and retention ratios use matched pay/hours or pay/gross observations; change columns compare previous observed month, even across gaps.">{periodTable(stats.monthly, "Month")}</Section>
            <Section title="Yearly comparison" note="Calendar-year totals and changes, not summed printed YTD figures.">{periodTable(stats.yearly, "Year", true)}<div className="mt-5"><LineChart series={series(["grossPay", "netPay"], stats.yearly)} onSelect={select} /></div></Section>
            {stats.employers.length > 1 && <Section title="Employer comparison" note="Unknown employers are kept separate. Employer change columns are not meaningful and are omitted.">
              <StatisticsTable label="Employer comparison" onSelect={select} columns={[{ label: "Employer" }, { label: "Count", format: fmt("number") }, ...(["grossPay", "netPay", "tax", "nationalInsurance", "pension", "deductions", "hoursWorked", "grossHourly", "netHourly", "netPercent"] as Metric[]).map((key) => ({ label: metricDefinitions[key][0], format: fmt(units(key)) })), { label: "Average gross", format: fmt() }, { label: "Average net", format: fmt() }]}
                rows={stats.employers.map((row) => ({ id: row.key, ids: row.ids, values: [row.key, row.count, ...(["grossPay", "netPay", "tax", "nationalInsurance", "pension", "deductions", "hoursWorked", "grossHourly", "netHourly", "netPercent"] as Metric[]).map((key) => row.values[key]), row.averageGross, row.averageNet] }))} />
            </Section>}
            <Section title="Pay intervals and frequency" note="Inferred per employer from distinct pay dates, with at least two gaps and 70% in a band: weekly 5-9 days, fortnightly 12-16, four-weekly 26-29, monthly 28-33. Overlapping bands and missing imports make this uncertain; this is not an extracted contractual frequency.">
              <StatisticsTable label="Pay frequency" onSelect={select} columns={[{ label: "Employer" }, { label: "Inferred" }, { label: "Gap matches", format: fmt("percent") }, { label: "Average days", format: fmt("number") }, { label: "Median days", format: fmt("number") }, { label: "Shortest gap", format: fmt("number") }, { label: "Longest gap", format: fmt("number") }]}
                rows={stats.frequency.map((row) => ({ id: row.employer, ids: shown.filter((record) => (record.employer || "Unknown employer") === row.employer).map((record) => record.id), values: [row.employer, row.classification, row.confidence, row.mean, row.median, row.min, row.max] }))} />
            </Section>
            <Section title="Pay dates"><dl className="grid gap-4 sm:grid-cols-3">{[["Most common payday", stats.payDates.mostCommon.join(", ") || "\u2014"], ["Average day of month", statFormat(stats.payDates.mean, "number")], ["Median day of month", statFormat(stats.payDates.median, "number")], ["Earliest date", shortDate(stats.payDates.first)], ["Latest date", shortDate(stats.payDates.latest)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="tabular mt-1 text-sm">{value}</dd></div>)}</dl></Section>
          </>}
          {tab === "Data quality" && <>
            {stats.templateValidation.checked > 0 && <Section title="BaseA row validation" note="The printed BaseA amount remains authoritative. The hours × rate calculation is only a review check.">
              <p className="text-sm">{stats.templateValidation.passed} of {stats.templateValidation.checked} rows reconcile to the printed gross within two pence.</p>
              {stats.templateValidation.reviewIds.length > 0 && <button onClick={() => select("BaseA rows to review", stats.templateValidation.reviewIds)} className="mt-2 text-sm text-amber-800 underline">Review {stats.templateValidation.reviewIds.length} unreconciled rows</button>}
            </Section>}
            <Section title="Coverage" note="Availability is not accuracy. Review the source and confidence in each payslip before relying on these calculations.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{stats.quality.map((row) => <button key={row.key} onClick={() => select(`${row.key} coverage`, shown.filter((record) => row.key === "ytd" ? [record.grossYtd, record.netYtd, record.taxYtd, record.nationalInsuranceYtd, record.pensionYtd].some((value) => value !== null) : row.key === "employer" ? Boolean(record.employer) : row.key === "payDate" ? Boolean(record.payDate) : row.key in metricDefinitions ? metricValue(record, row.key as Metric) !== null : false).map((record) => record.id))} className="text-left">
                <span className="flex justify-between text-xs"><span>{row.key in metricDefinitions ? metricDefinitions[row.key as Metric][0] : row.key === "ytd" ? "Printed YTD" : row.key === "payDate" ? "Pay date" : "Employer"}</span><span className="tabular text-muted">{row.available}/{row.total} · {row.percentage.toFixed(1)}%</span></span><span className="mt-2 block h-1 rounded bg-paper"><span className="block h-1 rounded bg-accent/70" style={{ width: `${row.percentage}%` }} /></span>
              </button>)}</div>
              <div className="mt-5 flex flex-wrap gap-4 text-xs">{[
                { label: "Low-confidence or unverified fields", matches: shown.filter((record) => record.fields.some((field) => field.confidence === "Low" && !field.manuallyCorrected)) },
                { label: "Email-date fallback", matches: shown.filter((record) => record.fields.some((field) => field.key === "payDate" && field.label === "Email date (fallback)" && !field.manuallyCorrected)) },
                { label: "Unexplained net exceeds gross", matches: shown.filter((record) => stats.grossNetAnomalies.ids.includes(record.id)) },
                { label: "Net exceeds gross; reconciled", matches: shown.filter((record) => record.grossPay !== null && record.netPay !== null && record.netPay > record.grossPay && !stats.grossNetAnomalies.ids.includes(record.id)) },
              ].map((item) => <button key={item.label} className="text-amber-800 underline" onClick={() => select(item.label, item.matches.map((record) => record.id))}>{item.label}: {item.matches.length}</button>)}</div>
            </Section>
            <Section title="Reconciliation" note="Gross - observed PAYE - NI - employee pension - student loan - other deductions = net. Checked only when all components are explicitly known. Missing is not zero; tolerance is one penny. We never alter records to force a match.">
              <dl className="grid gap-4 sm:grid-cols-5">{[["Checked", String(stats.reconciliation.checked)], ["Reconciled", String(stats.reconciliation.reconciled)], ["Discrepant", String(stats.reconciliation.discrepancies)], ["Largest discrepancy", money(stats.reconciliation.largest)], ["Average absolute discrepancy", money(stats.reconciliation.average)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="tabular mt-1 text-lg">{value}</dd></div>)}</dl>
              <button onClick={() => select("Reconciliation discrepancies", stats.reconciliation.checks.filter((check) => Math.abs(check.discrepancy) > 0.01).map((check) => check.id))} className="mt-4 text-sm text-accent underline">Review discrepant payslips</button><p className="mt-2 text-xs text-muted">{shown.length - stats.reconciliation.checked} payslips have insufficient itemisation for this check.</p>
            </Section>
            <Section title="Printed year-to-date figures" note="Latest relevant printed figures per employer, using the UK tax year (6 April-5 April). Printed YTD is NEVER summed. Calculated totals use only selected observed records in that tax year up to the printed date; differences can reflect incomplete imports or filtering, not a payroll error.">
              {stats.ytd.length ? stats.ytd.map((row) => <div key={row.employer} className="mb-5 last:mb-0"><h3 className="text-sm font-medium">{row.employer} · Printed {shortDate(row.date)}</h3><p className="mt-1 text-xs text-muted">Tax year starts {shortDate(row.start)} · {row.ids.length} selected payslips. {row.completePeriod ? "First selected date is near the tax-year start; completeness still cannot be proven." : "Partial tax-year coverage."}</p>
                <div className="mt-3"><StatisticsTable label="Printed versus calculated YTD" onSelect={select} columns={[{ label: "Metric" }, { label: "Printed YTD", format: fmt() }, { label: "Selected calculated total", format: fmt() }, { label: "Printed minus calculated", format: fmt() }]}
                  rows={Object.entries(row.values).map(([key, value]) => ({ id: key, ids: [...new Set([...row.ids, row.id])], values: [metricDefinitions[key as Metric][0], value.printed, value.calculated, value.discrepancy] }))} /></div>
              </div>) : <p className="text-sm text-muted">No printed YTD figures are available.</p>}
            </Section>
          </>}
        </div>
      </>}
    </>}
    {selection && <Modal titleId="statistics-drilldown" onClose={() => setSelection(null)}><header className="flex items-start justify-between gap-3"><div><h2 id="statistics-drilldown" className="text-lg font-semibold">{selection.title}</h2><p className="mt-1 text-xs text-muted">{selectedRecords.length} contributing payslips. Select a payslip to review or correct it.</p></div><button autoFocus aria-label="Close payslip list" onClick={() => setSelection(null)} className="rounded p-2 hover:bg-paper"><X size={18} /></button></header>
      <ul className="mt-4 divide-y divide-line">{selectedRecords.slice(selectedPage * 20, selectedPage * 20 + 20).map((record) => <li key={record.id}><Link href={`/payslips/${record.id}`} className="flex flex-wrap justify-between gap-2 py-3 text-sm hover:text-accent"><span>{shortDate(record.payDate)}<span className="block text-xs text-muted">{record.employer || record.filename}</span></span><span className="tabular text-xs">Gross {money(record.grossPay)} · Net {money(record.netPay)}</span></Link></li>)}</ul>
      {!selectedRecords.length && <p className="py-6 text-sm text-muted">No contributing observed values.</p>}
      {selectedRecords.length > 20 && <div className="mt-4 flex justify-end gap-3 text-xs"><button disabled={!selectedPage} onClick={() => setSelectedPage(selectedPage - 1)} className="disabled:opacity-40">Previous</button><span>{selectedPage + 1}/{Math.ceil(selectedRecords.length / 20)}</span><button disabled={(selectedPage + 1) * 20 >= selectedRecords.length} onClick={() => setSelectedPage(selectedPage + 1)} className="disabled:opacity-40">Next</button></div>}
    </Modal>}
  </div>;
}
