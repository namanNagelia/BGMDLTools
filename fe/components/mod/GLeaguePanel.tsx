"use client";

import { useEffect, useState } from "react";
import { ApiError, gleague, type GlBoard, type GlRequestRow, type Season } from "@/lib/api";

/**
 * The mod side of the G-League.
 *
 * Sending down, calling up and cutting are the GMs' job, on /gleague. A mod
 * does two things here: rule on the requests that come in, and pull the two
 * exports once they have.
 */

const dirLabel = (r: GlRequestRow) =>
  r.direction === "ASSIGN"
    ? "SEND DOWN"
    : r.direction === "RELEASE"
      ? "CUT"
      : `CALL UP${r.newContractYears ? ` ${r.newContractYears}Y` : ""}`;

const dirClass = (d: GlRequestRow["direction"]) =>
  d === "RELEASE" ? "text-[var(--leather)]" : "opacity-70";

function RequestRow({
  row,
  busy,
  onApprove,
  onDecline,
}: {
  row: GlRequestRow;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-2">
      <span
        className={`font-mono text-[10px] tracking-widest w-24 shrink-0 ${dirClass(row.direction)}`}
      >
        {dirLabel(row)}
      </span>

      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs truncate">{row.playerName}</div>
        {row.newContractAmount && (
          <div className="font-mono text-[10px] text-[var(--mustard)]">
            ${Number(row.newContractAmount).toFixed(2)}M through {row.newContractExp}
            {row.contractSource && <span className="opacity-60"> · {row.contractSource}</span>}
            {row.rfaRightsLost && <span className="text-[var(--leather)]"> · RFA RIGHTS LOST</span>}
          </div>
        )}
      </div>

      <span className="font-mono text-[10px] opacity-60 tabular-nums w-24 text-right">
        {row.ovrAtMove} OVR · {row.ageAtMove}yo
      </span>
      <span className="font-mono text-[10px] tracking-widest w-10 text-right opacity-70">
        {row.mainTeamAbbrev}
      </span>
      <span className="font-mono text-[10px] opacity-50 truncate w-24">
        {row.submittedByGm ?? "unknown"}
      </span>

      <button
        onClick={onApprove}
        disabled={busy}
        className="border rule px-2.5 py-1 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-30"
      >
        APPROVE
      </button>
      <button
        onClick={onDecline}
        disabled={busy}
        className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)] disabled:opacity-30"
      >
        DECLINE
      </button>
    </div>
  );
}

export function GLeaguePanel({ season }: { season: Season }) {
  const [board, setBoard] = useState<GlBoard | null>(null);
  const [pending, setPending] = useState<GlRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState(season.glLeagueLink ?? "");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, reqs] = await Promise.all([
        gleague.board(season.id),
        gleague.pending(season.id).catch(() => [] as GlRequestRow[]),
      ]);
      setBoard(b);
      setPending(reqs);
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

  async function act(ids: number[], approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (approve) {
        const res = await gleague.approve(season.id, ids);
        setNote(`${res.committed.length} request(s) approved — both exports now include them.`);
      } else {
        const res = await gleague.decline(season.id, ids);
        setNote(`${res.declined.length} request(s) declined.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not act on those requests");
    } finally {
      setBusy(false);
    }
  }

  async function handleLink() {
    setLoading(true);
    setError(null);
    try {
      await gleague.link(season.id, linkInput.trim());
      await load();
      setNote("G-League export filed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file that link");
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      await gleague.refresh(season.id);
      await load();
      setNote("Rebuilt from the exports.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Refresh failed");
      setLoading(false);
    }
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
        <div className="eyebrow opacity-60">G-LEAGUE / APPROVALS</div>
        <div className="flex flex-wrap items-baseline justify-between gap-4 mt-2">
          <h2 className="display text-4xl">REQUEST DESK</h2>
          {board && (
            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] tracking-widest opacity-60">
                MAIN {board.mainSeason} · GL {board.glSeason} · {board.teams.length} AFFILIATES
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

      <p className="max-w-3xl text-sm opacity-70 leading-relaxed">
        GMs send down, call up and cut their own players on{" "}
        <a
          href="/gleague"
          className="underline decoration-[var(--leather)] decoration-2 underline-offset-4 hover:text-[var(--leather)]"
        >
          the G-League desk
        </a>
        . Nothing they submit reaches an export until you approve it here.
      </p>

      {note && <div className="font-mono text-xs text-[var(--mustard)]">{note}</div>}
      {error && <div className="font-mono text-xs text-[var(--leather)]">{error}</div>}

      {board && (board.unmatchedGl.length > 0 || board.unmatchedMain.length > 0) && (
        <div className="border rule border-[var(--leather)] p-3 font-mono text-[10px] tracking-wide text-[var(--leather)]">
          AFFILIATE MAP INCOMPLETE — unmatched G-League: [{board.unmatchedGl.join(", ") || "none"}] ·
          unmatched main: [{board.unmatchedMain.join(", ") || "none"}]. Check both exports are from
          the same league era before approving anything.
        </div>
      )}

      {loading && !board && (
        <div className="py-16 font-mono text-xs tracking-widest opacity-60">
          PULLING BOTH EXPORTS<span className="caret ml-1" />
        </div>
      )}

      {/* the queue --------------------------------------------------------- */}
      <div className="border rule p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="eyebrow opacity-70">GM REQUESTS · {pending.length} WAITING</div>
          {pending.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => void act(pending.map((r) => r.id), true)}
                disabled={busy}
                className="border rule px-3 py-1 font-mono text-[10px] tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40"
              >
                APPROVE ALL
              </button>
              <button
                onClick={() => void act(pending.map((r) => r.id), false)}
                disabled={busy}
                className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100 hover:text-[var(--leather)] disabled:opacity-30"
              >
                DECLINE ALL
              </button>
            </div>
          )}
        </div>

        {pending.length === 0 ? (
          <div className="mt-3 font-mono text-xs opacity-50">
            Nothing waiting. GM submissions land here.
          </div>
        ) : (
          <div className="mt-3">
            {pending.map((r) => (
              <RequestRow
                key={r.id}
                row={r}
                busy={busy}
                onApprove={() => void act([r.id], true)}
                onDecline={() => void act([r.id], false)}
              />
            ))}
          </div>
        )}
      </div>

      {/* exports + ledger --------------------------------------------------- */}
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="border rule p-4">
          <div className="eyebrow opacity-60">EXPORTS</div>
          <p className="mt-2 text-xs opacity-70 leading-relaxed">
            Both files are rebuilt from the approved ledger on download, so they always agree about
            where every player is. Declined and still-pending requests are not in them.
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
          <div className="eyebrow opacity-60">LEDGER · {board?.ledger.length ?? 0}</div>
          <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
            {!board?.ledger.length && (
              <div className="font-mono text-xs opacity-50">No moves yet.</div>
            )}
            {board?.ledger.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1"
              >
                <span
                  className={`font-mono text-[10px] tracking-widest w-20 shrink-0 ${dirClass(row.direction)}`}
                >
                  {row.direction === "ASSIGN"
                    ? "SEND DOWN"
                    : row.direction === "RELEASE"
                      ? "CUT"
                      : "CALL UP"}
                </span>
                <span className="flex-1 font-mono text-xs truncate">{row.playerName}</span>
                <span className="font-mono text-[10px] opacity-60">
                  {row.direction === "ASSIGN" ? row.glTeamAbbrev : row.mainTeamAbbrev}
                  {row.contractSource ? ` · ${row.contractSource}` : ""}
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
