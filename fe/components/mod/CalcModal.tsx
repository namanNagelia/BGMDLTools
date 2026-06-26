"use client";

import { useEffect, useState } from "react";
import { ApiError, mod, type CalcResult } from "@/lib/api";

interface Props {
  faId: number;
  onClose: () => void;
  onResolved: () => void; // refresh inbox after accept
}

const VALUE_LABELS: Record<string, string> = {
  market: "MARKET",
  legacy: "LEGACY",
  playingTime: "PLAY TIME",
  winning: "WINNING",
  loyalty: "LOYALTY",
  money: "MONEY",
  length: "LENGTH",
};

export function CalcModal({ faId, onClose, onResolved }: Props) {
  const [data, setData] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [acceptedId, setAcceptedId] = useState<number | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    mod
      .calcFA(faId)
      .then((d) => alive && setData(d))
      .catch((err) =>
        alive &&
        setError(err instanceof ApiError ? err.message.toUpperCase() : "FAILED"),
      );
    return () => {
      alive = false;
    };
  }, [faId]);

  async function handleAccept(offerId: number) {
    setAcceptingId(offerId);
    try {
      await mod.acceptOffer(offerId);
      setAcceptedId(offerId);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "ACCEPT FAILED");
    } finally {
      setAcceptingId(null);
    }
  }

  const finalRound = data?.rounds[data.rounds.length - 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(0,0,0,0.8)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-5xl max-h-[94vh] overflow-y-auto bg-[var(--ink)] border rule"
      >
        {/* HEADER */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b rule bg-[color:var(--ink-2)]">
          <div className="min-w-0">
            <div className="eyebrow opacity-60">CALC & RESOLVE</div>
            <div className="display text-2xl sm:text-3xl leading-none mt-1 truncate">
              {data?.player.name ?? "…"}
            </div>
            {data && (
              <div className="font-mono text-[10px] tracking-widest opacity-70 mt-1 flex flex-wrap gap-x-3">
                <span>{data.player.previousTeam}</span>
                <span>{data.player.position}</span>
                <span>OVR {data.player.overall}</span>
                <span
                  className={
                    data.player.faStatus === "RFA"
                      ? "text-[var(--mustard)]"
                      : "text-[var(--leather)]"
                  }
                >
                  {data.player.faStatus}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-lg opacity-70 hover:opacity-100 hover:text-[var(--leather)] px-2 -m-2"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="m-4 border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="font-mono text-xs tracking-widest opacity-60 p-12 text-center">
            COMPUTING<span className="caret ml-1" />
          </div>
        )}

        {data && (
          <div className="p-4 space-y-6">
            {/* PLAYER VALUE SCORES */}
            <div className="border rule p-3">
              <div className="eyebrow opacity-70 mb-2">PLAYER VALUE SCORES</div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
                {(
                  [
                    "market",
                    "legacy",
                    "playingTime",
                    "winning",
                    "loyalty",
                    "money",
                    "length",
                  ] as const
                ).map((k) => (
                  <div key={k} className="border rule px-2 py-1 text-center">
                    <div className="text-[9px] tracking-widest opacity-60">
                      {VALUE_LABELS[k]}
                    </div>
                    <div className="font-mono text-sm tabular-nums">
                      {data.player.values[k]}
                    </div>
                  </div>
                ))}
              </div>
              {data.player.faStatus === "RFA" && (
                <div className="font-mono text-[10px] tracking-widest text-[var(--mustard)] mt-2">
                  ⚠ RFA — only MONEY + LENGTH count (others zeroed)
                </div>
              )}
            </div>

            {/* PRE-FILTER */}
            {data.preFilter.length > 0 && (
              <div className="border rule p-3">
                <div className="eyebrow opacity-70 mb-2">
                  10M/20M FILTER — DROPPED OFFERS
                </div>
                <ul className="font-mono text-xs space-y-1">
                  {data.preFilter.map((p, i) => (
                    <li key={i} className="opacity-70">
                      <span className="font-bold">{p.teamAbbrev}</span> — {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ROUNDS */}
            {data.rounds.length > 1 && (
              <div className="eyebrow opacity-60">
                HAYATO ELIMINATION · {data.rounds.length} ROUNDS
              </div>
            )}

            {data.rounds.map((rnd, i) => {
              const isFinal = i === data.rounds.length - 1;
              return (
                <div key={rnd.round} className="border rule">
                  <div className="border-b rule px-3 py-2 bg-[color:var(--ink-2)] flex items-baseline justify-between">
                    <div className="font-mono text-[10px] tracking-widest">
                      ROUND {rnd.round} · {rnd.teams.length} TEAM
                      {rnd.teams.length === 1 ? "" : "S"}
                    </div>
                    {!isFinal && rnd.eliminatedAbbrev && (
                      <div className="font-mono text-[10px] tracking-widest text-[var(--mustard)]">
                        ▼ ELIMINATED: {rnd.eliminatedAbbrev} (
                        {rnd.eliminatedTotal?.toFixed(2)})
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full font-mono text-xs min-w-[640px]">
                      <thead>
                        <tr className="border-b rule">
                          <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60">
                            TEAM
                          </th>
                          <th className="px-2 py-1 text-right text-[10px] tracking-widest opacity-60">
                            OFFER
                          </th>
                          {(
                            [
                              "market",
                              "legacy",
                              "playingTime",
                              "winning",
                              "loyalty",
                              "money",
                              "length",
                            ] as const
                          ).map((k) => (
                            <th
                              key={k}
                              className="px-2 py-1 text-right text-[10px] tracking-widest opacity-60"
                            >
                              {VALUE_LABELS[k]}
                            </th>
                          ))}
                          <th className="px-2 py-1 text-right text-[10px] tracking-widest opacity-60">
                            TOTAL
                          </th>
                          {isFinal && (
                            <th className="px-2 py-1 text-right text-[10px] tracking-widest opacity-60 w-24">
                              ACTION
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rnd.teams
                          .slice()
                          .sort((a, b) => b.total - a.total)
                          .map((t) => {
                            const isWinner =
                              isFinal && data.winner?.abbrev === t.teamAbbrev;
                            const isEliminated =
                              !isFinal && rnd.eliminatedAbbrev === t.teamAbbrev;
                            return (
                              <tr
                                key={t.offerId}
                                className={`border-b rule last:border-b-0 ${
                                  isWinner
                                    ? "bg-[color:rgba(230,69,31,0.15)]"
                                    : isEliminated
                                      ? "opacity-50"
                                      : ""
                                }`}
                              >
                                <td className="px-2 py-1.5 font-bold whitespace-nowrap">
                                  {t.teamAbbrev}
                                  <span className="opacity-50 text-[10px] ml-2">
                                    {t.gm}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                  ${t.amount.toFixed(1)}M / {t.years}yr
                                  <div className="text-[9px] opacity-50">
                                    ${t.totalMoney.toFixed(0)}M total
                                  </div>
                                </td>
                                {t.values.map((v) => (
                                  <td
                                    key={v.key}
                                    className={`px-2 py-1.5 text-right tabular-nums ${
                                      v.won
                                        ? "text-[var(--leather)] font-bold"
                                        : "opacity-50"
                                    }`}
                                    title={v.note ?? ""}
                                  >
                                    {v.points.toFixed(2)}
                                  </td>
                                ))}
                                <td className="px-2 py-1.5 text-right tabular-nums display text-lg">
                                  {t.total.toFixed(2)}
                                </td>
                                {isFinal && (
                                  <td className="px-2 py-1.5 text-right">
                                    {acceptedId === t.offerId ? (
                                      <span className="font-mono text-[10px] tracking-widest text-[var(--leather)]">
                                        ✓ SIGNED
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => handleAccept(t.offerId)}
                                        disabled={
                                          acceptingId !== null ||
                                          acceptedId !== null
                                        }
                                        className={`font-mono text-[10px] tracking-widest px-2 py-1 transition-colors disabled:opacity-30 ${
                                          isWinner
                                            ? "bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)]"
                                            : "border rule hover:border-[var(--leather)] hover:text-[var(--leather)]"
                                        }`}
                                      >
                                        {acceptingId === t.offerId
                                          ? "…"
                                          : isWinner
                                            ? "ACCEPT"
                                            : "OVERRIDE"}
                                      </button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* WINNER STRIP */}
            {data.winner && (
              <div className="border-2 border-[var(--leather)] p-3 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <div className="eyebrow opacity-70">WINNER PER CALC</div>
                  <div className="display text-3xl mt-1 text-[var(--leather)]">
                    {data.winner.abbrev}
                  </div>
                </div>
                <div className="font-mono text-sm tabular-nums">
                  {data.winner.total.toFixed(2)} pts
                </div>
              </div>
            )}

            <div className="font-mono text-[10px] tracking-widest opacity-50">
              MOD CAN OVERRIDE BY ACCEPTING A DIFFERENT OFFER. ACCEPTING SIGNS THE
              PLAYER & AUTO-REJECTS OTHER OFFERS.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
