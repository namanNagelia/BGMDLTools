"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  gleague,
  type GlBoard,
  type GlBoardTeam,
  type GlProposal,
  type GlRequestRow,
  type GlStagedMove,
  type GlViolation,
  type Season,
} from "@/lib/api";

const money = (m: number) => `$${m.toFixed(2)}M`;
const CALLUP_YEARS = [2, 3, 4, 5] as const;

function Violations({ items }: { items: GlViolation[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {items.map((v, i) => (
        <div
          key={i}
          className={`font-mono text-[10px] tracking-wide ${
            v.severity === "HARD" ? "text-[var(--leather)]" : "text-[var(--mustard)]"
          }`}
        >
          {v.severity === "HARD" ? "✕" : "⚠"} {v.message}
        </div>
      ))}
    </div>
  );
}

/**
 * Key for the roster pips. The assigned/original split drives the rule-7
 * limits — five assigned max, the last two slots for original G-Leaguers —
 * and is the one thing here you cannot read off the numbers.
 */
function Legend() {
  const items = [
    { className: "bg-[var(--leather)]", label: "ASSIGNED", hint: "sent down from the main league" },
    {
      className: "bg-[color:rgba(243,237,225,0.55)]",
      label: "ORIGINAL G-LEAGUER",
      hint: "belongs to the affiliate",
    },
    {
      className: "bg-[color:rgba(243,237,225,0.15)]",
      label: "EMPTY SLOT",
      hint: "roster spot open",
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2" title={it.hint}>
          <span className={`inline-block w-1.5 h-3 shrink-0 ${it.className}`} />
          <span className="font-mono text-[10px] tracking-widest opacity-70">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

/** One affiliate's tile in the 30-team grid. */
function TeamTile({
  team,
  active,
  onSelect,
}: {
  team: GlBoardTeam;
  active: boolean;
  onSelect: () => void;
}) {
  const short = team.players.length < 5;
  const over = team.players.length > 7;
  return (
    <button
      onClick={onSelect}
      className={`border rule p-3 text-left transition-colors ${
        active ? "bg-[var(--paper)] text-[var(--ink)]" : "hover:bg-[color:rgba(243,237,225,0.06)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs tracking-widest">{team.mainAbbrev}</span>
        <span
          className={`font-mono text-[10px] ${
            short || over ? "text-[var(--mustard)]" : "opacity-50"
          }`}
        >
          {team.players.length}/7
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] opacity-60 truncate">
        {team.glRegion.replace(/^\(\w+\)\s*/, "")}
      </div>
      <div className="mt-2 flex items-center gap-1">
        {Array.from({ length: 7 }).map((_, i) => {
          const p = team.players[i];
          return (
            <span
              key={i}
              className={`inline-block w-1.5 h-3 ${
                !p
                  ? "bg-[color:rgba(243,237,225,0.15)]"
                  : p.assigned
                    ? "bg-[var(--leather)]"
                    : "bg-[color:rgba(243,237,225,0.55)]"
              }`}
            />
          );
        })}
      </div>
      {team.forced.length > 0 && (
        <div className="mt-1.5 font-mono text-[9px] tracking-widest text-[var(--mustard)]">
          {team.forced.length} FORCED
        </div>
      )}
    </button>
  );
}

export function GLeaguePanel({ season }: { season: Season }) {
  const [board, setBoard] = useState<GlBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState(season.glLeagueLink ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [staged, setStaged] = useState<GlProposal[]>([]);
  const [preview, setPreview] = useState<GlStagedMove[]>([]);
  const [committing, setCommitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<GlRequestRow[]>([]);
  const [acting, setActing] = useState(false);

  const team = useMemo(
    () => board?.teams.find((t) => t.mainAbbrev === selected) ?? null,
    [board, selected],
  );

  async function loadBoard() {
    setLoading(true);
    setError(null);
    try {
      const [b, reqs] = await Promise.all([
        gleague.board(season.id),
        gleague.pending(season.id).catch(() => [] as GlRequestRow[]),
      ]);
      setBoard(b);
      setPending(reqs);
      setSelected((cur) => cur ?? b.teams[0]?.mainAbbrev ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the G-League board");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (season.glLeagueLink) void loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.id, season.glLeagueLink]);

  // Re-validate whenever the staged batch changes, so blocks surface immediately.
  useEffect(() => {
    if (!staged.length) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await gleague.validate(season.id, staged);
        if (!cancelled) setPreview(res.staged);
      } catch {
        /* the commit button reports the real failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staged, season.id]);

  async function handleLink() {
    setLoading(true);
    setError(null);
    try {
      await gleague.link(season.id, linkInput.trim());
      await loadBoard();
      setNote("G-League export filed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file that link");
      setLoading(false);
    }
  }

  function stage(move: GlProposal) {
    setStaged((cur) => [...cur, move]);
  }

  function unstage(i: number) {
    setStaged((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      const res = await gleague.commit(season.id, staged);
      setStaged([]);
      setNote(`${res.committed.length} move(s) committed.`);
      await loadBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  async function actOnRequests(ids: number[], approve: boolean) {
    setActing(true);
    setError(null);
    try {
      if (approve) {
        const res = await gleague.approve(season.id, ids);
        setNote(`${res.committed.length} request(s) approved.`);
      } else {
        const res = await gleague.decline(season.id, ids);
        setNote(`${res.declined.length} request(s) declined.`);
      }
      await loadBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not act on those requests");
    } finally {
      setActing(false);
    }
  }

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      await gleague.refresh(season.id);
      await loadBoard();
      setNote("Board rebuilt from the exports.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Refresh failed");
      setLoading(false);
    }
  }

  const blocked = preview.some((s) => s.blocked);
  const alreadyStaged = new Set(
    staged.map((m) => (m.direction === "ASSIGN" ? `a${m.pid}` : `c${m.glPid}`)),
  );

  /* ---- no export filed yet ---------------------------------------------- */
  if (!season.glLeagueLink && !board) {
    return (
      <section className="rise">
        <div className="eyebrow opacity-60">G-LEAGUE / SETUP</div>
        <h2 className="display text-4xl mt-2">LINK THE AFFILIATE EXPORT</h2>
        <p className="mt-3 max-w-2xl text-sm opacity-70 leading-relaxed">
          Season {season.seasonNumber} already has its main-league file. Paste the Dropbox link to
          the matching <b>G-League</b> BBGM export — the post-draft main file and the G-League file
          are the pair players move between.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 max-w-3xl">
          <input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://www.dropbox.com/scl/fi/.../BBGM_BGMDL_GL_....json"
            className="flex-1 bg-transparent border rule px-3 py-2 font-mono text-xs outline-none focus:border-[var(--leather)]"
          />
          <button
            onClick={handleLink}
            disabled={!linkInput.trim() || loading}
            className="border rule px-4 py-2 font-mono text-xs tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40"
          >
            {loading ? <span className="spinner" /> : "PULL · FILE"}
          </button>
        </div>
        {error && (
          <div className="mt-4 font-mono text-xs text-[var(--leather)]">{error}</div>
        )}
      </section>
    );
  }

  return (
    <section className="rise space-y-8">
      <div>
        <div className="eyebrow opacity-60">G-LEAGUE / ASSIGNMENTS</div>
        <div className="flex flex-wrap items-baseline justify-between gap-4 mt-2">
          <h2 className="display text-4xl">AFFILIATE DESK</h2>
          {board && (
            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] tracking-widest opacity-60">
                MAIN {board.mainSeason} · GL {board.glSeason} · HARD CAP ${board.hardCapM}M
              </div>
              <button
                onClick={() => void handleRefresh()}
                disabled={loading}
                title="The board is cached; this refetches both exports."
                className="border rule px-2 py-1 font-mono text-[9px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40"
              >
                ⟳ REFRESH
              </button>
            </div>
          )}
        </div>
        <div className="seam mt-4" />
      </div>

      {note && <div className="font-mono text-xs text-[var(--mustard)]">{note}</div>}
      {error && <div className="font-mono text-xs text-[var(--leather)]">{error}</div>}

      {board && (board.unmatchedGl.length > 0 || board.unmatchedMain.length > 0) && (
        <div className="border rule border-[var(--leather)] p-3 font-mono text-[10px] tracking-wide text-[var(--leather)]">
          AFFILIATE MAP INCOMPLETE — unmatched G-League: [{board.unmatchedGl.join(", ") || "none"}] ·
          unmatched main: [{board.unmatchedMain.join(", ") || "none"}]. Check the two exports are
          from the same league era before committing anything.
        </div>
      )}

      {/* GM request queue ---------------------------------------------- */}
      {pending.length > 0 && (
        <div className="border rule border-[var(--mustard)] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="eyebrow opacity-70">GM REQUESTS · {pending.length} WAITING</div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void actOnRequests(pending.map((r) => r.id), true)}
                disabled={acting}
                className="border rule px-3 py-1 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40"
              >
                APPROVE ALL
              </button>
              <button
                onClick={() => void actOnRequests(pending.map((r) => r.id), false)}
                disabled={acting}
                className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100 hover:text-[var(--leather)] disabled:opacity-30"
              >
                DECLINE ALL
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1.5"
              >
                <span className="font-mono text-[10px] tracking-widest w-14 shrink-0 opacity-70">
                  {r.direction === "ASSIGN" ? "DOWN" : `UP ${r.newContractYears ?? ""}Y`}
                </span>
                <span className="flex-1 font-mono text-xs truncate">
                  {r.playerName}
                  <span className="opacity-50">
                    {" "}
                    · {r.mainTeamAbbrev}
                  </span>
                </span>
                <span className="font-mono text-[10px] opacity-60 tabular-nums">
                  {r.ovrAtMove} · {r.ageAtMove}yo
                </span>
                <span className="font-mono text-[10px] opacity-50 truncate max-w-[9rem]">
                  {r.submittedByGm ?? "unknown GM"}
                </span>
                <button
                  onClick={() => void actOnRequests([r.id], true)}
                  disabled={acting}
                  className="border rule px-2 py-0.5 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-30"
                >
                  APPROVE
                </button>
                <button
                  onClick={() => void actOnRequests([r.id], false)}
                  disabled={acting}
                  className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)] disabled:opacity-30"
                >
                  DECLINE
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && !board && (
        <div className="py-16 font-mono text-xs tracking-widest opacity-60">
          PULLING BOTH EXPORTS<span className="caret ml-1" />
        </div>
      )}

      {board && (
        <>
          {/* affiliate grid ------------------------------------------------ */}
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="eyebrow opacity-60">AFFILIATES</div>
            <Legend />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {board.teams.map((t) => (
              <TeamTile
                key={t.glTid}
                team={t}
                active={t.mainAbbrev === selected}
                onSelect={() => setSelected(t.mainAbbrev)}
              />
            ))}
          </div>

          {team && (
            <div className="grid lg:grid-cols-2 gap-8">
              {/* affiliate roster ----------------------------------------- */}
              <div className="border rule p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="eyebrow opacity-60">AFFILIATE</div>
                    <div className="font-mono text-sm mt-1">{team.glName}</div>
                  </div>
                  <div className="font-mono text-[10px] tracking-widest opacity-60 text-right">
                    {team.assignedCount} ASSIGNED · {team.originalCount} ORIGINAL
                    <br />
                    GL PAYROLL {money(team.payrollM)}
                  </div>
                </div>
                <Violations items={team.violations} />

                <div className="mt-4 space-y-1">
                  {team.players.length === 0 && (
                    <div className="font-mono text-xs opacity-50">Empty roster.</div>
                  )}
                  {team.players.map((p) => {
                    const forced = team.forced.find((f) => f.pid === p.pid);
                    const key = `c${p.pid}`;
                    return (
                      <div
                        key={p.pid}
                        className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1.5"
                      >
                        <span
                          className={`inline-block w-1.5 h-4 shrink-0 ${
                            p.assigned ? "bg-[var(--leather)]" : "bg-[color:rgba(243,237,225,0.45)]"
                          }`}
                          title={p.assigned ? "Assigned from the main league" : "Original G-Leaguer"}
                        />
                        <span className="flex-1 font-mono text-xs truncate">{p.name}</span>
                        <span className="font-mono text-[10px] opacity-60 tabular-nums">
                          {p.ovr} · {p.age}yo · {money(p.salaryM)}
                        </span>
                        {forced && (
                          <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                            FORCED
                          </span>
                        )}
                        <select
                          defaultValue=""
                          disabled={alreadyStaged.has(key)}
                          onChange={(e) => {
                            const years = Number(e.target.value);
                            if (!years) return;
                            stage({
                              direction: "CALLUP",
                              glPid: p.pid,
                              mainAbbrev: team.mainAbbrev,
                              years,
                            });
                            e.target.value = "";
                          }}
                          className="bg-transparent border rule font-mono text-[10px] px-1 py-0.5 outline-none disabled:opacity-30"
                        >
                          <option value="">CALL UP</option>
                          {CALLUP_YEARS.map((y) => (
                            <option key={y} value={y} className="bg-[var(--ink)]">
                              {y}Y
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* assignable main-league players --------------------------- */}
              <div className="border rule p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="eyebrow opacity-60">SEND DOWN FROM {team.mainAbbrev}</div>
                    <div className="font-mono text-sm mt-1">{team.mainName}</div>
                  </div>
                  <div className="font-mono text-[10px] tracking-widest opacity-60 text-right">
                    PAYROLL {money(team.mainPayrollM)}
                    <br />
                    <span
                      className={team.hardCapRoomM < 0 ? "text-[var(--leather)]" : ""}
                    >
                      CAP ROOM {money(team.hardCapRoomM)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 space-y-1 max-h-[28rem] overflow-y-auto">
                  {team.candidates.map((c) => {
                    const key = `a${c.pid}`;
                    return (
                      <div
                        key={c.pid}
                        className={`border-b rule border-[color:var(--rule-soft)] py-1.5 ${
                          c.eligible ? "" : "opacity-45"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex-1 font-mono text-xs truncate">
                            {c.name}
                            {c.onRookieDeal && (
                              <span className="ml-2 font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                                ROOKIE
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[10px] opacity-60 tabular-nums">
                            {c.ovr} · {c.age}yo · {money(c.salaryM)}
                          </span>
                          <button
                            disabled={!c.eligible || alreadyStaged.has(key)}
                            onClick={() =>
                              stage({
                                direction: "ASSIGN",
                                pid: c.pid,
                                glAbbrev: team.glAbbrev,
                              })
                            }
                            className="border rule px-2 py-0.5 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-inherit"
                          >
                            {alreadyStaged.has(key) ? "STAGED" : "ASSIGN"}
                          </button>
                        </div>
                        <Violations items={c.violations} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* staged batch --------------------------------------------------- */}
          {staged.length > 0 && (
            <div className="border rule border-[var(--mustard)] p-4">
              <div className="eyebrow opacity-70">STAGED · {staged.length} MOVE(S)</div>
              <div className="mt-3 space-y-1.5">
                {staged.map((m, i) => {
                  const p = preview[i];
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 border-b rule border-[color:var(--rule-soft)] pb-1.5"
                    >
                      <span className="font-mono text-[10px] tracking-widest w-16 shrink-0 opacity-70">
                        {m.direction === "ASSIGN" ? "DOWN" : "UP"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs">
                          {p?.playerName ?? (m.direction === "ASSIGN" ? `pid ${m.pid}` : `pid ${m.glPid}`)}
                          <span className="opacity-50">
                            {" "}
                            → {m.direction === "ASSIGN" ? m.glAbbrev : m.mainAbbrev}
                          </span>
                        </div>
                        {p?.contract && (
                          <div className="font-mono text-[10px] opacity-70 mt-0.5">
                            {money(p.contract.amountM)} through {p.contract.exp} ·{" "}
                            {p.contract.source}
                            {p.contract.rfaRightsLost && (
                              <span className="text-[var(--leather)]"> · RFA RIGHTS LOST</span>
                            )}
                          </div>
                        )}
                        {p && <Violations items={p.violations} />}
                      </div>
                      <button
                        onClick={() => unstage(i)}
                        className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)]"
                      >
                        DROP
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleCommit}
                  disabled={blocked || committing}
                  className="border rule px-4 py-2 font-mono text-xs tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
                >
                  {committing ? <span className="spinner" /> : "COMMIT BATCH"}
                </button>
                <button
                  onClick={() => setStaged([])}
                  className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
                >
                  CLEAR
                </button>
                {blocked && (
                  <span className="font-mono text-[10px] tracking-widest text-[var(--leather)]">
                    A HARD RULE BLOCKS THIS BATCH
                  </span>
                )}
              </div>
            </div>
          )}

          {/* exports + ledger ---------------------------------------------- */}
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="border rule p-4">
              <div className="eyebrow opacity-60">EXPORTS</div>
              <p className="mt-2 text-xs opacity-70 leading-relaxed">
                Both files are rebuilt from the ledger on download, so they always agree about where
                every player is.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={gleague.exportUrl(season.id, "main")}
                  className="border rule px-3 py-2 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors"
                >
                  ↓ MAIN EXPORT
                </a>
                <a
                  href={gleague.exportUrl(season.id, "gleague")}
                  className="border rule px-3 py-2 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors"
                >
                  ↓ G-LEAGUE EXPORT
                </a>
              </div>
            </div>

            <div className="border rule p-4">
              <div className="eyebrow opacity-60">LEDGER · {board.ledger.length}</div>
              <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
                {board.ledger.length === 0 && (
                  <div className="font-mono text-xs opacity-50">No moves committed yet.</div>
                )}
                {board.ledger.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1"
                  >
                    <span className="font-mono text-[10px] tracking-widest w-12 shrink-0 opacity-70">
                      {row.direction === "ASSIGN" ? "DOWN" : "UP"}
                    </span>
                    <span className="flex-1 font-mono text-xs truncate">{row.playerName}</span>
                    <span className="font-mono text-[10px] opacity-60">
                      {row.direction === "ASSIGN"
                        ? row.glTeamAbbrev
                        : `${row.mainTeamAbbrev} · ${row.contractSource ?? ""}`}
                    </span>
                    {row.rfaRightsLost && (
                      <span className="font-mono text-[9px] tracking-widest text-[var(--leather)]">
                        RFA LOST
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Console entry point: resolves the current season, then hands it to the panel.
 * G-League moves always apply to the season that is marked current.
 */
export function GLeagueSection() {
  const [season, setSeason] = useState<Season | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");

  useEffect(() => {
    void (async () => {
      try {
        const { seasons } = await import("@/lib/api");
        const all = await seasons.list();
        const current = all.find((s) => s.isCurrentSzn) ?? all[0] ?? null;
        setSeason(current);
        setState(current ? "ready" : "none");
      } catch {
        setState("none");
      }
    })();
  }, []);

  if (state === "loading") {
    return (
      <div className="py-8 font-mono text-xs tracking-widest opacity-60">
        LOADING SEASON<span className="caret ml-1" />
      </div>
    );
  }
  if (state === "none" || !season) {
    return (
      <section>
        <div className="eyebrow opacity-60">G-LEAGUE</div>
        <p className="mt-2 font-mono text-xs opacity-60">
          File a season above before linking its G-League export.
        </p>
      </section>
    );
  }
  return <GLeaguePanel season={season} />;
}
