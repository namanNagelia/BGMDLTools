"use client";

import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  flag?: ReactNode; // small right-side annotation, e.g. "12 PENDING"
  accent?: "leather" | "mustard" | "default";
  children: ReactNode;
}

export function Disclosure({
  title,
  subtitle,
  defaultOpen = true,
  flag,
  accent = "default",
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const titleColor =
    accent === "leather"
      ? "text-[var(--leather)]"
      : accent === "mustard"
        ? "text-[var(--mustard)]"
        : "";

  return (
    <div className="border rule mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between gap-3 px-3 sm:px-4 py-3 bg-[color:var(--ink-2)] hover:bg-[color:var(--ink)] transition-colors text-left"
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="inline-block w-3 font-mono text-sm opacity-70 shrink-0">
            {open ? "▾" : "▸"}
          </span>
          <span
            className={`display text-xl sm:text-2xl leading-none tracking-wide ${titleColor}`}
          >
            {title}
          </span>
          {subtitle && (
            <span className="font-mono text-[10px] tracking-widest opacity-60 truncate hidden sm:inline">
              · {subtitle}
            </span>
          )}
        </div>
        {flag && (
          <span className="font-mono text-[10px] tracking-widest opacity-70 shrink-0">
            {flag}
          </span>
        )}
      </button>
      {open && <div className="p-3 sm:p-4">{children}</div>}
    </div>
  );
}
