"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, mod, seasons as seasonsApi, type Season } from "@/lib/api";
import { JsonViewer } from "./JsonViewer";

interface PullState {
  loading: boolean;
  data?: unknown;
  error?: string;
}

export function SeasonManager() {
  const [rows, setRows] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [newLink, setNewLink] = useState("");
  const [newCurrent, setNewCurrent] = useState(true);
  const [creating, setCreating] = useState(false);
  const [lastDetected, setLastDetected] = useState<{
    season: number;
    created: boolean;
  } | null>(null);

  // per-row pull state
  const [pulls, setPulls] = useState<Record<number, PullState>>({});
  const [expandedPull, setExpandedPull] = useState<number | null>(null);

  // confirm delete
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  async function refresh() {
    try {
      const data = await seasonsApi.list();
      setRows(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message.toUpperCase());
      else setError("FETCH FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setLastDetected(null);
    try {
      const result = await seasonsApi.createFromLink({
        leagueLink: newLink,
        makeCurrent: newCurrent,
      });
      setLastDetected({ season: result.detectedSeason, created: result.created });
      setNewLink("");
      setNewCurrent(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "CREATE FAILED");
    } finally {
      setCreating(false);
    }
  }

  async function handleSetCurrent(id: number) {
    try {
      await seasonsApi.setCurrent(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "FAILED");
    }
  }

  async function handleDelete(id: number) {
    try {
      await seasonsApi.remove(id);
      setPendingDelete(null);
      setPulls((p) => {
        const copy = { ...p };
        delete copy[id];
        return copy;
      });
      if (expandedPull === id) setExpandedPull(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "DELETE FAILED");
    }
  }

  async function handlePull(season: Season) {
    setPulls((p) => ({ ...p, [season.id]: { loading: true } }));
    setExpandedPull(season.id);
    try {
      const res = await mod.fetchLeague(season.leagueLink);
      setPulls((p) => ({ ...p, [season.id]: { loading: false, data: res.data } }));
    } catch (err) {
      setPulls((p) => ({
        ...p,
        [season.id]: {
          loading: false,
          error: err instanceof ApiError ? err.message.toUpperCase() : "FETCH FAILED",
        },
      }));
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-5">
        <div>
          <div className="eyebrow opacity-60">DESK A · LEDGER</div>
          <h2 className="display text-[10vw] sm:text-[5vw] leading-[0.85] mt-2">
            SEASON <span className="text-[var(--leather)]">LEDGER</span>
          </h2>
        </div>
        <div className="font-mono text-[10px] tracking-widest opacity-50 text-right">
          {rows.length} ON RECORD
          <br />
          {rows.find((r) => r.isCurrentSzn)?.seasonNumber
            ? `CURRENT · ${rows.find((r) => r.isCurrentSzn)?.seasonNumber}`
            : "NO ACTIVE SEASON"}
        </div>
      </div>

      {/* CREATE FORM ---------------------------------------------------- */}
      <form
        onSubmit={handleCreate}
        className="border rule p-5 sm:p-6 mb-8 bg-[color:var(--ink-2)] space-y-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="eyebrow opacity-70">PULL A LEAGUE FILE</div>
          <div className="font-mono text-[10px] opacity-40">
            SEASON AUTO-DETECTED FROM JSON
          </div>
        </div>

        <label className="block">
          <div className="font-mono text-[10px] tracking-widest opacity-60 mb-1">
            LEAGUE LINK
          </div>
          <input
            type="url"
            required
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            disabled={creating}
            placeholder="https://www.dropbox.com/scl/fi/.../league.json.gz?…"
            className="w-full bg-transparent border rule px-3 py-2 outline-none font-mono text-sm focus:border-[var(--leather)] transition-colors"
          />
        </label>

        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 font-mono text-[11px] tracking-widest opacity-80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newCurrent}
              onChange={(e) => setNewCurrent(e.target.checked)}
              disabled={creating}
              className="accent-[var(--leather)] w-4 h-4"
            />
            MARK AS CURRENT SEASON
          </label>
          <button
            type="submit"
            disabled={creating || !newLink}
            className="bg-[var(--leather)] text-[var(--paper)] px-5 py-2 font-mono text-sm tracking-wider hover:bg-[var(--leather-2)] disabled:bg-[color:var(--ink-2)] disabled:text-[color:rgba(243,237,225,0.3)] disabled:cursor-not-allowed transition-colors"
          >
            {creating ? "PULLING & FILING…" : "PULL & FILE"}
          </button>
        </div>

        {lastDetected && (
          <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-[11px] tracking-widest">
            <span className="text-[var(--leather)]">
              {lastDetected.created ? "FILED" : "UPDATED"}
            </span>
            <span className="opacity-60"> · DETECTED SEASON </span>
            <span className="display text-xl">{lastDetected.season}</span>
          </div>
        )}
      </form>

      {error && (
        <div className="mb-5 border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
          {error}
        </div>
      )}

      {/* LEDGER TABLE --------------------------------------------------- */}
      {loading ? (
        <div className="font-mono text-xs tracking-widest opacity-60 py-12">
          OPENING LEDGER<span className="caret ml-1" />
        </div>
      ) : rows.length === 0 ? (
        <div className="border-2 border-dashed border-[color:var(--rule-soft)] py-12 text-center font-mono text-xs tracking-widest opacity-60">
          LEDGER IS EMPTY · FILE THE FIRST SEASON ABOVE
        </div>
      ) : (
        <div className="border rule">
          {/* column header */}
          <div className="grid grid-cols-12 gap-3 px-4 py-2 border-b rule font-mono text-[10px] tracking-widest opacity-60">
            <div className="col-span-2">SEASON</div>
            <div className="col-span-6">LINK</div>
            <div className="col-span-2">STATUS</div>
            <div className="col-span-2 text-right">ACTIONS</div>
          </div>

          {rows.map((s) => {
            const pull = pulls[s.id];
            const isExpanded = expandedPull === s.id && (pull?.data !== undefined || pull?.error);
            return (
              <div
                key={s.id}
                className={`border-b rule last:border-b-0 ${s.isCurrentSzn ? "bg-[color:var(--ink-2)]" : ""}`}
              >
                <div className="grid grid-cols-12 gap-3 px-4 py-3 items-center">
                  <div className="col-span-2 display text-3xl leading-none">
                    {s.seasonNumber}
                  </div>
                  <div className="col-span-6 font-mono text-[11px] truncate opacity-80" title={s.leagueLink}>
                    {s.leagueLink}
                  </div>
                  <div className="col-span-2 font-mono text-[10px] tracking-widest">
                    {s.isCurrentSzn ? (
                      <span className="inline-flex items-center gap-2 text-[var(--leather)]">
                        <span className="w-2 h-2 rounded-full bg-[var(--leather)] animate-pulse" />
                        CURRENT
                      </span>
                    ) : (
                      <span className="opacity-50">ARCHIVED</span>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <button
                      onClick={() => handlePull(s)}
                      disabled={pull?.loading}
                      className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors"
                      title="Pull JSON"
                    >
                      {pull?.loading ? "…" : "PULL"}
                    </button>
                    {!s.isCurrentSzn && (
                      <button
                        onClick={() => handleSetCurrent(s.id)}
                        className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--mustard)] hover:border-[var(--mustard)] hover:text-[var(--ink)] transition-colors"
                        title="Mark as current"
                      >
                        MARK
                      </button>
                    )}
                    {pendingDelete === s.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="font-mono text-[10px] tracking-widest px-2 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] transition-colors"
                        >
                          CONFIRM
                        </button>
                        <button
                          onClick={() => setPendingDelete(null)}
                          className="font-mono text-[10px] tracking-widest px-2 py-1 border rule opacity-70 hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setPendingDelete(s.id)}
                        className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:border-[var(--leather)] hover:text-[var(--leather)] transition-colors"
                        title="Delete season"
                      >
                        DEL
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t rule pt-3 bg-[color:var(--ink)]">
                    {pull?.error ? (
                      <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
                        {pull.error}
                      </div>
                    ) : pull?.data !== undefined ? (
                      <JsonViewer value={pull.data} />
                    ) : null}
                    <button
                      onClick={() => setExpandedPull(null)}
                      className="mt-3 font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
                    >
                      ↑ COLLAPSE
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
