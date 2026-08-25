"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, publicApi, type OfferWithFlags } from "@/lib/api";

export function MyOffersPanel() {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [offers, setOffers] = useState<OfferWithFlags[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editYears, setEditYears] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("gmCodeWord");
      if (stored) setCode(stored);
    }
  }, []);

  async function fetchMine(forCode: string = code) {
    if (!forCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await publicApi.lookupMyOffers(forCode.trim());
      setOffers(list);
      setSubmitted(true);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("gmCodeWord", forCode.trim());
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "LOOKUP FAILED");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(o: OfferWithFlags) {
    setEditingId(o.id);
    setEditAmount(o.offerAmount);
    setEditYears(String(o.offerLength));
  }

  async function saveEdit(o: OfferWithFlags) {
    setBusyId(o.id);
    setError(null);
    try {
      await publicApi.editMyOffer(o.id, code.trim(), {
        amount: Number(editAmount),
        years: Number(editYears),
      });
      setEditingId(null);
      await fetchMine();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message.toUpperCase());
      } else {
        setError(err instanceof ApiError ? err.message.toUpperCase() : "EDIT FAILED");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function withdraw(o: OfferWithFlags) {
    if (!window.confirm(`Withdraw your offer on ${o.playerName ?? `#${o.freeAgentId}`}?`)) return;
    setBusyId(o.id);
    try {
      await publicApi.withdrawMyOffer(o.id, code.trim());
      await fetchMine();
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "WITHDRAW FAILED");
    } finally {
      setBusyId(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void fetchMine();
  }

  return (
    <div className="border rule mb-4">
      <div className="px-3 sm:px-4 py-3 bg-[color:var(--ink-2)] border-b rule">
        <div className="eyebrow opacity-60">MY OFFERS</div>
        <div className="font-mono text-[11px] opacity-70 mt-1">
          Enter the private key you used when submitting to see, edit, or withdraw
          your pending offers. Case-insensitive.
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-3 sm:p-4 flex flex-wrap items-end gap-2"
      >
        <label className="flex-1 min-w-[160px]">
          <div className="font-mono text-[9px] tracking-widest opacity-60 mb-0.5">
            YOUR PRIVATE KEY
          </div>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="the same key you used when submitting"
            className="w-full bg-transparent border rule px-2 py-1 outline-none font-mono text-sm focus:border-[var(--leather)] transition-colors"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="bg-[var(--leather)] text-[var(--paper)] font-mono text-xs tracking-wider px-4 py-1.5 hover:bg-[var(--leather-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {loading ? <><span className="spinner" /><span>LOOKING UP</span></> : "SHOW MY OFFERS"}
        </button>
        {submitted && (
          <span className="font-mono text-[10px] tracking-widest opacity-60">
            {offers.length} PENDING
          </span>
        )}
      </form>

      {error && (
        <div className="mx-3 sm:mx-4 mb-3 border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
          {error}
        </div>
      )}

      {submitted && offers.length === 0 && !error && (
        <div className="mx-3 sm:mx-4 mb-4 font-mono text-[10px] tracking-widest opacity-60">
          NO PENDING OFFERS UNDER THAT PRIVATE KEY. CASE-INSENSITIVE MATCH — DOUBLE-CHECK YOUR SPELLING.
        </div>
      )}

      {offers.length > 0 && (
        <div className="border-t rule overflow-x-auto">
          <table className="w-full font-mono text-xs min-w-[640px]">
            <thead>
              <tr className="border-b rule">
                <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">PLAYER</th>
                <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">TEAM</th>
                <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60">$M/YR</th>
                <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60">YRS</th>
                <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">FLAGS</th>
                <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-32">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const flagged = o.invalidReasons.length > 0;
                const editing = editingId === o.id;
                return (
                  <tr
                    key={o.id}
                    className={`border-b rule last:border-b-0 ${
                      flagged ? "bg-[color:rgba(217,166,55,0.10)]" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5">{o.playerName ?? `#${o.freeAgentId}`}</td>
                    <td className="px-3 py-1.5 font-bold">
                      {o.teamAbbrev}
                      {o.isMle && (
                        <span className="ml-1.5 font-mono text-[9px] tracking-widest text-[var(--mustard)] border border-[var(--mustard)] px-1 py-[1px]">
                          MLE
                        </span>
                      )}
                      {o.isDoubleDip && (
                        <span
                          className="ml-1.5 font-mono text-[9px] tracking-widest text-[var(--leather)] border border-[var(--leather)] px-1 py-[1px]"
                          title="Riding on your pending RFA offers — void if one of them signs"
                        >
                          2×DIP
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-20 bg-transparent border rule px-1 py-0.5 outline-none font-mono text-xs tabular-nums text-right focus:border-[var(--leather)]"
                        />
                      ) : (
                        `$${Number(o.offerAmount).toFixed(2)}M`
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          min="1"
                          max="5"
                          value={editYears}
                          onChange={(e) => setEditYears(e.target.value)}
                          className="w-12 bg-transparent border rule px-1 py-0.5 outline-none font-mono text-xs tabular-nums text-right focus:border-[var(--leather)]"
                        />
                      ) : (
                        o.offerLength
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {flagged ? (
                        <span className="text-[10px] text-[var(--mustard)]" title={o.invalidReasons.join(" · ")}>
                          ⚠ WARNING
                        </span>
                      ) : (
                        <span className="text-[10px] opacity-50">OK</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {editing ? (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() => saveEdit(o)}
                            disabled={busyId === o.id}
                            className="font-mono text-[10px] tracking-widest px-2 py-0.5 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] disabled:opacity-40 transition-colors"
                          >
                            {busyId === o.id ? "…" : "SAVE"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="font-mono text-[10px] tracking-widest px-2 py-0.5 border rule opacity-70 hover:opacity-100"
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() => startEdit(o)}
                            disabled={busyId === o.id}
                            className="font-mono text-[10px] tracking-widest px-2 py-0.5 border rule hover:border-[var(--leather)] hover:text-[var(--leather)] disabled:opacity-40 transition-colors"
                          >
                            EDIT
                          </button>
                          <button
                            onClick={() => withdraw(o)}
                            disabled={busyId === o.id}
                            className="font-mono text-[10px] tracking-widest px-2 py-0.5 border border-[var(--leather)] text-[var(--leather)] opacity-80 hover:opacity-100 hover:bg-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors"
                          >
                            {busyId === o.id ? "…" : "WITHDRAW"}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
