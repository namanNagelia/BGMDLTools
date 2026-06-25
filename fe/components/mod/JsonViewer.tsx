"use client";

import { useMemo, useState } from "react";

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

export function JsonViewer({ value }: Props) {
  const [copied, setCopied] = useState(false);

  const { pretty, bytes, summary } = useMemo(() => {
    const text = JSON.stringify(value, null, 2);
    return {
      pretty: text,
      bytes: new Blob([text]).size,
      summary: summarize(value),
    };
  }, [value]);

  async function copy() {
    await navigator.clipboard.writeText(pretty);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  // top-level key sample for the meta strip
  const topKeys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).slice(0, 8)
      : [];

  return (
    <div className="border rule">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-4 py-2 bg-[color:var(--ink-2)]">
        <div className="font-mono text-[10px] tracking-widest opacity-70">
          PAYLOAD · {summary.type.toUpperCase()} · {summary.size} ·{" "}
          {(bytes / 1024).toFixed(1)} KB
        </div>
        <button
          onClick={copy}
          className="font-mono text-[10px] tracking-widest px-3 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] transition-colors"
        >
          {copied ? "COPIED ✓" : "COPY JSON"}
        </button>
      </div>

      {topKeys.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b rule">
          {topKeys.map((k) => (
            <span
              key={k}
              className="font-mono text-[10px] tracking-wider px-2 py-1 border rule"
            >
              {k}
            </span>
          ))}
          {topKeys.length === 8 && (
            <span className="font-mono text-[10px] tracking-wider px-2 py-1 opacity-60">
              …more
            </span>
          )}
        </div>
      )}

      <pre className="font-mono text-xs leading-relaxed p-4 overflow-auto max-h-[60vh] whitespace-pre">
        {pretty.length > 200_000 ? pretty.slice(0, 200_000) + "\n\n… [truncated for display]" : pretty}
      </pre>
    </div>
  );
}
