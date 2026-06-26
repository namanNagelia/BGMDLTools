"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Step {
  num: number;
  title: string;
  body: ReactNode;
}

interface Props {
  /** Unique id for localStorage so each page remembers its own state. */
  storageKey: string;
  title: string;
  steps: Step[];
}

export function HowToPanel({ storageKey, title, steps }: Props) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(storageKey);
    if (v === "closed") setOpen(false);
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, next ? "open" : "closed");
    }
  }

  return (
    <div className="border rule mb-4">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-baseline justify-between gap-3 px-3 sm:px-4 py-3 bg-[color:var(--ink-2)] hover:bg-[color:var(--ink)] transition-colors text-left"
      >
        <div className="flex items-baseline gap-3">
          <span className="inline-block w-3 font-mono text-sm opacity-70">
            {open ? "▾" : "▸"}
          </span>
          <span className="display text-xl sm:text-2xl leading-none tracking-wide">
            {title}
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-widest opacity-60">
          {steps.length} STEPS
        </span>
      </button>
      {open && (
        <ol className="p-4 sm:p-5 space-y-3">
          {steps.map((s) => (
            <li key={s.num} className="flex gap-3">
              <span className="display text-2xl leading-none text-[var(--leather)] tabular-nums shrink-0 w-8">
                {String(s.num).padStart(2, "0")}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[11px] tracking-widest uppercase opacity-80">
                  {s.title}
                </div>
                <div className="text-sm opacity-80 mt-0.5 leading-relaxed">
                  {s.body}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
