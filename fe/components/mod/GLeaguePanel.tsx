"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  gleague,
  type GlBoard,
  type GlProposal,
  type GlStagedMove,
  type Season,
} from "@/lib/api";
import { Legend, Pips } from "./gleague/bits";
import { moveKey, TeamDesk } from "./gleague/TeamDesk";
import { StagedBatch } from "./gleague/StagedBatch";

/**
 * The G-League, run by mods.
 *
 * GMs post their moves in #assignees_and_call_ups. A mod works through them
 * here a club at a time — sending down, calling up (and pricing the deal), and
 * cutting — then commits the batch and pulls the two exports.
 */
export function GLeaguePanel({ season }: { season: Season }) {
  const [board, setBoard] = useState<GlBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState(season.glLeagueLink ?? "");

  const [selected, setSelected] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  const [staged, setStaged] = useState<GlProposal[]>([]);
  const [preview, setPreview] = useState<GlStagedMove[]>([]);
  const [pricing, setPricing] = useState(false);
  const [note, setNote] = useState("");
  const [committing, setCommitting] = useState(false);

  async function load(fresh = false) {
    setLoading(true);
    setError(null);
    try {
      const b = fresh ? await gleague.refresh(season.id) : await gleague.board(season.id);
      setBoard(b);
      setSelected((cur) => cur ?? b.teams[0]?.mainAbbrev ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the G-League");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (season.glLeagueLink) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.id, season.glLeagueLink]);

  // Re-price the batch as it changes. Debounced, since the contract box fires
  // on every keystroke; the server validates against a cached pair, so it is quick.
  useEffect(() => {
    if (!staged.length) {
      setPreview([]);
      setPricing(false);
      return;
    }
    setPricing(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await gleague.validate(season.id, staged);
        if (!cancelled) setPreview(res.staged);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not check the batch");
      } finally {
        if (!cancelled) setPricing(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [staged, season.id]);

  const team = useMemo(
    () => board?.teams.find((t) => t.mainAbbrev === selected) ?? null,
    [board, selected],
  );

  const teamOf = (m: GlProposal) =>
    m.direction === "ASSIGN"
      ? (board?.teams.find((t) => t.glAbbrev === m.glAbbrev)?.mainAbbrev ?? m.glAbbrev)
      : m.mainAbbrev;

  const nameOf = (m: GlProposal) => {
    for (const t of board?.teams ?? []) {
      if (m.direction === "ASSIGN") {
        const c = t.candidates.find((x) => x.pid === m.pid);
        if (c) return c.name;
      } else {
        const p = t.players.find((x) => x.pid === m.glPid);
        if (p) return p.name;
      }
    }
    return "…";
  };

  const stagedByTeam = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of staged) out.set(teamOf(m), (out.get(teamOf(m)) ?? 0) + 1);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, board]);

  function toggle(move: GlProposal) {
    const key = moveKey(move);
    setStaged((cur) => {
      if (cur.some((m) => moveKey(m) === key)) return cur.filter((m) => moveKey(m) !== key);
      // One action per player: a call-up replaces a staged cut and vice versa.
      const glPid = move.direction === "ASSIGN" ? null : move.glPid;
      const rest = glPid == null ? cur : cur.filter((m) => m.direction === "ASSIGN" || m.glPid !== glPid);
      return [...rest, move];
    });
  }

  async function commit() {
    setCommitting(true);
    setError(null);
    try {
      const moves = staged.map((m) => (note.trim() ? { ...m, overrideReason: note.trim() } : m));
      const res = await gleague.commit(season.id, moves);
      setNotice(
        `${res.committed.length} move(s) committed${
          res.errors.length ? ` · ${res.errors.length} skipped: ${res.errors.join("; ")}` : ""
        }. Both exports now include them.`,
      );
      setStaged([]);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  async function handleLink() {
    setLoading(true);
    setError(null);
    try {
      await gleague.link(season.id, linkInput.trim());
      await load();
      setNotice("G-League export filed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file that link");
      setLoading(false);
    }
  }

  function step(delta: number) {
    if (!board) return;
    const i = board.teams.findIndex((t) => t.mainAbbrev === selected);
    const next = board.teams[(i + delta + board.teams.length) % board.teams.length];
    setSelected(next.mainAbbrev);
  }

  /* ---- no export filed yet ---------------------------------------------- */
  if (!season.glLeagueLink && !board) {
    return (
      <section className="rise">
        <div className="eyebrow opacity-60">G-LEAGUE / SETUP</div>
        <h2 className="display text-4xl mt-2">LINK THE AFFILIATE EXPORT</h2>
        <p className="mt-3 max-w-2xl text-sm opacity-70 leading-relaxed">
          Season {season.seasonNumber} already has its main-league file. Paste the Dropbox link to
          the matching <b>G-League</b> export — the two files are the pair players move between.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 max-w-3xl">
          <input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://www.dropbox.com/scl/fi/.../BBGM_BGMDL_GL_....json.gz"
            className="flex-1 bg-transparent border rule px-3 py-2 font-mono text-xs outline-none focus:border-[var(--leather)]"
          />
          <button
            onClick={() => void handleLink()}
            disabled={!linkInput.trim() || loading}
            className="border rule px-4 py-2 font-mono text-xs tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40"
          >
            {loading ? <span className="spinner" /> : "PULL · FILE"}
          </button>
        </div>
        {error && <div className="mt-4 font-mono text-xs text-[var(--leather)]">{error}</div>}
      </section>
    );
  }

  return (
    <section className="rise space-y-8">
      <div>
        <div className="eyebrow opacity-60">G-LEAGUE / MOVES</div>
        <div className="flex flex-wrap items-baseline justify-between gap-4 mt-2">
          <h2 className="display text-4xl">AFFILIATE DESK</h2>
          {board && (
            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] tracking-widest opacity-60">
                MAIN {board.mainSeason} · GL {board.glSeason} · HARD CAP ${board.hardCapM}M
              </div>
              <button
                onClick={() => void load(true)}
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

      <p className="max-w-3xl text-sm opacity-70 leading-relaxed">
        Work through <b>#assignees_and_call_ups</b> a club at a time. Stage the moves, set each
        call-up&apos;s contract, then commit. Nothing reaches an export until it is committed.
      </p>

      {notice && <div className="font-mono text-xs text-[var(--mustard)]">{notice}</div>}
      {error && <div className="font-mono text-xs text-[var(--leather)]">{error}</div>}

      {board && (board.unmatchedGl.length > 0 || board.unmatchedMain.length > 0) && (
        <div className="border rule border-[var(--leather)] p-3 font-mono text-[10px] tracking-wide text-[var(--leather)]">
          AFFILIATE MAP INCOMPLETE — unmatched G-League: [{board.unmatchedGl.join(", ") || "none"}] ·
          unmatched main: [{board.unmatchedMain.join(", ") || "none"}]. Check both exports are from
          the same league era before committing anything.
        </div>
      )}

      {loading && !board && (
        <div className="py-16 font-mono text-xs tracking-widest opacity-60">
          PULLING BOTH EXPORTS<span className="caret ml-1" />
        </div>
      )}

      {board && (
        <>
          {/* club picker ---------------------------------------------------- */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <button
                onClick={() => setShowGrid((v) => !v)}
                className="eyebrow opacity-70 hover:opacity-100 flex items-center gap-2"
              >
                <span className="inline-block w-3 text-[var(--leather)]">{showGrid ? "−" : "+"}</span>
                ALL {board.teams.length} AFFILIATES
              </button>
              {showGrid && <Legend />}
            </div>

            {showGrid && (
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2 mt-3">
                {board.teams.map((t) => {
                  const active = t.mainAbbrev === selected;
                  const n = stagedByTeam.get(t.mainAbbrev) ?? 0;
                  return (
                    <button
                      key={t.glTid}
                      onClick={() => setSelected(t.mainAbbrev)}
                      className={`border rule p-2.5 text-left transition-colors ${
                        active ? "bg-[var(--paper)] text-[var(--ink)]" : "hover:bg-[color:rgba(243,237,225,0.06)]"
                      } ${n > 0 && !active ? "border-[var(--leather)]" : ""}`}
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-mono text-[11px] tracking-widest">{t.mainAbbrev}</span>
                        <span
                          className={`font-mono text-[10px] ${
                            t.players.length < 5 || t.players.length > 7 ? "text-[var(--mustard)]" : "opacity-50"
                          }`}
                        >
                          {t.players.length}/7
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Pips team={t} />
                      </div>
                      <div className="mt-1 flex gap-2 font-mono text-[9px] tracking-widest">
                        {n > 0 && <span className="text-[var(--leather)]">{n} STAGED</span>}
                        {t.forced.length > 0 && (
                          <span className="text-[var(--mustard)]">{t.forced.length} MUST UP</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* the selected club ------------------------------------------------ */}
          {team && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => step(-1)}
                  className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
                >
                  ← PREV
                </button>
                <div className="font-mono text-xs tracking-widest">{team.mainName}</div>
                <button
                  onClick={() => step(1)}
                  className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
                >
                  NEXT →
                </button>
              </div>
              <TeamDesk team={team} staged={staged} preview={preview} onToggle={toggle} />
            </div>
          )}

          <StagedBatch
            staged={staged}
            preview={preview}
            pricing={pricing}
            teamOf={teamOf}
            nameOf={nameOf}
            onChange={(i, next) => setStaged((cur) => cur.map((m, idx) => (idx === i ? next : m)))}
            onDrop={(i) => setStaged((cur) => cur.filter((_, idx) => idx !== i))}
            onClear={() => setStaged([])}
            note={note}
            onNote={setNote}
            onCommit={() => void commit()}
            committing={committing}
          />

          {/* exports + ledger ------------------------------------------------ */}
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="border rule p-4">
              <div className="eyebrow opacity-60">EXPORTS</div>
              <p className="mt-2 text-xs opacity-70 leading-relaxed">
                Both files are rebuilt from the committed ledger on download, so they always agree
                about where every player is and what he is paid.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={gleague.exportUrl(season.id, "main")}
                  className="border rule px-3 py-2 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors"
                >
                  ↓ MAIN LEAGUE EXPORT
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
              <div className="eyebrow opacity-60">
                LEDGER · {board.ledger.filter((r) => r.status === "COMMITTED").length}
              </div>
              <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
                {!board.ledger.some((r) => r.status === "COMMITTED") && (
                  <div className="font-mono text-xs opacity-50">No moves yet.</div>
                )}
                {board.ledger
                  .filter((r) => r.status === "COMMITTED")
                  .map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1"
                    >
                      <span
                        className={`font-mono text-[10px] tracking-widest w-20 shrink-0 ${
                          row.direction === "RELEASE" ? "text-[var(--leather)]" : "opacity-70"
                        }`}
                      >
                        {row.direction === "ASSIGN"
                          ? "SEND DOWN"
                          : row.direction === "RELEASE"
                            ? "CUT"
                            : "CALL UP"}
                      </span>
                      <span className="flex-1 font-mono text-xs truncate">{row.playerName}</span>
                      <span className="font-mono text-[10px] opacity-60">
                        {row.mainTeamAbbrev}
                        {row.newContractAmount &&
                          ` · $${Number(row.newContractAmount).toFixed(2)}M/${row.newContractExp}`}
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
