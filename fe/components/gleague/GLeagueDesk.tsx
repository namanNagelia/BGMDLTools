"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  gleaguePublic,
  type GlBoard,
  type GlBoardTeam,
  type GlProposal,
  type GlRequestRow,
  type GlStagedMove,
  type GlViolation,
} from "@/lib/api";

const money = (m: number) => `$${m.toFixed(2)}M`;
const CALLUP_YEARS = [2, 3, 4, 5] as const;

/**
 * Roster-shape rules describe the affiliate, not any one move, so the server
 * attaches them to every move in the batch — dropping any of them could fix it.
 * Shown once for the batch rather than repeated on each row.
 */
const ROSTER_CODES = new Set([
  "BELOW_MIN_ROSTER",
  "ABOVE_MAX_ROSTER",
  "HOARD_LIMIT",
  "TOO_MANY_ASSIGNED",
]);
const isRosterRule = (v: GlViolation) => ROSTER_CODES.has(v.code);

function Rules({ items }: { items: GlViolation[] }) {
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
 * Key for the roster pips. The assigned/original split is the one thing on this
 * page you cannot infer from the numbers, and it drives the rule-7 limits —
 * five assigned max, the last two slots reserved for original G-Leaguers.
 */
function Legend() {
  const items = [
    {
      className: "bg-[var(--leather)]",
      label: "ASSIGNED",
      hint: "sent down from the main league",
    },
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
      <span className="flex items-center gap-2" title="your club">
        <span className="inline-block w-3 h-3 shrink-0 border border-[var(--leather)]" />
        <span className="font-mono text-[10px] tracking-widest opacity-70">YOUR CLUB</span>
      </span>
    </div>
  );
}

/** Roster-slot pips: filled orange for assigned, pale for original G-Leaguers. */
function Pips({ team }: { team: GlBoardTeam }) {
  return (
    <div className="flex items-center gap-1">
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
  );
}

export function GLeagueDesk() {
  const [board, setBoard] = useState<GlBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [myTeam, setMyTeam] = useState<string | null>(null);
  const [gm, setGm] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);

  const [staged, setStaged] = useState<GlProposal[]>([]);
  const [preview, setPreview] = useState<GlStagedMove[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [mine, setMine] = useState<GlRequestRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const b = await gleaguePublic.board();
        setBoard(b);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Could not load the G-League board",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Remember the GM's team locally so they don't re-pick on every visit.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gl-team");
      const savedGm = localStorage.getItem("gl-gm");
      if (saved) {
        setMyTeam(saved);
        setViewing(saved);
      }
      if (savedGm) setGm(savedGm);
    } catch {
      /* private mode — the picker just shows every time */
    }
  }, []);

  useEffect(() => {
    if (!myTeam) return;
    void gleaguePublic.myRequests(myTeam).then(setMine).catch(() => undefined);
  }, [myTeam, note]);

  // Price the batch as it is built, so the GM sees real contract figures
  // before they send anything.
  useEffect(() => {
    if (!staged.length) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await gleaguePublic.preview(staged);
        if (!cancelled) setPreview(res.staged);
      } catch {
        /* the send button surfaces the real failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staged]);

  const team = useMemo(
    () => board?.teams.find((t) => t.mainAbbrev === viewing) ?? null,
    [board, viewing],
  );
  const isMine = team?.mainAbbrev === myTeam;

  /**
   * Players already sitting in the mod queue, keyed by pid on the side they
   * appear on, carrying which action is pending so the badge can name it.
   */
  const pendingPids = useMemo(() => {
    const down = new Map<number, GlRequestRow>();
    const gl = new Map<number, GlRequestRow>();
    for (const r of mine) {
      if (r.direction === "ASSIGN") {
        if (r.mainPid != null) down.set(r.mainPid, r);
      } else if (r.glPid != null) {
        gl.set(r.glPid, r);
      }
    }
    return { down, gl };
  }, [mine]);

  const blocked = preview.some((s) => s.blocked);

  /** Roster-shape warnings for the batch, deduped by message. */
  const rosterRules = useMemo(() => {
    const seen = new Map<string, GlViolation>();
    for (const s of preview) {
      for (const v of s.violations) if (isRosterRule(v)) seen.set(v.message, v);
    }
    return [...seen.values()];
  }, [preview]);

  /**
   * Staged moves indexed for in-place display, so a GM sees what the rosters
   * will look like before they send anything to the mods.
   */
  const pendingMove = useMemo(() => {
    const assign = new Map<number, GlStagedMove | undefined>();
    const callUp = new Map<number, GlStagedMove | undefined>();
    const release = new Map<number, GlStagedMove | undefined>();
    staged.forEach((m, i) => {
      if (m.direction === "ASSIGN") assign.set(m.pid, preview[i]);
      else if (m.direction === "CALLUP") callUp.set(m.glPid, preview[i]);
      else release.set(m.glPid, preview[i]);
    });
    return { assign, callUp, release };
  }, [staged, preview]);

  function chooseTeam(abbrev: string) {
    setMyTeam(abbrev);
    setViewing(abbrev);
    setStaged([]);
    try {
      localStorage.setItem("gl-team", abbrev);
    } catch {
      /* ignore */
    }
  }

  function saveGm(name: string) {
    setGm(name);
    try {
      localStorage.setItem("gl-gm", name);
    } catch {
      /* ignore */
    }
  }

  async function handleSubmit() {
    if (!myTeam || !gm.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await gleaguePublic.submit(myTeam, gm.trim(), staged);
      setStaged([]);
      setNote(`${res.submitted.length} request(s) sent to the mods.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw(id: number) {
    if (!myTeam) return;
    try {
      await gleaguePublic.withdraw(id, myTeam);
      setNote(`Request withdrawn.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not withdraw that");
    }
  }

  const stagedKeys = new Set(
    staged.map((m) =>
      m.direction === "ASSIGN"
        ? `a${m.pid}`
        : m.direction === "RELEASE"
          ? `r${m.glPid}`
          : `c${m.glPid}`,
    ),
  );

  if (loading) {
    return (
      <div className="py-24 font-mono text-xs tracking-widest opacity-60">
        LOADING AFFILIATES<span className="caret ml-1" />
      </div>
    );
  }

  if (error && !board) {
    return <div className="py-16 font-mono text-xs text-[var(--leather)]">{error}</div>;
  }

  if (!board) return null;

  /* ---- team picker ------------------------------------------------------- */
  if (!myTeam) {
    return (
      <section className="rise">
        <div className="eyebrow opacity-60">STEP 1</div>
        <h2 className="display text-4xl mt-2">PICK YOUR TEAM</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2 mt-8">
          {board.teams.map((t) => (
            <button
              key={t.mainTid}
              onClick={() => chooseTeam(t.mainAbbrev)}
              className="border rule p-3 text-left hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors"
            >
              <div className="font-mono text-xs tracking-widest">{t.mainAbbrev}</div>
              <div className="mt-1 font-mono text-[10px] opacity-60 truncate">{t.mainName}</div>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rise space-y-8">
      {/* header ----------------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <div className="eyebrow opacity-60">
              G-LEAGUE {board.glSeason} · YOU ARE {myTeam}
            </div>
            <h2 className="display text-4xl mt-2">AFFILIATE DESK</h2>
          </div>
          <button
            onClick={() => {
              setMyTeam(null);
              setStaged([]);
            }}
            className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
          >
            CHANGE TEAM
          </button>
        </div>
        <div className="seam mt-4" />
      </div>

      {note && <div className="font-mono text-xs text-[var(--mustard)]">{note}</div>}
      {error && <div className="font-mono text-xs text-[var(--leather)]">{error}</div>}

      <p className="max-w-3xl text-sm opacity-70 leading-relaxed">
        Everything you send here is a <b>request</b>. A mod reviews it and applies it when the
        preseason exports go out — nothing changes in the league until then.
      </p>

      {/* pending requests -------------------------------------------------- */}
      {mine.length > 0 && (
        <div className="border rule border-[var(--mustard)] p-4">
          <div className="eyebrow opacity-70">YOUR PENDING REQUESTS · {mine.length}</div>
          <div className="mt-3 space-y-1">
            {mine.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1.5"
              >
                <span
                  className={`font-mono text-[10px] tracking-widest w-20 shrink-0 ${
                    r.direction === "RELEASE" ? "text-[var(--leather)]" : "opacity-70"
                  }`}
                >
                  {r.direction === "ASSIGN"
                    ? "SEND DOWN"
                    : r.direction === "RELEASE"
                      ? "CUT"
                      : `CALL UP ${r.newContractYears ?? ""}Y`}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">{r.playerName}</div>
                  {r.newContractAmount && (
                    <div className="font-mono text-[10px] text-[var(--mustard)]">
                      ${Number(r.newContractAmount).toFixed(2)}M through {r.newContractExp}
                      {r.contractSource && <span className="opacity-60"> · {r.contractSource}</span>}
                    </div>
                  )}
                </div>
                <span className="font-mono text-[10px] opacity-60">
                  {r.ovrAtMove} OVR · {r.ageAtMove}yo
                </span>
                <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                  AWAITING MOD
                </span>
                <button
                  onClick={() => void handleWithdraw(r.id)}
                  className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)]"
                >
                  WITHDRAW
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* league grid ------------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="eyebrow opacity-70 hover:opacity-100 flex items-center gap-2 transition-opacity"
          >
            <span className="inline-block w-3 text-[var(--leather)]">{showAll ? "−" : "+"}</span>
            EVERY AFFILIATE
            <span className="opacity-50">({board.teams.length})</span>
          </button>
          {showAll && <Legend />}
        </div>

        {showAll && (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2 mt-3">
            {board.teams.map((t) => {
              const own = t.mainAbbrev === myTeam;
              const active = t.mainAbbrev === viewing;
              return (
                <button
                  key={t.glTid}
                  onClick={() => setViewing(t.mainAbbrev)}
                  className={`border rule p-2.5 text-left transition-colors ${
                    active
                      ? "bg-[var(--paper)] text-[var(--ink)]"
                      : "hover:bg-[color:rgba(243,237,225,0.06)]"
                  } ${own && !active ? "border-[var(--leather)]" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="font-mono text-[11px] tracking-widest">{t.mainAbbrev}</span>
                    <span
                      className={`font-mono text-[10px] ${
                        t.players.length < 5 || t.players.length > 7
                          ? "text-[var(--mustard)]"
                          : "opacity-50"
                      }`}
                    >
                      {t.players.length}/7
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Pips team={t} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!showAll && viewing !== myTeam && (
          <div className="mt-2 font-mono text-[10px] tracking-widest opacity-60">
            VIEWING {viewing} ·{" "}
            <button
              onClick={() => setViewing(myTeam)}
              className="underline decoration-[var(--leather)] underline-offset-2 hover:text-[var(--leather)]"
            >
              BACK TO {myTeam}
            </button>
          </div>
        )}
      </div>

      {team && (
        <div className="grid lg:grid-cols-2 gap-8">
          {/* affiliate roster --------------------------------------------- */}
          <div className="border rule p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="eyebrow opacity-60">AFFILIATE</div>
                <div className="font-mono text-sm mt-1">{team.glName}</div>
              </div>
              <div className="font-mono text-[10px] tracking-widest opacity-60 text-right">
                {team.assignedCount} ASSIGNED · {team.originalCount} ORIGINAL
              </div>
            </div>
            <Rules items={team.violations} />

            <div className="mt-4 space-y-1">
              {team.players.length === 0 && (
                <div className="font-mono text-xs opacity-50">Empty roster.</div>
              )}
              {team.players.map((p) => {
                const leavingUp = pendingMove.callUp.has(p.pid);
                const cut = pendingMove.release.has(p.pid);
                return (
                <div
                  key={p.pid}
                  className={`flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1.5 ${
                    cut ? "opacity-50" : leavingUp ? "opacity-60" : ""
                  }`}
                >
                  <span
                    className={`inline-block w-1.5 h-4 shrink-0 ${
                      p.assigned ? "bg-[var(--leather)]" : "bg-[color:rgba(243,237,225,0.45)]"
                    }`}
                    title={p.assigned ? "Assigned from the main league" : "Original G-Leaguer"}
                  />
                  <span
                    className={`flex-1 font-mono text-xs truncate ${
                      cut ? "line-through decoration-[var(--leather)] decoration-2" : ""
                    }`}
                  >
                    {p.name}
                  </span>
                  {cut && (
                    <span className="font-mono text-[9px] tracking-widest text-[var(--leather)]">
                      CUT
                    </span>
                  )}
                  {leavingUp && (
                    <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                      ↑ CALLED UP
                    </span>
                  )}
                  <span className="font-mono text-[10px] opacity-60 tabular-nums">
                    {p.ovr} · {p.age}yo · {money(p.salaryM)}
                  </span>
                  {isMine && pendingPids.gl.has(p.pid) && (
                    <span
                      className={`font-mono text-[9px] tracking-widest ${
                        pendingPids.gl.get(p.pid)!.direction === "RELEASE"
                          ? "text-[var(--leather)]"
                          : "text-[var(--mustard)]"
                      }`}
                      title="waiting on a mod"
                    >
                      {pendingPids.gl.get(p.pid)!.direction === "RELEASE"
                        ? "✕ CUT PENDING"
                        : `↑ CALL-UP PENDING${
                            pendingPids.gl.get(p.pid)!.newContractYears
                              ? ` ${pendingPids.gl.get(p.pid)!.newContractYears}Y`
                              : ""
                          }`}
                    </span>
                  )}
                  {isMine && !pendingPids.gl.has(p.pid) && (
                    <button
                      disabled={stagedKeys.has(`r${p.pid}`)}
                      onClick={() =>
                        setStaged((cur) => [
                          ...cur,
                          { direction: "RELEASE", glPid: p.pid, mainAbbrev: team.mainAbbrev },
                        ])
                      }
                      title="cut him to G-League free agency"
                      className="border rule px-2 py-0.5 font-mono text-[10px] tracking-widest hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] transition-colors disabled:opacity-30"
                    >
                      {stagedKeys.has(`r${p.pid}`) ? "CUT ✓" : "CUT"}
                    </button>
                  )}
                  {isMine && !pendingPids.gl.has(p.pid) && (
                    <select
                      defaultValue=""
                      disabled={stagedKeys.has(`c${p.pid}`)}
                      onChange={(e) => {
                        const years = Number(e.target.value);
                        if (!years) return;
                        setStaged((cur) => [
                          ...cur,
                          {
                            direction: "CALLUP",
                            glPid: p.pid,
                            mainAbbrev: team.mainAbbrev,
                            years,
                          },
                        ]);
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
                  )}
                </div>
                );
              })}

              {/* players this batch would send down */}
              {isMine &&
                [...pendingMove.assign.entries()].map(([pid, pv]) => {
                  const c = team.candidates.find((x) => x.pid === pid);
                  if (!c) return null;
                  return (
                    <div
                      key={`in-${pid}`}
                      className="flex items-center gap-3 border-b border-dashed rule border-[color:var(--rule-soft)] py-1.5"
                    >
                      <span className="inline-block w-1.5 h-4 shrink-0 bg-[var(--leather)] opacity-50" />
                      <span className="flex-1 font-mono text-xs truncate text-[var(--mustard)]">
                        {pv?.playerName ?? c.name}
                      </span>
                      <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                        ↓ PENDING
                      </span>
                      <span className="font-mono text-[10px] opacity-60 tabular-nums">
                        {c.ovr} · {c.age}yo
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* main roster --------------------------------------------------- */}
          <div className="border rule p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="eyebrow opacity-60">
                  {isMine ? `SEND DOWN FROM ${team.mainAbbrev}` : `${team.mainAbbrev} ROSTER`}
                </div>
                <div className="font-mono text-sm mt-1">{team.mainName}</div>
              </div>
              {isMine && (
                <div className="font-mono text-[10px] tracking-widest opacity-60 text-right">
                  CAP ROOM {money(team.hardCapRoomM)}
                </div>
              )}
            </div>

            {!isMine && (
              <div className="mt-3 font-mono text-[10px] tracking-widest opacity-50">
                VIEWING ONLY — SWITCH TO {myTeam} TO MAKE MOVES
              </div>
            )}

            <div className="mt-4 space-y-1 max-h-[28rem] overflow-y-auto">
              {/* players this batch would call up, with what they will be paid */}
              {isMine &&
                [...pendingMove.callUp.entries()].map(([glPid, pv]) => {
                  const p = team.players.find((x) => x.pid === glPid);
                  return (
                    <div
                      key={`up-${glPid}`}
                      className="border-b border-dashed rule border-[color:var(--rule-soft)] py-1.5"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex-1 font-mono text-xs truncate text-[var(--mustard)]">
                          {pv?.playerName ?? p?.name ?? `pid ${glPid}`}
                        </span>
                        <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                          ↑ PENDING
                        </span>
                        <span className="font-mono text-[10px] opacity-60 tabular-nums">
                          {pv?.ovr ?? p?.ovr} · {pv?.age ?? p?.age}yo
                        </span>
                      </div>
                      {pv?.contract && (
                        <div className="font-mono text-[10px] mt-0.5 text-[var(--mustard)]">
                          {money(pv.contract.amountM)} through {pv.contract.exp}
                          <span className="opacity-60"> · {pv.contract.source}</span>
                          {pv.contract.rfaRightsLost && (
                            <span className="text-[var(--leather)]"> · RFA RIGHTS LOST</span>
                          )}
                        </div>
                      )}
                      {pv && <Rules items={pv.violations.filter((v) => !isRosterRule(v))} />}
                    </div>
                  );
                })}

              {team.candidates.map((c) => {
                const goingDown = pendingMove.assign.has(c.pid);
                return (
                <div
                  key={c.pid}
                  className={`border-b rule border-[color:var(--rule-soft)] py-1.5 ${
                    goingDown ? "opacity-55" : c.eligible ? "" : "opacity-45"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex-1 font-mono text-xs truncate">
                      {c.name}
                      {goingDown && (
                        <span className="ml-2 font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                          ↓ SENT DOWN
                        </span>
                      )}
                      {c.onRookieDeal && (
                        <span className="ml-2 font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                          ROOKIE
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10px] opacity-60 tabular-nums">
                      {c.ovr} · {c.age}yo · {money(c.salaryM)}
                    </span>
                    {isMine && pendingPids.down.has(c.pid) && (
                      <span
                        className="font-mono text-[9px] tracking-widest text-[var(--mustard)]"
                        title="waiting on a mod"
                      >
                        ↓ SEND-DOWN PENDING
                      </span>
                    )}
                    {isMine && !pendingPids.down.has(c.pid) && (
                      <button
                        disabled={!c.eligible || stagedKeys.has(`a${c.pid}`)}
                        onClick={() =>
                          setStaged((cur) => [
                            ...cur,
                            { direction: "ASSIGN", pid: c.pid, glAbbrev: team.glAbbrev },
                          ])
                        }
                        className="border rule px-2 py-0.5 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-inherit"
                      >
                        {stagedKeys.has(`a${c.pid}`) ? "STAGED" : "SEND DOWN"}
                      </button>
                    )}
                  </div>
                  {isMine && <Rules items={c.violations.filter((v) => !isRosterRule(v))} />}
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* staged batch ------------------------------------------------------ */}
      {staged.length > 0 && (
        <div className="border rule border-[var(--leather)] p-4">
          <div className="eyebrow opacity-70">READY TO SEND · {staged.length}</div>
          <div className="mt-3 space-y-1.5">
            {staged.map((m, i) => {
              const p = preview[i];
              const label =
                m.direction === "ASSIGN" ? "DOWN" : m.direction === "RELEASE" ? "CUT" : `UP ${m.years}Y`;
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 border-b rule border-[color:var(--rule-soft)] pb-1.5"
                >
                  <span
                    className={`font-mono text-[10px] tracking-widest w-16 shrink-0 ${
                      m.direction === "RELEASE" ? "text-[var(--leather)]" : "opacity-70"
                    }`}
                  >
                    {label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs">
                      {p?.playerName ??
                        (m.direction === "ASSIGN" ? `pid ${m.pid}` : `pid ${m.glPid}`)}
                      {p && (
                        <span className="opacity-50">
                          {" "}
                          · {p.ovr} OVR · {p.age}yo
                        </span>
                      )}
                    </div>

                    {/* what the call-up actually costs */}
                    {p?.contract && (
                      <div className="font-mono text-[10px] mt-0.5">
                        <span className="text-[var(--mustard)]">
                          {money(p.contract.amountM)} through {p.contract.exp}
                        </span>
                        <span className="opacity-50"> · {p.contract.source}</span>
                        {p.contract.rfaRightsLost && (
                          <span className="text-[var(--leather)]"> · RFA RIGHTS LOST</span>
                        )}
                      </div>
                    )}

                    {m.direction === "RELEASE" && p && (
                      <div className="font-mono text-[10px] opacity-60 mt-0.5">
                        {p.wasAssigned
                          ? "cuts him from the organisation — leaves your affiliate and your main roster"
                          : "returns him to G-League free agency"}
                      </div>
                    )}

                    {p && <Rules items={p.violations.filter((v) => !isRosterRule(v))} />}
                  </div>
                  <button
                    onClick={() => setStaged((cur) => cur.filter((_, idx) => idx !== i))}
                    className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)]"
                  >
                    DROP
                  </button>
                </div>
              );
            })}
          </div>

          {rosterRules.length > 0 && (
            <div className="mt-3 border rule border-[color:var(--rule-soft)] p-2.5">
              <div className="font-mono text-[9px] tracking-widest opacity-50 mb-1">
                AFFILIATE ROSTER AFTER THIS BATCH
              </div>
              <Rules items={rosterRules} />
            </div>
          )}

          {/* sign-off ----------------------------------------------------- */}
          <div className="mt-5 pt-4 border-t rule border-[color:var(--rule-soft)]">
            <div className="eyebrow opacity-60 mb-2">SIGN OFF</div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={gm}
                onChange={(e) => saveGm(e.target.value)}
                placeholder="YOUR GM NAME"
                className="bg-transparent border rule px-3 py-2 font-mono text-[11px] tracking-widest outline-none focus:border-[var(--leather)] w-52"
              />
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting || !gm.trim() || blocked}
                className="border rule px-4 py-2 font-mono text-xs tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
              >
                {submitting ? <span className="spinner" /> : "SEND TO MODS"}
              </button>
              <button
                onClick={() => setStaged([])}
                className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
              >
                CLEAR
              </button>
              {blocked ? (
                <span className="font-mono text-[10px] tracking-widest text-[var(--leather)]">
                  A HARD RULE BLOCKS THIS BATCH
                </span>
              ) : (
                !gm.trim() && (
                  <span className="font-mono text-[10px] tracking-widest text-[var(--mustard)]">
                    ADD YOUR GM NAME TO SEND
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
