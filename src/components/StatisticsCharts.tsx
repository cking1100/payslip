"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import type { Unit } from "@/lib/statistics";

export const chartColors = ["#3d6952", "#577b97", "#a47842", "#85796d", "#6b8191", "#95a887"];
export function statFormat(value: number | null | undefined, unit: Unit = "money"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "\u2014";
  return unit === "money" ? money(value) : `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}${unit === "percent" ? "%" : ""}`;
}
export type ChartPoint = { label: string; value: number | null; ids: string[] };
export type ChartSeries = { label: string; points: ChartPoint[] };

export function LineChart({ series, unit = "money", onSelect }: { series: ChartSeries[]; unit?: Unit; onSelect: (title: string, ids: string[]) => void }) {
  const [hover, setHover] = useState("");
  const observed = series.flatMap((line) => line.points.map((point) => point.value).filter((value): value is number => value !== null));
  if (!observed.length) return <p className="py-8 text-center text-sm text-muted">No observed values for this chart.</p>;
  const min = Math.min(0, ...observed), max = Math.max(0, ...observed);
  const span = max - min || 1;
  const length = Math.max(...series.map((line) => line.points.length));
  const x = (index: number) => 68 + index / Math.max(1, length - 1) * 592;
  const y = (value: number) => 180 - (value - min) / span * 156;
  return <div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{series.map((line, index) => <span key={line.label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: chartColors[index % chartColors.length] }} />{line.label}</span>)}</div>
    <svg viewBox="0 0 690 218" role="group" aria-label={series.map((line) => line.label).join(", ")} className="mt-3 w-full">
      {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1="68" x2="660" y1={y(min + fraction * span)} y2={y(min + fraction * span)} stroke="#e4e8e2" /><text x="62" y={y(min + fraction * span) + 3} textAnchor="end" fontSize="10" fill="#67736b">{statFormat(min + fraction * span, unit)}</text></g>)}
      {series.map((line, index) => {
        let connected = false;
        const path = line.points.map((point, position) => {
          if (point.value === null) { connected = false; return ""; }
          const command = `${connected ? "L" : "M"} ${x(position)} ${y(point.value)}`;
          connected = true;
          return command;
        }).join(" ");
        return <g key={line.label}><path d={path} fill="none" stroke={chartColors[index % chartColors.length]} strokeWidth="2" />
          {line.points.map((point, position) => point.value !== null && <circle key={position} cx={x(position)} cy={y(point.value)} r={length > 40 ? 3 : 4} fill={chartColors[index % chartColors.length]} role="button" tabIndex={0}
            aria-label={`${point.label}, ${line.label}, ${statFormat(point.value, unit)}. Show contributing payslips.`}
            className="cursor-pointer outline-accent" onMouseEnter={() => setHover(`${point.label} \u00b7 ${line.label}: ${statFormat(point.value, unit)}`)}
            onFocus={() => setHover(`${point.label} \u00b7 ${line.label}: ${statFormat(point.value, unit)}`)}
            onClick={() => onSelect(`${point.label} \u00b7 ${line.label}`, point.ids)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(`${point.label} \u00b7 ${line.label}`, point.ids); } }}>
            <title>{point.label}: {statFormat(point.value, unit)}</title></circle>)}</g>;
      })}
      {series[0]?.points.map((point, index) => (index === 0 || index === length - 1 || index % Math.max(1, Math.ceil(length / 6)) === 0) && <text key={index} x={x(index)} y="207" textAnchor="middle" fontSize="10" fill="#67736b">{point.label}</text>)}
    </svg>
    <p aria-live="polite" className="min-h-5 text-xs text-muted">{hover || "Hover or focus a point for its value; select it to review payslips. Gaps mean unknown values."}</p>
  </div>;
}

export function Donut({ entries, onSelect }: { entries: Array<{ label: string; value: number; ids: string[] }>; onSelect: (title: string, ids: string[]) => void }) {
  const positive = entries.filter((entry) => entry.value > 0);
  const total = positive.reduce((sum, entry) => sum + entry.value, 0);
  let offset = 0;
  if (!positive.length) return <p className="py-8 text-sm text-muted">Not enough observed positive components to draw a composition.</p>;
  const circumference = 2 * Math.PI * 44;
  return <div className="mt-4">
    {positive.length <= 7 && <svg viewBox="0 0 120 120" aria-label="Observed composition" className="mx-auto h-36 w-36">
      {positive.map((entry, index) => {
        const start = offset; offset += entry.value / total;
        return <circle key={entry.label} cx="60" cy="60" r="44" fill="none" stroke={chartColors[index % chartColors.length]} strokeWidth="16"
          role="button" tabIndex={0} aria-label={`${entry.label}: ${money(entry.value)}. Show contributing payslips.`} className="cursor-pointer"
          onClick={() => onSelect(entry.label, entry.ids)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(entry.label, entry.ids); } }}
          strokeDasharray={`${entry.value / total * circumference} ${circumference}`} strokeDashoffset={-start * circumference} transform="rotate(-90 60 60)">
          <title>{entry.label}: {money(entry.value)} ({(entry.value / total * 100).toFixed(1)}%)</title></circle>;
      })}
      <text x="60" y="57" textAnchor="middle" fontSize="8" fill="#67736b">OBSERVED SUM</text><text x="60" y="70" textAnchor="middle" fontSize="10" fill="#25372d">{money(total)}</text>
    </svg>}
    <div className="mt-3 space-y-2">{[...entries].sort((a, b) => b.value - a.value).map((entry) => <button key={entry.label} onClick={() => onSelect(entry.label, entry.ids)} className="block w-full text-left text-xs">
      <span className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: positive.some((item) => item.label === entry.label) ? chartColors[positive.findIndex((item) => item.label === entry.label) % chartColors.length] : "#a1a9a4" }} />{entry.label}</span><span className="tabular">{money(entry.value)}{entry.value >= 0 ? ` \u00b7 ${(entry.value / total * 100).toFixed(1)}%` : " (refund)"}</span></span>
      <span className="mt-1 block h-1 rounded bg-paper"><span className="block h-1 rounded bg-accent/70" style={{ width: `${Math.max(0, entry.value) / total * 100}%` }} /></span>
    </button>)}</div>
    {entries.some((entry) => entry.value < 0) && <p className="mt-2 text-xs text-muted">Refunds / negative entries are listed but excluded from the positive composition.</p>}
  </div>;
}

export function Scatter({ points, xLabel, yLabel, xUnit, yUnit, onSelect }: {
  points: Array<{ x: number; y: number; id: string }>; xLabel: string; yLabel: string; xUnit: Unit; yUnit: Unit;
  onSelect: (title: string, ids: string[]) => void;
}) {
  const [hover, setHover] = useState("");
  if (!points.length) return <p className="py-8 text-sm text-muted">No paired observations.</p>;
  const minX = Math.min(...points.map((point) => point.x)), maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y)), maxY = Math.max(...points.map((point) => point.y));
  return <div><svg viewBox="0 0 450 230" role="group" aria-label={`${xLabel} versus ${yLabel}`} className="w-full">
    <path d="M60 20 V185 H420" fill="none" stroke="#cdd5ce" />
    <text x="60" y="200" fontSize="10" fill="#67736b">{statFormat(minX, xUnit)}</text><text x="420" y="200" textAnchor="end" fontSize="10" fill="#67736b">{statFormat(maxX, xUnit)}</text>
    <text x="54" y="25" textAnchor="end" fontSize="10" fill="#67736b">{statFormat(maxY, yUnit)}</text><text x="54" y="185" textAnchor="end" fontSize="10" fill="#67736b">{statFormat(minY, yUnit)}</text>
    {points.map((point) => <circle key={point.id} cx={60 + (point.x - minX) / (maxX - minX || 1) * 360} cy={185 - (point.y - minY) / (maxY - minY || 1) * 160} r="3.5" fill="#3d6952" fillOpacity="0.65"
      role="button" tabIndex={0} aria-label={`${xLabel}: ${statFormat(point.x, xUnit)}; ${yLabel}: ${statFormat(point.y, yUnit)}. Show payslip.`}
      className="cursor-pointer" onMouseEnter={() => setHover(`${xLabel}: ${statFormat(point.x, xUnit)} \u00b7 ${yLabel}: ${statFormat(point.y, yUnit)}`)}
      onFocus={() => setHover(`${xLabel}: ${statFormat(point.x, xUnit)} \u00b7 ${yLabel}: ${statFormat(point.y, yUnit)}`)}
      onClick={() => onSelect(`${xLabel} / ${yLabel}`, [point.id])}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(`${xLabel} / ${yLabel}`, [point.id]); } }}>
      <title>{xLabel}: {statFormat(point.x, xUnit)}; {yLabel}: {statFormat(point.y, yUnit)}</title></circle>)}
    <text x="240" y="222" fontSize="11" textAnchor="middle" fill="#67736b">{xLabel}</text>
  </svg><p className="min-h-5 text-xs text-muted">{hover || `${yLabel} on the vertical axis. Select a point to review its source.`}</p></div>;
}
