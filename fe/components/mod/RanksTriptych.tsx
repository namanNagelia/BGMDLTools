"use client";

import type { ParsedRanks } from "@/lib/api";

interface Props {
  ranks: ParsedRanks & { error?: string };
}

export function RanksTriptych({ ranks }: Props) {
  const unresolved =
    ranks.legacy.filter((r) => r.abbrev === "?").length +
    ranks.winning.filter((r) => r.abbrev === "?").length;

  if (ranks.error) {
    return (
      <div className="border rule p-3">
        <div className="font-mono text-[10px] tracking-widest opacity-70 mb-1">
          SEASON RANKS
        </div>
        <div className="font-mono text-xs text-[var(--mustard)]">
          ⚠ {ranks.error.toUpperCase()}
        </div>
      </div>
    );
  }

  if (
    ranks.market.length === 0 &&
    ranks.legacy.length === 0 &&
    ranks.winning.length === 0
  ) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-[10px] tracking-widest opacity-80">
        <span>SEASON RANKS</span>
        <span className="opacity-60">MARKET · {ranks.market.length}</span>
        <span className="opacity-60">LEGACY · {ranks.legacy.length}</span>
        <span className="opacity-60">WINNING · {ranks.winning.length}</span>
        {unresolved > 0 && (
          <span className="text-[var(--mustard)]">
            ⚠ {unresolved} UNRESOLVED ABBREV
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* MARKET */}
        <div className="lg:col-span-3 border rule">
          <div className="border-b rule px-3 py-1.5 bg-[color:var(--ink-2)] font-mono text-[10px] tracking-widest">
            MARKET
          </div>
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b rule">
                <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60 w-10">
                  RNK
                </th>
                <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60 w-14">
                  ABV
                </th>
                <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60">
                  TEAM
                </th>
              </tr>
            </thead>
            <tbody>
              {ranks.market.map((m, i) => (
                <tr
                  key={i}
                  className="border-b rule last:border-b-0 hover:bg-[color:var(--ink-2)] transition-colors"
                >
                  <td className="px-2 py-1 tabular-nums opacity-70">{m.tier}</td>
                  <td className="px-2 py-1 font-bold">{m.abbrev}</td>
                  <td className="px-2 py-1 opacity-80 truncate">{m.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* LEGACY */}
        <div className="lg:col-span-6 border rule">
          <div className="border-b rule px-3 py-1.5 bg-[color:var(--ink-2)] font-mono text-[10px] tracking-widest">
            LEGACY
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b rule">
                  {["TIER", "ABV", "TEAM", "T", "F", "PO%"].map((h) => (
                    <th
                      key={h}
                      className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranks.legacy.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b rule last:border-b-0 hover:bg-[color:var(--ink-2)] transition-colors"
                  >
                    <td className="px-2 py-1 tabular-nums opacity-70">{r.tier}</td>
                    <td
                      className={`px-2 py-1 font-bold ${
                        r.abbrev === "?" ? "text-[var(--mustard)]" : ""
                      }`}
                    >
                      {r.abbrev}
                    </td>
                    <td className="px-2 py-1 opacity-80 truncate">{r.name}</td>
                    <td className="px-2 py-1 tabular-nums">{r.titles}</td>
                    <td className="px-2 py-1 tabular-nums">{r.finals}</td>
                    <td className="px-2 py-1 tabular-nums opacity-60">
                      {r.playoffPct ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* WINNING */}
        <div className="lg:col-span-3 border rule">
          <div className="border-b rule px-3 py-1.5 bg-[color:var(--ink-2)] font-mono text-[10px] tracking-widest">
            WINNING
          </div>
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b rule">
                <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60 w-10">
                  RNK
                </th>
                <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60 w-14">
                  ABV
                </th>
                <th className="px-2 py-1 text-left text-[10px] tracking-widest opacity-60">
                  CITY
                </th>
                <th className="px-2 py-1 text-right text-[10px] tracking-widest opacity-60 w-14">
                  RES
                </th>
              </tr>
            </thead>
            <tbody>
              {ranks.winning.map((w, i) => (
                <tr
                  key={i}
                  className="border-b rule last:border-b-0 hover:bg-[color:var(--ink-2)] transition-colors"
                >
                  <td className="px-2 py-1 tabular-nums opacity-70">{w.rank}</td>
                  <td
                    className={`px-2 py-1 font-bold ${
                      w.abbrev === "?" ? "text-[var(--mustard)]" : ""
                    }`}
                  >
                    {w.abbrev}
                  </td>
                  <td className="px-2 py-1 opacity-80 truncate">{w.city}</td>
                  <td
                    className={`px-2 py-1 text-right text-[10px] tracking-widest ${
                      w.postseason === "CHAMPION"
                        ? "text-[var(--leather)]"
                        : w.postseason === "FINALS"
                          ? "text-[var(--mustard)]"
                          : "opacity-60"
                    }`}
                  >
                    {w.postseason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
