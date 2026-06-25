"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, seasons as seasonsApi, type Season } from "@/lib/api";
import { SeasonRow } from "./SeasonRow";

export function SeasonManager() {
  const [rows, setRows] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [newLink, setNewLink] = useState("");
  const [newSheets, setNewSheets] = useState("");
  const [newCurrent, setNewCurrent] = useState(true);
  const [creating, setCreating] = useState(false);
  const [phase, setPhase] = useState<"" | "FILING" | "INGESTING">("");
  const [lastResult, setLastResult] = useState<{
    season: number;
    created: boolean;
    ingested?: number;
    ratings?: number;
    skipped?: number;
  } | null>(null);

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
    setLastResult(null);
    try {
      // 1) pull + file (auto-detect season)
      setPhase("FILING");
      const fileRes = await seasonsApi.createFromLink({
        leagueLink: newLink,
        makeCurrent: newCurrent,
      });

      let ingested: number | undefined;
      let ratings: number | undefined;
      let skipped: number | undefined;

      // 2) if a sheets link was provided, save it and ingest
      if (newSheets.trim()) {
        await seasonsApi.update(fileRes.season.id, {
          sheetsLink: newSheets.trim(),
        });
        setPhase("INGESTING");
        const ing = await seasonsApi.ingestFAs(fileRes.season.id);
        ingested = ing.inserted;
        ratings = ing.ratingsAttached;
        skipped =
          ing.unmatchedFromTeamSheet.length + ing.unmatchedFromValuesSheet.length;
      }

      setLastResult({
        season: fileRes.detectedSeason,
        created: fileRes.created,
        ingested,
        ratings,
        skipped,
      });
      setNewLink("");
      setNewSheets("");
      setNewCurrent(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message.toUpperCase() : "FAILED");
    } finally {
      setCreating(false);
      setPhase("");
    }
  }

  const current = rows.find((r) => r.isCurrentSzn);

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
          {current ? `CURRENT · ${current.seasonNumber}` : "NO ACTIVE SEASON"}
        </div>
      </div>

      {/* CREATE FORM ---------------------------------------------------- */}
      <form
        onSubmit={handleCreate}
        className="border rule p-5 sm:p-6 mb-8 bg-[color:var(--ink-2)] space-y-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="eyebrow opacity-70">FILE A NEW SEASON</div>
          <div className="font-mono text-[10px] opacity-40">
            SEASON AUTO-DETECTED · SHEETS OPTIONAL
          </div>
        </div>

        <label className="block">
          <div className="font-mono text-[10px] tracking-widest opacity-60 mb-1">
            LEAGUE LINK (DROPBOX)
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

        <label className="block">
          <div className="font-mono text-[10px] tracking-widest opacity-60 mb-1 flex items-baseline justify-between">
            <span>SHEETS LINK (OPTIONAL)</span>
            <span className="opacity-50">IF SET — AUTO-INGESTS FAs AFTER FILING</span>
          </div>
          <input
            type="url"
            value={newSheets}
            onChange={(e) => setNewSheets(e.target.value)}
            disabled={creating}
            placeholder="https://docs.google.com/spreadsheets/d/…"
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
            className="bg-[var(--leather)] text-[var(--paper)] px-5 py-2 font-mono text-sm tracking-wider hover:bg-[var(--leather-2)] disabled:bg-[color:var(--ink-2)] disabled:text-[color:rgba(243,237,225,0.3)] disabled:cursor-not-allowed transition-colors min-w-[12rem] flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <span className="spinner" />
                <span>{phase || "WORKING"}…</span>
              </>
            ) : newSheets.trim() ? (
              "PULL · FILE · INGEST"
            ) : (
              "PULL & FILE"
            )}
          </button>
        </div>

        {lastResult && (
          <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-[11px] tracking-widest flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-[var(--leather)]">
              {lastResult.created ? "FILED" : "UPDATED"}
            </span>
            <span className="opacity-60">SEASON</span>
            <span className="display text-xl">{lastResult.season}</span>
            {lastResult.ingested !== undefined && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-[var(--leather)]">INGESTED</span>
                <span>{lastResult.ingested} FAs</span>
                <span className="opacity-60">
                  · {lastResult.ratings}/{lastResult.ingested} with ratings
                </span>
                {lastResult.skipped ? (
                  <span className="opacity-60">· {lastResult.skipped} skipped</span>
                ) : null}
              </>
            )}
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
            <div className="col-span-6">LINKS</div>
            <div className="col-span-2">STATUS</div>
            <div className="col-span-2 text-right">ACTIONS</div>
          </div>

          {rows.map((s) => (
            <SeasonRow
              key={s.id}
              season={s}
              onChanged={refresh}
              onError={(msg) => setError(msg)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
