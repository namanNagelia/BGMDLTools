"use client";

import type { CurrentSeasonRanks } from "@/lib/api";

interface Props {
  abbrev: string;
  ranks: CurrentSeasonRanks;
}

const TIER_LABEL: Record<number, string> = {
  5: "MEGA-MARKET",
  4: "LARGE",
  3: "MID",
  2: "SMALL",
  1: "MICRO",
};

export function TeamCard({ abbrev, ranks }: Props) {
  const market = ranks.market[abbrev];
  const legacy = ranks.legacy[abbrev];
  const winning = ranks.winning[abbrev];

  if (!market && !legacy && !winning) {
    return (
      <div className="border rule p-4 font-mono text-[10px] tracking-widest opacity-60">
        NO RANK DATA FOR {abbrev}
      </div>
    );
  }

  const teamName = market?.teamName ?? legacy?.teamName ?? winning?.teamCity ?? abbrev;

  return (
    <div className="border rule p-4 sm:p-5 bg-[color:var(--ink-2)]">
      {/* HEADER */}
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div>
          <div className="eyebrow opacity-60">YOUR FRANCHISE</div>
          <div className="display text-4xl sm:text-5xl leading-none mt-1 flex items-baseline gap-3">
            <span className="text-[var(--leather)]">{abbrev}</span>
            <span className="text-base sm:text-lg opacity-80">{teamName}</span>
          </div>
        </div>
      </div>

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
