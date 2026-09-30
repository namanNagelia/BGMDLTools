"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  gleaguePublic,
  type GlBoard,
  type GlBoardTeam,
  type GlProposal,
  type GlRequestRow,
  type GlViolation,
} from "@/lib/api";

const money = (m: number) => `$${m.toFixed(2)}M`;
const CALLUP_YEARS = [2, 3, 4, 5] as const;

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

  const team = useMemo(
    () => board?.teams.find((t) => t.mainAbbrev === viewing) ?? null,
    [board, viewing],
  );
  const isMine = team?.mainAbbrev === myTeam;

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
    staged.map((m) => (m.direction === "ASSIGN" ? `a${m.pid}` : `c${m.glPid}`)),
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
        <h2 className="display text-4xl mt-2">WHICH CLUB DO YOU RUN?</h2>
        <p className="mt-3 max-w-2xl text-sm opacity-70 leading-relaxed">
          Pick your franchise. You can browse every affiliate in the league, but you can only
          send players down and call them up for your own club.
        </p>
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
          <div className="flex items-center gap-3">
            <input
              value={gm}
              onChange={(e) => saveGm(e.target.value)}
              placeholder="YOUR GM NAME"
              className="bg-transparent border rule px-3 py-1.5 font-mono text-[10px] tracking-widest outline-none focus:border-[var(--leather)] w-44"
            />
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
                <span className="font-mono text-[10px] tracking-widest w-14 shrink-0 opacity-70">
                  {r.direction === "ASSIGN" ? "DOWN" : "UP"}
                </span>
                <span className="flex-1 font-mono text-xs truncate">{r.playerName}</span>
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
        <div className="eyebrow opacity-60 mb-3">EVERY AFFILIATE</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
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
              {team.players.map((p) => (
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
                  {isMine && (
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
              ))}
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
              {team.candidates.map((c) => (
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
                    {isMine && (
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
                  {isMine && <Rules items={c.violations} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* staged batch ------------------------------------------------------ */}
      {staged.length > 0 && (
        <div className="border rule border-[var(--leather)] p-4">
          <div className="eyebrow opacity-70">READY TO SEND · {staged.length}</div>
          <div className="mt-3 space-y-1.5">
            {staged.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] pb-1.5"
              >
                <span className="font-mono text-[10px] tracking-widest w-14 shrink-0 opacity-70">
                  {m.direction === "ASSIGN" ? "DOWN" : `UP ${m.years}Y`}
                </span>
                <span className="flex-1 font-mono text-xs">
                  {m.direction === "ASSIGN"
                    ? (team?.candidates.find((c) => c.pid === m.pid)?.name ?? `pid ${m.pid}`)
                    : (team?.players.find((p) => p.pid === m.glPid)?.name ?? `pid ${m.glPid}`)}
                </span>
                <button
                  onClick={() => setStaged((cur) => cur.filter((_, idx) => idx !== i))}
                  className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)]"
                >
                  DROP
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting || !gm.trim()}
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
            {!gm.trim() && (
              <span className="font-mono text-[10px] tracking-widest text-[var(--mustard)]">
                ADD YOUR GM NAME FIRST
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
