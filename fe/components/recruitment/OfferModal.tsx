"use client";

import { useEffect } from "react";
import type { FreeAgent } from "@/lib/api";
import { OfferForm } from "./OfferForm";

interface Props {
  fa: FreeAgent;
  teamAbbrev: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function OfferModal({ fa, teamAbbrev, onClose, onSubmitted }: Props) {
  // ESC closes
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(0,0,0,0.75)] backdrop-blur-sm overscroll-contain"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-[var(--ink)] border rule sm:rounded-none"
      >
        {/* sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b rule bg-[color:var(--ink-2)]">
          <div className="min-w-0">
            <div className="eyebrow opacity-60">SEND AN OFFER</div>
            <div className="display text-2xl sm:text-3xl leading-none mt-1 truncate">
              {fa.name}
            </div>
            <div className="font-mono text-[10px] tracking-widest opacity-70 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{fa.previousTeam}</span>
              <span>{fa.position}</span>
              <span>OVR {fa.overall}</span>
              <span>AGE {fa.age}</span>
              <span
                className={
                  fa.faStatus === "RFA"
                    ? "text-[var(--mustard)]"
                    : "text-[var(--leather)]"
                }
              >
                {fa.faStatus}
              </span>
              <span className="opacity-70">CAP HOLD ${Number(fa.capHold).toFixed(2)}M</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-lg opacity-70 hover:opacity-100 hover:text-[var(--leather)] transition-opacity px-2 -m-2"
          >
            ✕
          </button>
        </div>

        {fa.source === "BBGM_ONLY" ? (
          <div className="mx-4 my-3 border border-[var(--mustard)] p-3 font-mono text-[11px] text-[var(--mustard)] tracking-widest">
            ⚠ NOT IN VALUES SHEET · MOD PICKS THE SIGNING MANUALLY.
            <div className="opacity-80 mt-1 tracking-normal">
              You can still submit an offer — the mod will use their judgment instead of the value calc.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 px-4 py-3 border-b rule">
            {[
              ["MKT", fa.marketValue],
              ["LGC", fa.legacyValue],
              ["PT", fa.playingTimeValue],
              ["WIN", fa.winningValue],
              ["LOY", fa.loyaltyValue],
              ["MNY", fa.moneyValue],
              ["LEN", fa.lengthValue],
            ].map(([k, v]) => (
              <div key={k} className="border rule px-2 py-1 text-center">
                <div className="text-[9px] tracking-widest opacity-60">{k}</div>
                <div className="font-mono text-sm tabular-nums">{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* form + existing offers */}
        <div className="p-4">
          <OfferForm
            faId={fa.id}
            faName={fa.name}
            teamAbbrev={teamAbbrev}
            onSubmitted={onSubmitted}
          />
        </div>
      </div>
    </div>
  );
}
