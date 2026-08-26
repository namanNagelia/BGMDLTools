"use client";

import { useEffect, useState } from "react";
import { ApiError, mod, publicApi, type OfferWithFlags } from "@/lib/api";
import { CalcModal } from "./CalcModal";

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
  const [calcFaId, setCalcFaId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [teamAbvs, setTeamAbvs] = useState<string[]>([]);
  const [reassigningFa, setReassigningFa] = useState<number | null>(null);
  const [view, setView] = useState<"PENDING" | "SIGNED">("PENDING");
  const [currentSeasonId, setCurrentSeasonId] = useState<number | null>(null);
  const [currentSeasonNumber, setCurrentSeasonNumber] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadInfo, setDownloadInfo] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function handleDownload() {
    if (currentSeasonId == null) return;
    setDownloading(true);
    setDownloadInfo("FETCHING LEAGUE EXPORT…");
    setFallbackUrl(null);
    const url = mod.signedExportUrl(currentSeasonId);
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const signed = res.headers.get("X-Signed-Count") ?? "?";
      setDownloadInfo("PACKAGING…");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `BGMDL_${currentSeasonNumber ?? "current"}_post_FA.json.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      setDownloadInfo(`✓ DOWNLOADED · ${signed} SIGNED`);
      setTimeout(() => setDownloadInfo(null), 6000);
    } catch (err) {
      setDownloadInfo(null);
      setError(err instanceof Error ? err.message.toUpperCase() : "DOWNLOAD FAILED");
      setFallbackUrl(url);
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    publicApi
      .currentSeasonFAs()
      .then((d) => {
        if (!alive) return;
        setTeamAbvs(Object.keys(d.teams).sort());
        setCurrentSeasonId(d.season?.id ?? null);
        setCurrentSeasonNumber(d.season?.seasonNumber ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function handleReassign(faId: number, newAbbrev: string) {
    setReassigningFa(faId);
    try {
      await mod.reassignFARights(faId, newAbbrev);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message.toUpperCase() : "REASSIGN FAILED",
      );
    } finally {
      setReassigningFa(null);
    }
  }

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
  const signed = rows.filter((r) => r.status === "ACCEPTED");
  const flagged = pending.filter((r) => r.invalidReasons.length > 0);
  const activeRows = view === "PENDING" ? pending : signed;

  const byPlayer = new Map<number, OfferWithFlags[]>();
  for (const r of activeRows) {
    const list = byPlayer.get(r.freeAgentId) ?? [];
    list.push(r);
    byPlayer.set(r.freeAgentId, list);
  }
  const allGroups = Array.from(byPlayer.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // filter by player name, previous team, GM name, or team abbrev
  const q = query.trim().toLowerCase();
  const groups = q
    ? allGroups.filter(([, faOffers]) => {
        const sample = faOffers[0];
        return (
          (sample.playerName ?? "").toLowerCase().includes(q) ||
          (sample.playerPreviousTeam ?? "").toLowerCase().includes(q) ||
          faOffers.some(
            (o) =>
              o.teamAbbrev.toLowerCase().includes(q) ||
              o.offerGm.toLowerCase().includes(q),
          )
        );
      })
    : allGroups;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-5">
        <div>
          <div className="eyebrow opacity-60">DESK B · OFFERS</div>
          <h2 className="display text-[10vw] sm:text-[5vw] leading-[0.85] mt-2">
            {view === "PENDING" ? "INCOMING" : "SIGNED"}{" "}
            <span className="text-[var(--leather)]">OFFERS</span>
          </h2>
        </div>
        <div className="font-mono text-[10px] tracking-widest opacity-50 text-right">
          {pending.length} PENDING · {signed.length} SIGNED
          {flagged.length > 0 && view === "PENDING" && (
            <>
              <br />
              <span className="text-[var(--mustard)]">⚠ {flagged.length} WITH WARNINGS</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["PENDING", "SIGNED"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`font-mono text-[10px] tracking-widest px-3 py-1 border transition-colors ${
              view === v
                ? "bg-[var(--leather)] border-[var(--leather)] text-[var(--paper)]"
                : "rule opacity-70 hover:opacity-100"
            }`}
          >
            {v} · {v === "PENDING" ? pending.length : signed.length}
          </button>
        ))}
        {view === "SIGNED" && currentSeasonId != null && signed.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            {downloadInfo && (
              <span
                className={`font-mono text-[10px] tracking-widest ${
                  downloadInfo.startsWith("✓")
                    ? "text-[var(--leather)]"
                    : "opacity-70"
                }`}
              >
                {downloadInfo}
              </span>
            )}
            <button
              onClick={handleDownload}
              disabled={downloading}
              title="Build a BBGM .json.gz with every accepted offer applied (player tids + contracts updated)"
              className="font-mono text-[10px] tracking-widest px-3 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] disabled:bg-[color:var(--ink-2)] disabled:text-[color:rgba(243,237,225,0.4)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {downloading ? (
                <>
                  <span className="spinner" />
                  <span>PREPARING…</span>
                </>
              ) : (
                "↓ DOWNLOAD SIGNED EXPORT"
              )}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="search"
          placeholder="SEARCH PLAYER · TEAM · GM…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[200px] bg-transparent border rule px-3 py-1 outline-none font-mono text-xs tracking-widest focus:border-[var(--leather)] transition-colors"
        />
        {q && (
          <div className="font-mono text-[10px] tracking-widest opacity-60">
            {groups.length} OF {allGroups.length} PLAYERS
          </div>
        )}
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
          {fallbackUrl && (
            <div className="mt-1">
              <a
                href={fallbackUrl}
                download={`BGMDL_${currentSeasonNumber ?? "current"}_post_FA.json.gz`}
                className="underline hover:no-underline opacity-90 hover:opacity-100"
              >
                ↗ DOWNLOAD MANUALLY
              </a>
              <span className="opacity-60 ml-2">
                (opens the export URL directly — works even if the in-page
                download fails on your network)
              </span>
            </div>
          )}
        </div>
      )}

      {activeRows.length === 0 ? (
        <div className="border-2 border-dashed border-[color:var(--rule-soft)] py-12 text-center font-mono text-xs tracking-widest opacity-60">
          {view === "PENDING" ? "NO PENDING OFFERS" : "NO SIGNINGS YET"}
        </div>
      ) : groups.length === 0 ? (
        <div className="border-2 border-dashed border-[color:var(--rule-soft)] py-12 text-center font-mono text-xs tracking-widest opacity-60">
          NO MATCHES FOR &quot;{query}&quot;
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([faId, faOffers]) => {
            const name = faOffers[0].playerName ?? `#${faId}`;
            const prev = faOffers[0].playerPreviousTeam;
            return (
              <div key={faId} className="border rule">
                <div className="border-b rule px-3 py-2 bg-[color:var(--ink-2)] flex items-baseline justify-between flex-wrap gap-2">
                  <div className="font-mono text-sm flex items-baseline flex-wrap gap-x-2 gap-y-1">
                    <span className="font-bold">{name}</span>
                    <span className="opacity-60">·</span>
                    <span className="opacity-60 text-[10px] tracking-widest">
                      RIGHTS:
                    </span>
                    <select
                      value={prev ?? ""}
                      onChange={(e) => handleReassign(faId, e.target.value)}
                      disabled={reassigningFa === faId}
                      title="Reassign Bird/cap-hold rights (e.g. after a mid-FA trade)"
                      className="bg-transparent border rule px-1.5 py-0.5 outline-none font-mono text-[11px] tracking-widest focus:border-[var(--leather)] transition-colors disabled:opacity-40"
                    >
                      {prev && !teamAbvs.includes(prev) && (
                        <option value={prev}>{prev}</option>
                      )}
                      {teamAbvs.map((abv) => (
                        <option key={abv} value={abv}>
                          {abv}
                        </option>
                      ))}
                    </select>
                    {reassigningFa === faId && (
                      <span className="spinner" />
                    )}
                    <span className="opacity-60 text-[10px] tracking-widest">
                      · {faOffers.length} OFFER
                      {faOffers.length === 1 ? "" : "S"}
                    </span>
                  </div>
                  {view === "PENDING" ? (
                    <button
                      onClick={() => setCalcFaId(faId)}
                      className="font-mono text-[10px] tracking-widest px-3 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] transition-colors"
                    >
                      CALC & RESOLVE
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] tracking-widest text-[var(--leather)]">
                      ✓ SIGNED
                    </span>
                  )}
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
                            <td className="px-3 py-1.5 font-bold whitespace-nowrap">
                              {o.teamAbbrev}
                              {o.isMle && (
                                <span
                                  className="ml-1.5 font-mono text-[9px] font-normal tracking-widest text-[var(--mustard)] border border-[var(--mustard)] px-1 py-[1px]"
                                  title="Declared as this team's Mid-Level Exception — one per team, used or not used"
                                >
                                  MLE{o.mleTier ? ` T${o.mleTier}` : ""}
                                </span>
                              )}
                              {o.isDoubleDip && (
                                <span
                                  className="ml-1.5 font-mono text-[9px] font-normal tracking-widest text-[var(--leather)] border border-[var(--leather)] px-1 py-[1px]"
                                  title="Riding on the team's pending RFA offers — void if one of them signs"
                                >
                                  2×DIP
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 opacity-80">
                              <div>{o.offerGm}</div>
                              {o.codeWord && (
                                <div
                                  className="text-[9px] tracking-widest text-[var(--mustard)] font-bold"
                                  title="Code word the GM submitted"
                                >
                                  ⌬ {o.codeWord}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              ${Number(o.offerAmount).toFixed(2)}M
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {o.offerLength}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums opacity-80">
                              ${total.toFixed(2)}M
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
                              {view === "SIGNED" ? (
                                <span className="font-mono text-[10px] tracking-widest text-[var(--leather)]">
                                  ✓
                                </span>
                              ) : confirmId === o.id ? (
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

      {calcFaId !== null && (
        <CalcModal
          faId={calcFaId}
          onClose={() => setCalcFaId(null)}
          onResolved={() => {
            void refresh();
          }}
        />
      )}
    </div>
  );
}
