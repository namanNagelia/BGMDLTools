"use client";

import { useMemo, useState, type ReactNode } from "react";

interface Props {
  value: unknown;
}

function summarize(value: unknown): { type: string; size: string } {
  if (value === null) return { type: "null", size: "—" };
  if (Array.isArray(value)) return { type: "array", size: `${value.length} items` };
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return { type: "object", size: `${keys.length} keys` };
  }
  return { type: typeof value, size: "—" };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function entriesOf(v: unknown): Array<[string, unknown]> {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x] as [string, unknown]);
  if (isPlainObject(v)) return Object.entries(v);
  return [];
}

const LARGE_ARRAY_CHUNK = 100;

/** Render a primitive value inline with color coding by type. */
function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="opacity-50">null</span>;
  if (typeof value === "string")
    return <span className="text-[var(--mustard)]">&quot;{value}&quot;</span>;
  if (typeof value === "number")
    return <span className="text-[var(--leather)]">{value}</span>;
  if (typeof value === "boolean")
    return <span className="text-[var(--leather)]">{String(value)}</span>;
  return <span className="opacity-70">{String(value)}</span>;
}

/** A single tree node — either a leaf or a collapsible object/array. */
function Node({
  label,
  value,
  depth,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  depth: number;
  defaultOpen?: boolean;
}): ReactNode {
  const isContainer = Array.isArray(value) || isPlainObject(value);
  const [open, setOpen] = useState(defaultOpen);
  const [visibleCount, setVisibleCount] = useState(LARGE_ARRAY_CHUNK);

  const indent = { paddingLeft: `${depth * 14}px` };

  if (!isContainer) {
    return (
      <div style={indent} className="font-mono text-xs leading-relaxed">
        <span className="opacity-60">{label}:</span> <Leaf value={value} />
      </div>
    );
  }

  const isArr = Array.isArray(value);
  const all = entriesOf(value);
  const summary = isArr ? `[${all.length}]` : `{${all.length}}`;
  const shown = open ? all.slice(0, visibleCount) : [];
  const hasMore = open && all.length > visibleCount;

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={indent}
        className="font-mono text-xs leading-relaxed flex items-baseline gap-1.5 hover:text-[var(--leather)] transition-colors text-left w-full group"
      >
        <span className="inline-block w-3 opacity-60 group-hover:opacity-100">
          {open ? "▾" : "▸"}
        </span>
        <span className="opacity-90">{label}</span>
        <span className="opacity-40 text-[10px]">{summary}</span>
      </button>

      {open &&
        shown.map(([k, v]) => (
          <Node
            key={k}
            label={k}
            value={v}
            depth={depth + 1}
            defaultOpen={false}
          />
        ))}

      {hasMore && (
        <button
          style={{ paddingLeft: `${(depth + 1) * 14}px` }}
          onClick={() => setVisibleCount((n) => n + LARGE_ARRAY_CHUNK)}
          className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100 hover:text-[var(--leather)] mt-1"
        >
          + SHOW {Math.min(LARGE_ARRAY_CHUNK, all.length - visibleCount)} MORE
          <span className="opacity-50"> ({all.length - visibleCount} HIDDEN)</span>
        </button>
      )}
    </div>
  );
}

export function JsonViewer({ value }: Props) {
  const [copied, setCopied] = useState(false);

  const meta = useMemo(() => {
    // approximate byte size without serializing the entire payload twice
    const sample = JSON.stringify(value);
    return {
      bytes: new Blob([sample]).size,
      summary: summarize(value),
    };
  }, [value]);

  async function copy() {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const topEntries = entriesOf(value);

  return (
    <div className="border rule">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-4 py-2 bg-[color:var(--ink-2)]">
        <div className="font-mono text-[10px] tracking-widest opacity-70">
          PAYLOAD · {meta.summary.type.toUpperCase()} · {meta.summary.size} ·{" "}
          {meta.bytes > 1024 * 1024
            ? `${(meta.bytes / (1024 * 1024)).toFixed(1)} MB`
            : `${(meta.bytes / 1024).toFixed(1)} KB`}
        </div>
        <button
          onClick={copy}
          className="font-mono text-[10px] tracking-widest px-3 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] transition-colors"
        >
          {copied ? "COPIED ✓" : "COPY JSON"}
        </button>
      </div>

      <div className="p-3 overflow-auto max-h-[70vh]">
        {topEntries.length === 0 ? (
          <div className="font-mono text-xs opacity-60 p-2">
            <Leaf value={value} />
          </div>
        ) : (
          topEntries.map(([k, v]) => (
            <Node key={k} label={k} value={v} depth={0} defaultOpen={false} />
          ))
        )}
      </div>
    </div>
  );
}
