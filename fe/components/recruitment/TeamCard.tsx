"use client";

import { useState } from "react";
import type {
  CurrentSeasonRanks,
  FreeAgent,
  TeamRow,
} from "@/lib/api";
import { Disclosure } from "./Disclosure";

interface Props {
  abbrev: string;
  ranks: CurrentSeasonRanks;
  teams: Record<string, TeamRow>;
  ownFAs: FreeAgent[];
  onRenounce: (faId: number, renounced: boolean) => Promise<void>;
}

const TIER_LABEL: Record<number, string> = {
  5: "MEGA-MARKET",
  4: "LARGE",
  3: "MID",
  2: "SMALL",
  1: "MICRO",
};

const SOFT_CAP = 100; // $M
const HARD_CAP = 130; // $M
const MLE1_FLOOR = 92.5;
const MLE1_CEIL = 107.5;

function fmt(n: number, suffix = "M"): string {
  return `${n >= 0 ? "" : "−"}$${Math.abs(n).toFixed(1)}${suffix}`;
}

export function TeamCard({ abbrev, ranks, teams, ownFAs, onRenounce }: Props) {
  const market = ranks.market[abbrev];
  const legacy = ranks.legacy[abbrev];
  const winning = ranks.winning[abbrev];
  const team = teams[abbrev];

  const [pendingId, setPendingId] = useState<number | null>(null);

  async function handleRenounce(fa: FreeAgent) {
    setPendingId(fa.id);
    try {
      await onRenounce(fa.id, !fa.renounced);
    } finally {
      setPendingId(null);
    }
  }

  // cap math — renounced FAs do NOT count toward cap holds
  const salary = team ? Number(team.totalSalary) : 0;
  const activeHolds = ownFAs.filter((f) => !f.renounced);
  const renouncedHolds = ownFAs.filter((f) => f.renounced);
  const capHolds = activeHolds.reduce((s, f) => s + Number(f.capHold || 0), 0);
  const renouncedSavings = renouncedHolds.reduce(
    (s, f) => s + Number(f.capHold || 0),
    0,
  );
  const committed = salary + capHolds;
  const softRoom = SOFT_CAP - committed;
  const hardRoom = HARD_CAP - committed;
  const overSoft = softRoom < 0;
  const overHard = hardRoom < 0;

  // MLE tier
  let mleTier: 1 | 2 | null = null;
  let mleAmt = 0;
  let mleYrs = 0;
  if (committed >= MLE1_FLOOR && committed <= MLE1_CEIL) {
    mleTier = 1;
    mleAmt = 7.5;
    mleYrs = 4;
  } else if (committed > MLE1_CEIL) {
    mleTier = 2;
    mleAmt = 4.5;
    mleYrs = 3;
  }

  const roster = team?.roster ?? [];

  if (!market && !legacy && !winning) {
    return (
      <div className="border rule p-4 font-mono text-[10px] tracking-widest opacity-60">
        NO RANK DATA FOR {abbrev}
      </div>
    );
  }

  const teamName = market?.teamName ?? legacy?.teamName ?? winning?.teamCity ?? abbrev;

  return (
    <div className="border rule p-3 sm:p-5 bg-[color:var(--ink-2)]">
      {/* HEADER */}
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="eyebrow opacity-60">YOUR FRANCHISE</div>
          <div className="display text-3xl sm:text-5xl leading-none mt-1 flex items-baseline flex-wrap gap-x-3 gap-y-1">
            <span className="text-[var(--leather)]">{abbrev}</span>
            <span className="text-sm sm:text-lg opacity-80">{teamName}</span>
          </div>
        </div>
      </div>

      {/* CAP SUMMARY */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="border rule p-3">
          <div className="eyebrow opacity-60">PAYROLL</div>
          <div className="display text-2xl leading-none mt-1 tabular-nums">
            {fmt(salary)}
          </div>
          <div className="font-mono text-[10px] tracking-widest opacity-50 mt-1">
            CURRENT ROSTER
          </div>
        </div>
        <div className="border rule p-3">
          <div className="eyebrow opacity-60">CAP HOLDS</div>
          <div className="display text-2xl leading-none mt-1 tabular-nums">
            {fmt(capHolds)}
          </div>
          <div className="font-mono text-[10px] tracking-widest opacity-50 mt-1">
            {activeHolds.length} HELD
            {renouncedHolds.length > 0 && (
              <span className="text-[var(--mustard)]">
                {" "}
                · {renouncedHolds.length} RENOUNCED ({fmt(renouncedSavings)} SAVED)
              </span>
            )}
          </div>
        </div>
        <div
          className={`border p-3 ${overSoft ? "border-[var(--mustard)]" : "rule"}`}
        >
          <div className="eyebrow opacity-60">SOFT CAP ROOM</div>
          <div
            className={`display text-2xl leading-none mt-1 tabular-nums ${
              overSoft ? "text-[var(--mustard)]" : ""
            }`}
          >
            {fmt(softRoom)}
          </div>
          <div className="font-mono text-[10px] tracking-widest opacity-50 mt-1">
            VS ${SOFT_CAP}M · {overSoft ? "OVER CAP" : "UNDER"}
          </div>
        </div>
        <div
          className={`border p-3 ${overHard ? "border-[var(--leather)]" : "rule"}`}
        >
          <div className="eyebrow opacity-60">HARD CAP ROOM</div>
          <div
            className={`display text-2xl leading-none mt-1 tabular-nums ${
              overHard ? "text-[var(--leather)]" : ""
            }`}
          >
            {fmt(hardRoom)}
          </div>
          <div className="font-mono text-[10px] tracking-widest opacity-50 mt-1">
            VS ${HARD_CAP}M · {overHard ? "OVER CAP" : "HEADROOM"}
          </div>
        </div>
      </div>

      {/* OWN FAs WITH CAP HOLDS */}
      {ownFAs.length > 0 && (
        <Disclosure
          title="MANAGE RENOUNCEMENTS"
          subtitle={`${ownFAs.length} expiring FA${ownFAs.length === 1 ? "" : "s"}`}
          accent="leather"
          flag={
            <>
              ACTIVE HOLDS · {fmt(capHolds)}
              {renouncedHolds.length > 0 && (
                <span className="text-[var(--mustard)]">
                  {" "}
                  · {fmt(renouncedSavings)} SAVED
                </span>
              )}
            </>
          }
          defaultOpen
        >
          <div className="border rule overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full font-mono text-xs min-w-[500px]">
              <thead>
                <tr className="border-b rule">
                  <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">
                    NAME
                  </th>
                  <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60 w-14">
                    POS
                  </th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-14">
                    OVR
                  </th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-20">
                    HOLD
                  </th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-14">
                    STATUS
                  </th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-24">
                    RIGHTS
                  </th>
                </tr>
              </thead>
              <tbody>
                {ownFAs
                  .slice()
                  .sort((a, b) => {
                    // active first (by hold desc), then renounced (by hold desc)
                    if (a.renounced !== b.renounced) return a.renounced ? 1 : -1;
                    return Number(b.capHold) - Number(a.capHold);
                  })
                  .map((f) => {
                    const isPending = pendingId === f.id;
                    return (
                      <tr
                        key={f.id}
                        className={`border-b rule last:border-b-0 hover:bg-[color:var(--ink)] transition-colors ${
                          f.renounced ? "opacity-50" : ""
                        }`}
                      >
                        <td
                          className={`px-3 py-1 ${
                            f.renounced ? "line-through decoration-[var(--mustard)]" : ""
                          }`}
                        >
                          {f.name}
                        </td>
                        <td className="px-3 py-1 opacity-80">{f.position}</td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {f.overall}
                        </td>
                        <td
                          className={`px-3 py-1 text-right tabular-nums ${
                            f.renounced ? "line-through decoration-[var(--mustard)]" : ""
                          }`}
                        >
                          {fmt(Number(f.capHold))}
                        </td>
                        <td
                          className={`px-3 py-1 text-right text-[10px] tracking-widest ${
                            f.faStatus === "RFA"
                              ? "text-[var(--mustard)]"
                              : "opacity-70"
                          }`}
                        >
                          {f.faStatus}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <button
                            onClick={() => handleRenounce(f)}
                            disabled={isPending}
                            title={
                              f.renounced
                                ? "Restore Bird/RFA rights and put the cap hold back on the books"
                                : "Renounce rights to clear the cap hold (reversible)"
                            }
                            className={`font-mono text-[10px] tracking-widest px-2 py-0.5 border transition-colors disabled:opacity-40 ${
                              f.renounced
                                ? "border-[var(--mustard)] text-[var(--mustard)] hover:bg-[var(--mustard)] hover:text-[var(--ink)]"
                                : "rule hover:border-[var(--leather)] hover:text-[var(--leather)]"
                            }`}
                          >
                            {isPending
                              ? "…"
                              : f.renounced
                                ? "RESTORE"
                                : "RENOUNCE"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}

      {/* ELIGIBILITY HINTS */}
      <div className="border rule p-3 mb-3 font-mono text-[11px] tracking-widest flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="eyebrow opacity-60">YOU CAN OFFER:</span>
        <span>
          <span className="opacity-50">MIN ·</span> $1M / 1+yr (always available)
        </span>
        {mleTier && (
          <span className="text-[var(--mustard)]">
            MLE T{mleTier} · up to ${mleAmt}M / {mleYrs}yr
          </span>
        )}
        {!overSoft && (
          <span className="text-[var(--leather)]">
            CAP SPACE · {fmt(softRoom)} under soft
          </span>
        )}
        {overSoft && !overHard && (
          <span className="opacity-70">
            BIRD/MLE ONLY · {fmt(hardRoom)} under hard
          </span>
        )}
        {overHard && (
          <span className="text-[var(--leather)]">⚠ OVER HARD CAP · trade out</span>
        )}
        {activeHolds.length > 0 && (
          <span className="opacity-70">
            BIRD · {activeHolds.length} own FA{activeHolds.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* CURRENT ROSTER */}
      {roster.length > 0 && (
        <Disclosure
          title="CURRENT ROSTER"
          subtitle={`${roster.length} players`}
          flag={<>PAYROLL · {fmt(salary)}</>}
          defaultOpen={false}
        >
          <div className="border rule overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full font-mono text-xs min-w-[520px]">
              <thead>
                <tr className="border-b rule">
                  <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60">NAME</th>
                  <th className="px-3 py-1 text-left text-[10px] tracking-widest opacity-60 w-12">POS</th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-12">OVR</th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-12">AGE</th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-16">EXP</th>
                  <th className="px-3 py-1 text-right text-[10px] tracking-widest opacity-60 w-20">SALARY</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr
                    key={p.pid}
                    className="border-b rule last:border-b-0 hover:bg-[color:var(--ink)] transition-colors"
                  >
                    <td className="px-3 py-1">{p.name}</td>
                    <td className="px-3 py-1 opacity-80">{p.pos ?? "—"}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{p.ovr ?? "—"}</td>
                    <td className="px-3 py-1 text-right tabular-nums opacity-70">
                      {p.age ?? "—"}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums opacity-70">
                      {p.contractExp ?? "—"}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {fmt(p.contractAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}

      {/* THREE STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* MARKET */}
        <div className="border rule p-3">
          <div className="eyebrow opacity-60">MARKET</div>
          {market ? (
            <div className="mt-1">
              <div className="flex items-baseline gap-2">
                <span className="display text-3xl leading-none">{market.rank}</span>
                <span className="font-mono text-[10px] tracking-widest opacity-70">
                  / 5
                </span>
              </div>
              <div className="font-mono text-[10px] tracking-widest opacity-60 mt-1">
                {TIER_LABEL[market.rank] ?? "—"}
              </div>
            </div>
          ) : (
            <div className="opacity-50 text-xs mt-2">—</div>
          )}
        </div>

        {/* LEGACY */}
        <div className="border rule p-3">
          <div className="eyebrow opacity-60">LEGACY</div>
          {legacy ? (
            <div className="mt-1 space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="display text-3xl leading-none">{legacy.tier}</span>
                <span className="font-mono text-[10px] tracking-widest opacity-70">
                  TIER
                </span>
              </div>
              <div className="font-mono text-[11px] flex gap-3 mt-1">
                <span>
                  <span className="opacity-50">T·</span>
                  {legacy.titles}
                </span>
                <span>
                  <span className="opacity-50">F·</span>
                  {legacy.finals}
                </span>
                {legacy.playoffPct != null && (
                  <span className="opacity-70">
                    <span className="opacity-50">PO·</span>
                    {legacy.playoffPct}%
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="opacity-50 text-xs mt-2">—</div>
          )}
        </div>

        {/* WINNING (last season standing) */}
        <div className="border rule p-3">
          <div className="eyebrow opacity-60">LAST SEASON</div>
          {winning ? (
            <div className="mt-1">
              <div className="flex items-baseline gap-2">
                <span className="display text-3xl leading-none">#{winning.rank}</span>
                <span
                  className={`font-mono text-[10px] tracking-widest ${
                    winning.postseason === "CHAMPION"
                      ? "text-[var(--leather)]"
                      : winning.postseason === "FINALS"
                        ? "text-[var(--mustard)]"
                        : "opacity-60"
                  }`}
                >
                  {winning.postseason ?? "—"}
                </span>
              </div>
              <div className="font-mono text-[10px] tracking-widest opacity-60 mt-1">
                {winning.postseason === "CHAMPION"
                  ? "RING ON THE FINGER"
                  : winning.postseason === "FINALS"
                    ? "GOT TO THE FINALS"
                    : winning.postseason === "CF"
                      ? "CONFERENCE FINALIST"
                      : winning.rank <= 8
                        ? "PLAYOFFS"
                        : winning.rank <= 16
                          ? "PLAY-IN BUBBLE"
                          : "LOTTERY"}
              </div>
            </div>
          ) : (
            <div className="opacity-50 text-xs mt-2">—</div>
          )}
        </div>
      </div>
    </div>
  );
}
