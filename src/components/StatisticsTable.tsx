"use client";

import { useState, type ReactNode } from "react";

export type TableCell = string | number | null;
export type TableRow = { id: string; values: TableCell[]; ids: string[] };
export type TableColumn = { label: string; format?: (value: TableCell) => ReactNode };
export function StatisticsTable({ columns, rows, onSelect, label }: {
  columns: TableColumn[]; rows: TableRow[]; label: string; onSelect: (title: string, ids: string[]) => void;
}) {
  const [sort, setSort] = useState<{ index: number; ascending: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = sort ? [...rows].sort((a, b) => {
    const left = a.values[sort.index], right = b.values[sort.index];
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sort.ascending ? comparison : -comparison;
  }) : rows;
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 24) - 1));
  return <div>
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full whitespace-nowrap text-right text-xs"><caption className="sr-only">{label}. Select any row to review contributing payslips.</caption>
        <thead className="bg-paper"><tr>{columns.map((column, index) => <th key={index} className={`px-3 py-3 font-medium text-muted ${index === 0 ? "text-left" : ""}`}
          aria-sort={sort?.index === index ? sort.ascending ? "ascending" : "descending" : "none"}>
          <button onClick={() => { setSort({ index, ascending: sort?.index === index ? !sort.ascending : true }); setPage(0); }}>{column.label}{sort?.index === index ? sort.ascending ? " \u2191" : " \u2193" : ""}</button></th>)}</tr></thead>
        <tbody>{sorted.slice(current * 24, current * 24 + 24).map((row) => <tr key={row.id} className="tabular border-t border-line hover:bg-paper">
          {row.values.map((value, index) => <td key={index} className={`px-3 py-3 ${index === 0 ? "text-left" : ""}`}>{index === 0 ? <button className="font-medium text-accent hover:underline" onClick={() => onSelect(String(value ?? label), row.ids)}>{value ?? "\u2014"}</button> : columns[index]?.format ? columns[index].format!(value) : value ?? "\u2014"}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={columns.length} className="py-8 text-center text-muted">No observed values.</td></tr>}</tbody>
      </table>
    </div>
    {rows.length > 24 && <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-line px-3 py-1 disabled:opacity-40">Previous</button><span>{current + 1} / {Math.ceil(rows.length / 24)}</span><button disabled={(current + 1) * 24 >= rows.length} onClick={() => setPage(current + 1)} className="rounded border border-line px-3 py-1 disabled:opacity-40">Next</button></div>}
  </div>;
}
