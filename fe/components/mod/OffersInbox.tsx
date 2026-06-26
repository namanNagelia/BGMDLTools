"use client";

import { useEffect, useState } from "react";
import { ApiError, mod, type OfferWithFlags } from "@/lib/api";

export function OffersInbox() {
  const [rows, setRows] = useState<OfferWithFlags[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await mod.listAllOffers();
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "LOAD FAILED");
    } finally {
      setLoading(false);
    }
  }

  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  async function handleWithdraw(id: number) {
    setWithdrawingId(id);
    try {
      await mod.withdrawOffer(id);
      setConfirmId(null);
      setRows((xs) => xs.filter((o) => o.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "WITHDRAW FAILED");
    } finally {
      setWithdrawingId(null);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const pending = rows.filter((r) => r.status === "PENDING");
  const flagged = pending.filter((r) => r.invalidReasons.length > 0);

  // group by player
  const byPlayer = new Map<number, OfferWithFlags[]>();
  for (const r of pending) {
    const list = byPlayer.get(r.freeAgentId) ?? [];
    list.push(r);
    byPlayer.set(r.freeAgentId, list);
  }
  const groups = Array.from(byPlayer.entries()).sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-5">
        <div>
          <div className="eyebrow opacity-60">DESK B · OFFERS INBOX</div>
          <h2 className="display text-[10vw] sm:text-[5vw] leading-[0.85] mt-2">
            INCOMING <span className="text-[var(--leather)]">OFFERS</span>
          </h2>
        </div>
        <div className="font-mono text-[10px] tracking-widest opacity-50 text-right">
          {pending.length} PENDING
          <br />
          {flagged.length > 0 && (
            <span className="text-[var(--mustard)]">⚠ {flagged.length} WITH WARNINGS</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={refresh}
          disabled={loading}
          className="font-mono text-[10px] tracking-widest px-3 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors"
        >
          {loading ? "REFRESHING…" : "↻ REFRESH"}
        </button>
      </div>

      {error && (
        <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)] mb-4">
          {error}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="border-2 border-dashed border-[color:var(--rule-soft)] py-12 text-center font-mono text-xs tracking-widest opacity-60">
          NO PENDING OFFERS
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([faId, faOffers]) => {
            const name = faOffers[0].playerName ?? `#${faId}`;
            const prev = faOffers[0].playerPreviousTeam;
            return (
              <div key={faId} className="border rule">
                <div className="border-b rule px-3 py-2 bg-[color:var(--ink-2)] flex items-baseline justify-between">
                  <div className="font-mono text-sm">
                    <span className="opacity-60">{prev} · </span>
                    <span className="font-bold">{name}</span>
                  </div>
                  <div className="font-mono text-[10px] tracking-widest opacity-60">
                    {faOffers.length} OFFER{faOffers.length === 1 ? "" : "S"}
                  </div>
                </div>
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b rule">
                      <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">TEAM</th>
                      <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">GM</th>
                      <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60">AMT/YR</th>
                      <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60">YRS</th>
                      <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60">TOTAL</th>
                      <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">FLAGS</th>
                      <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-24">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faOffers
                      .slice()
                      .sort((a, b) => Number(b.offerAmount) - Number(a.offerAmount))
                      .map((o) => {
                        const total = Number(o.offerAmount) * o.offerLength;
                        const flagged = o.invalidReasons.length > 0;
                        return (
                          <tr
                            key={o.id}
                            className={`border-b rule last:border-b-0 ${
                              flagged ? "bg-[color:rgba(217,166,55,0.10)]" : ""
                            }`}
                          >
                            <td className="px-3 py-1.5 font-bold">{o.teamAbbrev}</td>
                            <td className="px-3 py-1.5 opacity-80">{o.offerGm}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              ${Number(o.offerAmount).toFixed(1)}M
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {o.offerLength}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums opacity-80">
                              ${total.toFixed(1)}M
                            </td>
                            <td className="px-3 py-1.5">
                              {flagged ? (
                                <ul className="text-[10px] text-[var(--mustard)] space-y-0.5">
                                  <li className="opacity-70 tracking-widest">⚠ WARNING</li>
                                  {o.invalidReasons.map((r, i) => (
                                    <li key={i}>· {r}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-[10px] tracking-widest opacity-50">OK</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right whitespace-nowrap">
                              {confirmId === o.id ? (
                                <span className="inline-flex gap-1">
                                  <button
                                    onClick={() => handleWithdraw(o.id)}
                                    disabled={withdrawingId === o.id}
                                    className="font-mono text-[10px] tracking-widest px-2 py-0.5 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] disabled:opacity-40 transition-colors"
                                  >
                                    {withdrawingId === o.id ? "…" : "CONFIRM"}
                                  </button>
                                  <button
                                    onClick={() => setConfirmId(null)}
                                    className="font-mono text-[10px] tracking-widest px-2 py-0.5 border rule opacity-70 hover:opacity-100 transition-opacity"
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setConfirmId(o.id)}
                                  className="font-mono text-[10px] tracking-widest px-2 py-0.5 border rule hover:border-[var(--leather)] hover:text-[var(--leather)] transition-colors"
                                >
                                  WITHDRAW
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
