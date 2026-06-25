"use client";

import { useMemo, useState } from "react";
import type { SheetRow } from "@/lib/api";

interface Props {
  title: string;
  rows: SheetRow[];
  pageSize?: number;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toString();
  if (typeof v === "boolean") return v ? "✓" : "—";
  return String(v);
}

export function SheetTable({ title, rows, pageSize = 25 }: Props) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");

  const columns = useMemo(
    () => (rows.length > 0 ? Object.keys(rows[0]) : []),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      columns.some((c) => String(r[c] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, columns, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <div className="border rule">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-4 py-2 bg-[color:var(--ink-2)]">
        <div className="font-mono text-[10px] tracking-widest opacity-80">
          {title.toUpperCase()} · {filtered.length}
          {query && filtered.length !== rows.length ? ` / ${rows.length}` : ""}
        </div>
        <input
          type="search"
          placeholder="FILTER…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          className="bg-transparent border rule px-2 py-1 font-mono text-[10px] tracking-widest outline-none focus:border-[var(--leather)] w-40"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b rule">
              {columns.map((c) => (
                <th
                  key={c}
                  className="text-left px-3 py-2 tracking-widest text-[10px] opacity-60 whitespace-nowrap"
                >
                  {c.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr
                key={safePage * pageSize + i}
                className="border-b rule last:border-b-0 hover:bg-[color:var(--ink-2)] transition-colors"
              >
                {columns.map((c) => {
                  const v = row[c];
                  const isNum = typeof v === "number";
                  return (
                    <td
                      key={c}
                      className={`px-3 py-1.5 whitespace-nowrap ${
                        isNum ? "tabular-nums" : ""
                      }`}
                    >
                      {formatCell(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {slice.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-3 py-6 text-center opacity-50 text-[10px] tracking-widest"
                >
                  NO MATCHES
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t rule px-4 py-2 font-mono text-[10px] tracking-widest">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← PREV
          </button>
          <div className="opacity-70">
            PAGE {safePage + 1} / {pageCount}
          </div>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            NEXT →
          </button>
        </div>
      )}
    </div>
  );
}
