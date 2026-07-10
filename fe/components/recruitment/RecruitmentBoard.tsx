"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  publicApi,
  type CurrentSeasonRanks,
  type FreeAgent,
  type Season,
} from "@/lib/api";
import { TeamCard } from "./TeamCard";
import { OfferModal } from "./OfferModal";
import { HowToPanel } from "../HowToPanel";
import { MyOffersPanel } from "./MyOffersPanel";

const TEAM_STORAGE_KEY = "gmTeamAbbrev";

type SortKey =
  | "name"
  | "previousTeam"
  | "position"
  | "age"
  | "overall"
  | "capHold"
  | "faStatus"
  | "marketValue"
  | "legacyValue"
  | "playingTimeValue"
  | "winningValue"
  | "loyaltyValue"
  | "moneyValue"
  | "lengthValue";

interface Column {
  key: SortKey;
  label: string;
  align?: "right";
  width?: string;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Player" },
  { key: "previousTeam", label: "Team", width: "60px" },
  { key: "position", label: "Pos", width: "50px" },
  { key: "age", label: "Age", width: "50px", align: "right" },
  { key: "overall", label: "Ovr", width: "50px", align: "right" },
  { key: "faStatus", label: "Status", width: "70px" },
  { key: "marketValue", label: "MKT", width: "50px", align: "right" },
  { key: "legacyValue", label: "LGC", width: "50px", align: "right" },
  { key: "playingTimeValue", label: "PT", width: "50px", align: "right" },
  { key: "winningValue", label: "WIN", width: "50px", align: "right" },
  { key: "loyaltyValue", label: "LOY", width: "50px", align: "right" },
  { key: "moneyValue", label: "MNY", width: "50px", align: "right" },
  { key: "lengthValue", label: "LEN", width: "50px", align: "right" },
];

const PAGE_SIZE = 30;

// rating fields we want to surface in the expand drawer
const RATING_FIELDS = [
  "ovr",
  "pot",
  "hgt",
  "stre",
  "spd",
  "jmp",
  "endu",
  "ins",
  "dnk",
  "ft",
  "fg",
  "tp",
  "oiq",
  "diq",
  "drb",
  "pss",
  "reb",
];

function compareFn(a: FreeAgent, b: FreeAgent, key: SortKey, dir: 1 | -1): number {
  const av = a[key];
  const bv = b[key];
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
}

export function RecruitmentBoard() {
  const [data, setData] = useState<{
    season: Season | null;
    freeAgents: FreeAgent[];
    ranks: CurrentSeasonRanks;
    teams: Record<string, import("@/lib/api").TeamRow>;
  }>({
    season: null,
    freeAgents: [],
    ranks: { market: {}, legacy: {}, winning: {} },
    teams: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gmTeam, setGmTeam] = useState<string>("");

  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [matchMarket, setMatchMarket] = useState(false);
  const [matchLegacy, setMatchLegacy] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [offerFor, setOfferFor] = useState<FreeAgent | null>(null);
  const [tab, setTab] = useState<"roster" | "fa">("fa");

  // hydrate gmTeam from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(TEAM_STORAGE_KEY);
      if (stored) setGmTeam(stored);
    }
  }, []);

  function pickTeam(abbrev: string) {
    setGmTeam(abbrev);
    if (typeof window !== "undefined") {
      if (abbrev) window.localStorage.setItem(TEAM_STORAGE_KEY, abbrev);
      else window.localStorage.removeItem(TEAM_STORAGE_KEY);
    }
  }

  useEffect(() => {
    let alive = true;
    publicApi
      .currentSeasonFAs()
      .then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(
            err instanceof ApiError ? err.message.toUpperCase() : "LOAD FAILED",
          );
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const positions = useMemo(
    () =>
      Array.from(new Set(data.freeAgents.map((f) => f.position).filter(Boolean))).sort(),
    [data.freeAgents],
  );
  const teams = useMemo(
    () =>
      Array.from(new Set(data.freeAgents.map((f) => f.previousTeam).filter(Boolean))).sort(),
    [data.freeAgents],
  );

  // canonical team list from market ranks (full names + abbrevs)
  const teamRoster = useMemo(() => {
    const fromMarket = Object.values(data.ranks.market).map((m) => ({
      abbrev: m.teamAbbrev,
      name: m.teamName,
    }));
    if (fromMarket.length > 0) {
      return fromMarket.sort((a, b) => a.name.localeCompare(b.name));
    }
    // fallback: pull abbrevs out of FA previousTeam set
    return teams.map((t) => ({ abbrev: t, name: t }));
  }, [data.ranks.market, teams]);

  // your team's market rank / legacy tier (used for highlight + match filters)
  const myMarketRank = gmTeam ? data.ranks.market[gmTeam]?.rank ?? null : null;
  const myLegacyTier = gmTeam ? data.ranks.legacy[gmTeam]?.tier ?? null : null;

  // clear the match toggles if the user un-picks their team
  useEffect(() => {
    if (!gmTeam) {
      setMatchMarket(false);
      setMatchLegacy(false);
    }
  }, [gmTeam]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.freeAgents.filter((f) => {
      if (posFilter !== "ALL" && f.position !== posFilter) return false;
      if (statusFilter !== "ALL" && f.faStatus !== statusFilter) return false;
      if (teamFilter !== "ALL" && f.previousTeam !== teamFilter) return false;
      if (matchMarket && myMarketRank != null && f.marketValue !== myMarketRank)
        return false;
      if (matchLegacy && myLegacyTier != null && f.legacyValue !== myLegacyTier)
        return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    data.freeAgents,
    query,
    posFilter,
    statusFilter,
    teamFilter,
    matchMarket,
    matchLegacy,
    myMarketRank,
    myLegacyTier,
  ]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareFn(a, b, sortKey, sortDir)),
    [filtered, sortKey, sortDir],
  );

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(typeof data.freeAgents[0]?.[key] === "number" ? -1 : 1);
    }
    setPage(0);
  }

  if (loading) {
    return (
      <div className="font-mono text-xs tracking-widest opacity-60 py-16 text-center">
        OPENING DRAFT BOARD<span className="caret ml-1" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
        {error}
      </div>
    );
  }

  if (!data.season) {
    return (
      <div className="border-2 border-dashed border-[color:var(--rule-soft)] p-10 text-center font-mono text-xs tracking-widest opacity-70">
        NO CURRENT SEASON ON FILE
        <br />
        <span className="opacity-50 mt-2 inline-block">
          A MOD MUST INGEST FREE AGENTS FROM /MOD
        </span>
      </div>
    );
  }

  if (data.freeAgents.length === 0) {
    return (
      <div className="border-2 border-dashed border-[color:var(--rule-soft)] p-10 text-center font-mono text-xs tracking-widest opacity-70">
        SEASON {data.season.seasonNumber} HAS NO FREE AGENTS INGESTED YET
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HowToPanel
        storageKey="gm-howto-open"
        title="HOW TO SUBMIT AN OFFER"
        steps={[
          {
            num: 1,
            title: "Pick your team",
            body: (
              <>Use the <b>YOUR TEAM</b> dropdown (top right). Your cap snapshot, eligibility, expiring FAs and ranks all unlock.</>
            ),
          },
          {
            num: 2,
            title: "Check your room",
            body: (
              <>The cap card shows payroll, cap holds, soft + hard cap room, and which tools you can use (<b>MLE</b>, <b>min</b>, <b>Bird</b> on your own non-renounced FAs).</>
            ),
          },
          {
            num: 3,
            title: "Renounce what you don't want",
            body: (
              <>In <b>MANAGE RENOUNCEMENTS</b>, drop the cap holds for any expiring FAs you won't re-sign. This frees real money but waives Bird rights on them.</>
            ),
          },
          {
            num: 4,
            title: "Find players",
            body: (
              <>Search by name, filter by position / team / status. Toggle <b>FIT FILTER</b> to narrow to players whose MKT / LGC matches your team — matching cells highlight orange in every row.</>
            ),
          },
          {
            num: 5,
            title: "Send an offer",
            body: (
              <>Click <b>OFFER</b> on any row. Enter amount ($M/yr), years, your GM name, and a code word the mod will recognize as yours. Live warnings show if your cap doesn't fit — submit anyway (trades count).</>
            ),
          },
          {
            num: 6,
            title: "Wait for the call",
            body: (
              <>Mods process offers using the FA value calc. You won't see other teams' offers. If you sign someone, they show up in the next ingest as part of your roster.</>
            ),
          },
        ]}
      />
      {/* HEADER + TEAM PICKER ---------------------------------------- */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="eyebrow opacity-60">RECRUITMENT BOARD</div>
          <div className="display text-[10vw] sm:text-[5vw] leading-[0.85] mt-1 flex items-baseline flex-wrap gap-x-3">
            <span>
              SEASON <span className="text-[var(--leather)]">{data.season.seasonNumber}</span>
            </span>
            <span className="font-mono text-xs tracking-widest border border-[var(--leather)] text-[var(--leather)] px-2 py-0.5 self-center">
              WAVE {data.season.currentWave}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-widest">
          <span className="opacity-60">YOUR TEAM</span>
          <select
            value={gmTeam}
            onChange={(e) => pickTeam(e.target.value)}
            className="bg-transparent border rule px-3 py-2 outline-none font-mono text-xs tracking-widest focus:border-[var(--leather)] transition-colors min-w-[14rem]"
          >
            <option value="">— CHOOSE YOUR TEAM —</option>
            {teamRoster.map((t) => (
              <option key={t.abbrev} value={t.abbrev}>
                {t.abbrev} · {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* TABS ---------------------------------------------------------- */}
      <div className="flex border-b rule">
        {(
          [
            { key: "roster" as const, label: "MY ROSTER" },
            { key: "fa" as const, label: "FREE AGENCY" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 sm:px-6 py-3 font-mono text-xs tracking-widest border-b-2 -mb-[2px] transition-colors ${
              tab === t.key
                ? "border-[var(--leather)] text-[var(--leather)]"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ROSTER TAB --------------------------------------------------- */}
      {tab === "roster" &&
        (gmTeam ? (
          <TeamCard
            abbrev={gmTeam}
            ranks={data.ranks}
            teams={data.teams}
            ownFAs={data.freeAgents.filter((f) => f.previousTeam === gmTeam)}
            view="roster"
            onRenounce={async (faId, renounced) => {
              try {
                await publicApi.renounce(faId, gmTeam, renounced);
                setData((d) => ({
                  ...d,
                  freeAgents: d.freeAgents.map((f) =>
                    f.id === faId ? { ...f, renounced } : f,
                  ),
                }));
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message.toUpperCase() : "RENOUNCE FAILED",
                );
              }
            }}
          />
        ) : (
          <div className="border-2 border-dashed border-[color:var(--rule-soft)] py-12 text-center font-mono text-xs tracking-widest opacity-60">
            PICK YOUR TEAM ABOVE TO SEE YOUR ROSTER + MANAGE RENOUNCEMENTS
          </div>
        ))}

      {/* FA TAB ------------------------------------------------------- */}
      {tab === "fa" && (
        <>
          <MyOffersPanel />

          {gmTeam && (
            <TeamCard
              abbrev={gmTeam}
              ranks={data.ranks}
              teams={data.teams}
              ownFAs={data.freeAgents.filter((f) => f.previousTeam === gmTeam)}
              view="fa"
              onRenounce={async (faId, renounced) => {
                try {
                  await publicApi.renounce(faId, gmTeam, renounced);
                  setData((d) => ({
                    ...d,
                    freeAgents: d.freeAgents.map((f) =>
                      f.id === faId ? { ...f, renounced } : f,
                    ),
                  }));
                } catch (err) {
                  setError(
                    err instanceof ApiError ? err.message.toUpperCase() : "RENOUNCE FAILED",
                  );
                }
              }}
            />
          )}

          <div className="font-mono text-[10px] tracking-widest opacity-50 text-right">
            {sorted.length} OF {data.freeAgents.length} FAs ·{" "}
            {data.freeAgents.filter((f) => f.faStatus === "UFA").length} UFA ·{" "}
            {data.freeAgents.filter((f) => f.faStatus === "RFA").length} RFA
          </div>

      {/* FILTERS BAR --------------------------------------------------- */}
      <div className="border rule grid grid-cols-1 sm:grid-cols-12 gap-2 p-3">
        <input
          type="search"
          placeholder="SEARCH PLAYER NAME…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          className="sm:col-span-4 bg-transparent border rule px-3 py-2 outline-none font-mono text-xs tracking-widest focus:border-[var(--leather)] transition-colors"
        />
        <select
          value={posFilter}
          onChange={(e) => {
            setPosFilter(e.target.value);
            setPage(0);
          }}
          className="sm:col-span-2 bg-transparent border rule px-3 py-2 outline-none font-mono text-xs tracking-widest focus:border-[var(--leather)] transition-colors"
        >
          <option value="ALL">ALL POSITIONS</option>
          {positions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={teamFilter}
          onChange={(e) => {
            setTeamFilter(e.target.value);
            setPage(0);
          }}
          className="sm:col-span-3 bg-transparent border rule px-3 py-2 outline-none font-mono text-xs tracking-widest focus:border-[var(--leather)] transition-colors"
        >
          <option value="ALL">ALL TEAMS</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="sm:col-span-3 bg-transparent border rule px-3 py-2 outline-none font-mono text-xs tracking-widest focus:border-[var(--leather)] transition-colors"
        >
          <option value="ALL">ALL STATUS</option>
          {["UFA", "RFA", "SIGNED", "TBD"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {gmTeam && (myMarketRank != null || myLegacyTier != null) && (
          <div className="sm:col-span-12 border-t rule pt-2 mt-1 flex flex-wrap items-center gap-4 font-mono text-[10px] tracking-widest">
            <span className="opacity-60">FIT FILTER ({gmTeam}):</span>
            {myMarketRank != null && (
              <label className="flex items-center gap-2 cursor-pointer select-none hover:opacity-100">
                <input
                  type="checkbox"
                  checked={matchMarket}
                  onChange={(e) => {
                    setMatchMarket(e.target.checked);
                    setPage(0);
                  }}
                  className="accent-[var(--leather)] w-4 h-4"
                />
                MKT = {myMarketRank}
              </label>
            )}
            {myLegacyTier != null && (
              <label className="flex items-center gap-2 cursor-pointer select-none hover:opacity-100">
                <input
                  type="checkbox"
                  checked={matchLegacy}
                  onChange={(e) => {
                    setMatchLegacy(e.target.checked);
                    setPage(0);
                  }}
                  className="accent-[var(--leather)] w-4 h-4"
                />
                LGC = {myLegacyTier}
              </label>
            )}
            <span className="opacity-50">
              · MATCHING CELLS ARE HIGHLIGHTED IN ORANGE
            </span>
          </div>
        )}
      </div>

      {/* TABLE --------------------------------------------------------- */}
      <div className="border rule overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b rule bg-[color:var(--ink-2)]">
              {COLUMNS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={`px-3 py-2 tracking-widest text-[10px] whitespace-nowrap cursor-pointer hover:text-[var(--leather)] transition-colors select-none ${
                      c.align === "right" ? "text-right" : "text-left"
                    } ${active ? "" : "opacity-70"}`}
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label.toUpperCase()}
                    {active && (
                      <span className="ml-1 text-[var(--leather)]">
                        {sortDir === 1 ? "↑" : "↓"}
                      </span>
                    )}
                  </th>
                );
              })}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {slice.map((f) => {
              const open = expandedId === f.id;
              return (
                <>
                  <tr
                    key={f.id}
                    className="border-b rule hover:bg-[color:var(--ink-2)] cursor-pointer transition-colors"
                    onClick={() => setExpandedId(open ? null : f.id)}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {f.name}
                      {f.source === "BBGM_ONLY" && (
                        <span
                          className="ml-2 px-1.5 py-0.5 border border-[var(--mustard)] text-[var(--mustard)] text-[9px] tracking-widest"
                          title="Not in the values sheet — mods pick the signing manually."
                        >
                          MOD
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap opacity-80">
                      {f.previousTeam}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap opacity-80">
                      {f.position}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{f.age}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold">
                      {f.overall}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span
                        className={`px-1.5 py-0.5 border text-[9px] ${
                          f.faStatus === "RFA"
                            ? "border-[var(--mustard)] text-[var(--mustard)]"
                            : f.faStatus === "SIGNED"
                              ? "border-[var(--leather)] text-[var(--leather)]"
                              : f.faStatus === "TBD"
                                ? "rule opacity-50"
                                : "rule opacity-90"
                        }`}
                      >
                        {f.faStatus}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        myMarketRank != null && f.marketValue === myMarketRank
                          ? "text-[var(--leather)] font-bold"
                          : ""
                      }`}
                    >
                      {f.marketValue}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        myLegacyTier != null && f.legacyValue === myLegacyTier
                          ? "text-[var(--leather)] font-bold"
                          : ""
                      }`}
                    >
                      {f.legacyValue}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {f.playingTimeValue}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {f.winningValue}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {f.loyaltyValue}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {f.moneyValue}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {f.lengthValue}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {gmTeam && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOfferFor(f);
                          }}
                          className="font-mono text-[10px] tracking-widest px-2 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] transition-colors mr-2"
                        >
                          OFFER
                        </button>
                      )}
                      <span className="opacity-50">{open ? "▾" : "▸"}</span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b rule bg-[color:var(--ink-2)]">
                      <td colSpan={COLUMNS.length + 1} className="p-4">
                        <div className="eyebrow opacity-70 mb-3">
                          BBGM RATINGS · {data.season?.seasonNumber}
                        </div>
                        {f.ratings ? (
                          <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-9 gap-2">
                            {RATING_FIELDS.map((k) => {
                              const v = (f.ratings as Record<string, number | null>)?.[k];
                              return (
                                <div key={k} className="border rule px-2 py-1.5">
                                  <div className="text-[9px] tracking-widest opacity-60">
                                    {k.toUpperCase()}
                                  </div>
                                  <div className="text-sm tabular-nums">
                                    {v ?? "—"}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="font-mono text-[10px] tracking-widest opacity-50">
                            NO RATINGS AVAILABLE
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PAGINATION ---------------------------------------------------- */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 font-mono text-[10px] tracking-widest">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-3 py-1.5 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← PREV
          </button>
          <div className="opacity-70">
            PAGE {safePage + 1} / {pageCount} · SHOWING{" "}
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)}
          </div>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="px-3 py-1.5 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            NEXT →
          </button>
        </div>
      )}
        </>
      )}

      {offerFor && gmTeam && (
        <OfferModal
          fa={offerFor}
          teamAbbrev={gmTeam}
          onClose={() => setOfferFor(null)}
          onSubmitted={() => {
            /* fire-and-forget; GMs no longer see offers */
          }}
        />
      )}
    </div>
  );
}
