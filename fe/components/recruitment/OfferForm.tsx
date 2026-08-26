"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, publicApi, type MLEStatus, type MLETier } from "@/lib/api";

interface Props {
  faId: number;
  faName: string;
  faOverall: number;
  teamAbbrev: string;
  /** Passed the key used, so the caller can unlock the team's pending book. */
  onSubmitted?: (codeWord: string) => void;
}

/** Mirrors backend OVR_MIN_TABLE in offer.service.ts — keep in sync. */
const PAYSCALE: Array<{ ovr: string; min: number; note?: string }> = [
  { ovr: "70+", min: 33, note: "must be MAX" },
  { ovr: "68–69", min: 28 },
  { ovr: "66–67", min: 22 },
  { ovr: "63–65", min: 15 },
  { ovr: "61–62", min: 10 },
  { ovr: "59–60", min: 5 },
  { ovr: "57–58", min: 3 },
  { ovr: "≤56", min: 1, note: "min contract" },
];

function ovrBand(ovr: number): string {
  if (ovr >= 70) return "70+";
  if (ovr >= 68) return "68–69";
  if (ovr >= 66) return "66–67";
  if (ovr >= 63) return "63–65";
  if (ovr >= 61) return "61–62";
  if (ovr >= 59) return "59–60";
  if (ovr >= 57) return "57–58";
  return "≤56";
}

export function OfferForm({
  faId,
  faName,
  faOverall,
  teamAbbrev,
  onSubmitted,
}: Props) {
  const [amount, setAmount] = useState("");
  const [years, setYears] = useState("");
  const [gm, setGm] = useState("");
  const [codeWord, setCodeWord] = useState("");
  const [useMLE, setUseMLE] = useState(false);
  const [mleTier, setMleTier] = useState<MLETier>(1);
  const [tierTouched, setTierTouched] = useState(false);
  const [useDoubleDip, setUseDoubleDip] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOk, setSubmittedOk] = useState(false);

  // live preview from server
  const [previewing, setPreviewing] = useState(false);
  const [hardViolations, setHardViolations] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mle, setMle] = useState<MLEStatus | null>(null);

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
      setMle(null);
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
          isMLE: useMLE,
          mleTier: useMLE ? mleTier : null,
          codeWord: codeWord.trim() || undefined,
        });
        setHardViolations(r.hardViolations);
        setWarnings(r.warnings);
        setMle(r.mle);
      } catch {
        setHardViolations([]);
        setWarnings([]);
        setMle(null);
      } finally {
        setPreviewing(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [faId, teamAbbrev, amount, years, useMLE, mleTier, codeWord]);

  // Default the tier to whatever the team's cap qualifies for — but only until
  // the GM picks one themselves. Both tiers stay selectable either way; a
  // trade can move the team into a different band before signings.
  useEffect(() => {
    if (!tierTouched && mle?.eligibleTier) setMleTier(mle.eligibleTier);
  }, [tierTouched, mle?.eligibleTier]);

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
      setSubmitError("PRIVATE KEY REQUIRED");
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
        isMLE: useMLE,
        mleTier: useMLE ? mleTier : null,
        isDoubleDip: useDoubleDip,
      });
      if (typeof window !== "undefined") {
        if (gm.trim()) window.localStorage.setItem("gmName", gm.trim());
        if (codeWord.trim())
          window.localStorage.setItem("gmCodeWord", codeWord.trim());
      }
      setAmount("");
      setYears("");
      setUseMLE(false);
      setTierTouched(false);
      setUseDoubleDip(false);
      setHardViolations([]);
      setWarnings([]);
      setSubmittedOk(true);
      onSubmitted?.(codeTrim);
      setTimeout(() => setSubmittedOk(false), 4000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
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
  const bandForFA = ovrBand(faOverall);

  return (
    <div className="border-t rule pt-3 mt-3">
      <div className="eyebrow opacity-70 mb-2">SEND OFFER · {faName}</div>

      {!teamAbbrev ? (
        <div className="font-mono text-[10px] tracking-widest opacity-60">
          PICK YOUR TEAM IN THE HEADER DROPDOWN TO SUBMIT OFFERS
        </div>
      ) : (
        <>
          {/* PAYSCALE ---------------------------------------------------- */}
          <div className="border rule p-3 mb-3">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <div className="eyebrow opacity-60">FA PAYSCALE</div>
              <div className="font-mono text-[10px] tracking-widest opacity-70">
                OVR {faOverall} → band <span className="text-[var(--leather)]">{bandForFA}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 font-mono text-[10px] tabular-nums">
              {PAYSCALE.map((row) => {
                const isMine = row.ovr === bandForFA;
                return (
                  <div
                    key={row.ovr}
                    className={`px-1.5 py-1 border text-center ${
                      isMine
                        ? "border-[var(--leather)] bg-[color:rgba(166,90,38,0.14)]"
                        : "rule opacity-70"
                    }`}
                    title={row.note ?? ""}
                  >
                    <div className={`tracking-widest ${isMine ? "text-[var(--leather)]" : ""}`}>
                      {row.ovr}
                    </div>
                    <div className={`mt-0.5 ${isMine ? "font-bold" : ""}`}>
                      ≥ ${row.min}M
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="font-mono text-[9px] tracking-widest opacity-50 mt-1.5">
              MIN $/YR IS ENFORCED · MAX CONTRACT $33M/YR · YEARS 1–5
            </div>
          </div>

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
                GM NAME (public)
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
                YOUR PRIVATE KEY *
              </div>
              <input
                type="text"
                required
                value={codeWord}
                onChange={(e) => setCodeWord(e.target.value)}
                placeholder="pick anything only you know"
                title="Personal password. Not visible to other GMs and not used by the mod to identify you (that's the GM Name). This is the key you type into MY OFFERS to edit or withdraw. Use the same one across all your offers."
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
              ) : useMLE ? (
                "SUBMIT MLE OFFER"
              ) : (
                "SUBMIT OFFER"
              )}
            </button>

            {/* MLE toggle row --------------------------------------- */}
            <div className="col-span-12">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`inline-flex items-center gap-2 border rule px-2 py-1.5 cursor-pointer select-none ${
                    useMLE ? "border-[var(--mustard)] text-[var(--mustard)]" : ""
                  }`}
                  title="Use the Mid-Level Exception to sign over the soft cap. Either tier can be offered — if your cap doesn't qualify yet, you'll get a warning, not a block."
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--mustard)]"
                    checked={useMLE}
                    onChange={(e) => setUseMLE(e.target.checked)}
                  />
                  <span className="font-mono text-[10px] tracking-widest">
                    USE MID-LEVEL EXCEPTION (MLE)
                  </span>
                </label>

                {useMLE &&
                  (mle?.tiers ?? []).map((t) => {
                    const active = mleTier === t.tier;
                    return (
                      <button
                        key={t.tier}
                        type="button"
                        onClick={() => {
                          setTierTouched(true);
                          setMleTier(t.tier);
                        }}
                        title={
                          t.eligible
                            ? "Your cap position qualifies for this tier"
                            : "Your cap position doesn't qualify for this tier right now — allowed, but flagged"
                        }
                        className={`font-mono text-[10px] tracking-widest px-2 py-1.5 border transition-colors ${
                          active
                            ? "border-[var(--mustard)] text-[var(--mustard)] bg-[color:rgba(217,166,55,0.12)]"
                            : "rule opacity-70 hover:opacity-100"
                        }`}
                      >
                        T{t.tier} · ${t.maxAmount.toFixed(1)}M / {t.maxYears}YR
                        {t.eligible ? " ✓" : ""}
                      </button>
                    );
                  })}
              </div>

              {mle && (
                <div className="font-mono text-[10px] tracking-widest opacity-70 mt-1">
                  {mle.used ? (
                    <span className="text-[var(--leather)]">
                      MLE ALREADY USED
                      {mle.usedOn?.playerName ? ` ON ${mle.usedOn.playerName.toUpperCase()}` : ""}
                      {mle.usedOn?.status === "ACCEPTED" ? " (SIGNED)" : ""}
                      {" · "}
                      <span className="opacity-70">ONE MLE PER TEAM</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-[var(--mustard)]">MLE AVAILABLE</span>
                      {" · ONE PER TEAM · "}
                      {mle.eligibleTier
                        ? `YOUR CAP FITS T${mle.eligibleTier}`
                        : "YOUR CAP IS UNDER $92.5M — EITHER TIER STILL SUBMITS, JUST FLAGGED"}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* DOUBLE-DIP toggle row ---------------------------------- */}
            <div className="col-span-12">
              <label
                className={`inline-flex items-center gap-2 border rule px-2 py-1.5 cursor-pointer select-none ${
                  useDoubleDip ? "border-[var(--leather)] text-[var(--leather)]" : ""
                }`}
                title="Mark this offer as riding on money already tied up in your offers to restricted free agents. Void if one of those RFAs signs with you."
              >
                <input
                  type="checkbox"
                  className="accent-[var(--leather)]"
                  checked={useDoubleDip}
                  onChange={(e) => setUseDoubleDip(e.target.checked)}
                />
                <span className="font-mono text-[10px] tracking-widest">
                  DOUBLE DIP (RFA EXCEPTION)
                </span>
              </label>
              {useDoubleDip && (
                <div className="font-mono text-[10px] tracking-widest text-[var(--mustard)] mt-1">
                  ⚠ VOID IF ANY OF YOUR RFA OFFERS SIGNS
                </div>
              )}
            </div>

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
