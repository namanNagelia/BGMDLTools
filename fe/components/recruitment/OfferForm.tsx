"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, publicApi } from "@/lib/api";

interface Props {
  faId: number;
  faName: string;
  teamAbbrev: string;
  onSubmitted?: () => void;
}

export function OfferForm({ faId, faName, teamAbbrev, onSubmitted }: Props) {
  const [amount, setAmount] = useState("");
  const [years, setYears] = useState("");
  const [gm, setGm] = useState("");
  const [codeWord, setCodeWord] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOk, setSubmittedOk] = useState(false);

  // live preview from server
  const [previewing, setPreviewing] = useState(false);
  const [hardViolations, setHardViolations] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  // remember GM name + code word across the session
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedName = window.localStorage.getItem("gmName");
      if (storedName) setGm(storedName);
      const storedCode = window.localStorage.getItem("gmCodeWord");
      if (storedCode) setCodeWord(storedCode);
    }
  }, []);

  // debounced live preview
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const amt = Number(amount);
    const yrs = Number(years);
    if (!teamAbbrev || !(amt > 0) || !(yrs > 0)) {
      setHardViolations([]);
      setWarnings([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const r = await publicApi.previewOffer(faId, {
          teamAbbrev,
          amount: amt,
          years: yrs,
        });
        setHardViolations(r.hardViolations);
        setWarnings(r.warnings);
      } catch {
        setHardViolations([]);
        setWarnings([]);
      } finally {
        setPreviewing(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [faId, teamAbbrev, amount, years]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!teamAbbrev) {
      setSubmitError("PICK YOUR TEAM FIRST");
      return;
    }
    const amt = Number(amount);
    const yrs = Number(years);
    if (!(amt > 0) || !(yrs > 0)) {
      setSubmitError("AMOUNT AND YEARS REQUIRED");
      return;
    }
    const codeTrim = codeWord.trim();
    if (!codeTrim) {
      setSubmitError("CODE WORD REQUIRED");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicApi.submitOffer(faId, {
        teamAbbrev,
        gm: gm.trim() || "anon",
        codeWord: codeTrim,
        amount: amt,
        years: yrs,
      });
      if (typeof window !== "undefined") {
        if (gm.trim()) window.localStorage.setItem("gmName", gm.trim());
        if (codeWord.trim())
          window.localStorage.setItem("gmCodeWord", codeWord.trim());
      }
      setAmount("");
      setYears("");
      setHardViolations([]);
      setWarnings([]);
      setSubmittedOk(true);
      onSubmitted?.();
      setTimeout(() => setSubmittedOk(false), 4000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        // server-side hard violation message
        setSubmitError(err.message.toUpperCase());
      } else {
        setSubmitError(err instanceof ApiError ? err.message.toUpperCase() : "FAILED");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const hasHard = hardViolations.length > 0;
  const hasWarn = warnings.length > 0;

  return (
    <div className="border-t rule pt-3 mt-3">
      <div className="eyebrow opacity-70 mb-2">SEND OFFER · {faName}</div>

      {!teamAbbrev ? (
        <div className="font-mono text-[10px] tracking-widest opacity-60">
          PICK YOUR TEAM IN THE HEADER DROPDOWN TO SUBMIT OFFERS
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-2 items-end">
            <label className="col-span-6 sm:col-span-2">
              <div className="font-mono text-[9px] tracking-widest opacity-60 mb-0.5">
                $M / YR
              </div>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.5"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="8.00"
                className="w-full bg-transparent border rule px-2 py-1 outline-none font-mono text-sm tabular-nums focus:border-[var(--leather)] transition-colors"
              />
            </label>
            <label className="col-span-6 sm:col-span-1">
              <div className="font-mono text-[9px] tracking-widest opacity-60 mb-0.5">
                YRS
              </div>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="5"
                required
                value={years}
                onChange={(e) => setYears(e.target.value)}
                placeholder="4"
                className="w-full bg-transparent border rule px-2 py-1 outline-none font-mono text-sm tabular-nums focus:border-[var(--leather)] transition-colors"
              />
            </label>
            <label className="col-span-6 sm:col-span-3">
              <div className="font-mono text-[9px] tracking-widest opacity-60 mb-0.5">
                GM NAME
              </div>
              <input
                type="text"
                value={gm}
                onChange={(e) => setGm(e.target.value)}
                placeholder="(remembered)"
                className="w-full bg-transparent border rule px-2 py-1 outline-none font-mono text-sm focus:border-[var(--leather)] transition-colors"
              />
            </label>
            <label className="col-span-6 sm:col-span-3">
              <div className="font-mono text-[9px] tracking-widest opacity-60 mb-0.5">
                CODE WORD *
              </div>
              <input
                type="text"
                required
                value={codeWord}
                onChange={(e) => setCodeWord(e.target.value)}
                placeholder="your private key"
                title="Required. Same code lets you edit/withdraw your offers later."
                className="w-full bg-transparent border rule px-2 py-1 outline-none font-mono text-sm focus:border-[var(--leather)] transition-colors"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || !amount || !years || !codeWord.trim() || hasHard}
              className="col-span-12 sm:col-span-3 bg-[var(--leather)] text-[var(--paper)] font-mono text-xs tracking-wider px-4 py-1.5 hover:bg-[var(--leather-2)] disabled:bg-[color:var(--ink-2)] disabled:text-[color:rgba(243,237,225,0.3)] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="spinner" />
                  <span>SUBMITTING</span>
                </>
              ) : hasHard ? (
                "FIX VIOLATIONS"
              ) : (
                "SUBMIT OFFER"
              )}
            </button>
            {submitError && (
              <div className="col-span-12 font-mono text-[10px] text-[var(--leather)]">
                {submitError}
              </div>
            )}
          </form>

          {/* LIVE PREVIEW ----------------------------------------------- */}
          {(hasHard || hasWarn || previewing) && (
            <div className="mt-3 border rule p-3 space-y-2 text-[11px] font-mono">
              {previewing && (
                <div className="opacity-50 tracking-widest text-[10px]">
                  CHECKING<span className="caret ml-1" />
                </div>
              )}
              {hasHard && (
                <div>
                  <div className="text-[var(--leather)] tracking-widest">
                    ⛔ CANNOT SUBMIT — RULE VIOLATIONS
                  </div>
                  <ul className="text-[var(--leather)] mt-1 space-y-0.5">
                    {hardViolations.map((v, i) => (
                      <li key={i}>· {v}</li>
                    ))}
                  </ul>
                </div>
              )}
              {hasWarn && (
                <div>
                  <div className="text-[var(--mustard)] tracking-widest">
                    ⚠ WARNING — OFFER WILL SUBMIT, BUT…
                  </div>
                  <ul className="text-[var(--mustard)] mt-1 space-y-0.5">
                    {warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {submittedOk && (
            <div className="mt-3 border border-[var(--leather)] p-2 font-mono text-[11px] tracking-widest text-[var(--leather)]">
              ✓ OFFER SUBMITTED · MOD WILL SEE IT FROM HERE
            </div>
          )}
        </>
      )}
    </div>
  );
}
