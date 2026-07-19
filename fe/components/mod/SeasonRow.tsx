"use client";

import { useState } from "react";
import {
  ApiError,
  mod,
  seasons as seasonsApi,
  type IngestResult,
  type ParsedSheets,
  type Season,
} from "@/lib/api";
import { JsonViewer } from "./JsonViewer";
import { SheetTable } from "./SheetTable";
import { RanksTriptych } from "./RanksTriptych";

type Mode = "json" | "sheets" | null;

interface JsonState {
  loading: boolean;
  data?: unknown;
  error?: string;
}

interface SheetsState {
  loading: boolean;
  data?: ParsedSheets;
  error?: string;
}

interface Props {
  season: Season;
  onChanged: () => Promise<void> | void;
  onError: (msg: string) => void;
}

export function SeasonRow({ season, onChanged, onError }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [jsonState, setJsonState] = useState<JsonState>({ loading: false });
  const [sheetsState, setSheetsState] = useState<SheetsState>({ loading: false });

  // sheets-link inline editor
  const [editingSheets, setEditingSheets] = useState(false);
  const [sheetsDraft, setSheetsDraft] = useState(season.sheetsLink ?? "");
  const [savingSheets, setSavingSheets] = useState(false);

  // league-link inline editor
  const [editingLeague, setEditingLeague] = useState(false);
  const [leagueDraft, setLeagueDraft] = useState(season.leagueLink);
  const [savingLeague, setSavingLeague] = useState(false);

  // delete confirm
  const [confirmDel, setConfirmDel] = useState(false);

  // ingest
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);

  // wave
  const [wavingTo, setWavingTo] = useState<1 | 2 | null>(null);

  // reset
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    const ok1 = window.confirm(
      `RESET SEASON ${season.seasonNumber}?\n\n` +
        `This wipes ALL offers, renouncements, and signings for this season.\n` +
        `Cap holds reappear. Signed players become UFA again.\n\n` +
        `BBGM and Sheets data on this season ROW are untouched — you can re-ingest after.`,
    );
    if (!ok1) return;
    const ok2 = window.confirm(
      `Are you ABSOLUTELY sure?\n\nThis is irreversible — every accepted/pending/rejected offer is deleted.`,
    );
    if (!ok2) return;
    setResetting(true);
    try {
      const r = await seasonsApi.resetFA(season.id);
      onError(
        `RESET DONE · ${r.deletedOffers} OFFERS WIPED · ${r.resetFAs} FAs CLEARED`,
      );
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "RESET FAILED");
    } finally {
      setResetting(false);
    }
  }

  async function handlePullJson() {
    setMode("json");
    setJsonState({ loading: true });
    try {
      const res = await mod.fetchLeague(season.leagueLink);
      setJsonState({ loading: false, data: res.data });
    } catch (err) {
      setJsonState({
        loading: false,
        error: err instanceof ApiError ? err.message.toUpperCase() : "FETCH FAILED",
      });
    }
  }

  async function handleParseSheets() {
    if (!season.sheetsLink) {
      setEditingSheets(true);
      onError("ADD A SHEETS LINK FIRST");
      return;
    }
    setMode("sheets");
    setSheetsState({ loading: true });
    try {
      const data = await seasonsApi.parseSheets(season.id);
      setSheetsState({ loading: false, data });
    } catch (err) {
      setSheetsState({
        loading: false,
        error: err instanceof ApiError ? err.message.toUpperCase() : "PARSE FAILED",
      });
    }
  }

  async function handleSaveSheets() {
    setSavingSheets(true);
    setIngestResult(null);
    try {
      const trimmed = sheetsDraft.trim();
      await seasonsApi.update(season.id, { sheetsLink: trimmed || null });
      setEditingSheets(false);

      // auto-ingest if a real link is set
      if (trimmed) {
        setIngesting(true);
        try {
          const result = await seasonsApi.ingestFAs(season.id);
          setIngestResult(result);
        } catch (err) {
          onError(
            err instanceof ApiError ? err.message.toUpperCase() : "INGEST FAILED",
          );
        } finally {
          setIngesting(false);
        }
      }

      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "SAVE FAILED");
    } finally {
      setSavingSheets(false);
    }
  }

  async function handleSaveLeague() {
    const trimmed = leagueDraft.trim();
    if (!trimmed) {
      onError("LEAGUE LINK REQUIRED");
      return;
    }
    setSavingLeague(true);
    setIngestResult(null);
    try {
      await seasonsApi.update(season.id, { leagueLink: trimmed });
      setEditingLeague(false);
      // auto-ingest so caps, ratings, ranks all reflect the new file
      setIngesting(true);
      try {
        const result = await seasonsApi.ingestFAs(season.id);
        setIngestResult(result);
      } catch (err) {
        onError(
          err instanceof ApiError ? err.message.toUpperCase() : "INGEST FAILED",
        );
      } finally {
        setIngesting(false);
      }
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "SAVE FAILED");
    } finally {
      setSavingLeague(false);
    }
  }

  async function handleFlipWave() {
    const next: 1 | 2 = season.currentWave === 1 ? 2 : 1;
    setWavingTo(next);
    try {
      const result = await seasonsApi.setWave(season.id, next);
      if (next === 2 && result.convertedToUFA > 0) {
        onError(
          `WAVE 2 — ${result.convertedToUFA} UNOFFERED RFA${result.convertedToUFA === 1 ? "" : "S"} CONVERTED TO UFA`,
        );
      }
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "WAVE FAILED");
    } finally {
      setWavingTo(null);
    }
  }

  async function handleSetCurrent() {
    try {
      await seasonsApi.setCurrent(season.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "FAILED");
    }
  }

  async function handleIngest() {
    setIngesting(true);
    setIngestResult(null);
    try {
      const result = await seasonsApi.ingestFAs(season.id);
      setIngestResult(result);
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "INGEST FAILED");
    } finally {
      setIngesting(false);
    }
  }

  async function handleDelete() {
    try {
      await seasonsApi.remove(season.id);
      setConfirmDel(false);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message.toUpperCase() : "DELETE FAILED");
    }
  }

  const isExpanded =
    (mode === "json" && (jsonState.loading || jsonState.data !== undefined || jsonState.error)) ||
    (mode === "sheets" &&
      (sheetsState.loading || sheetsState.data !== undefined || sheetsState.error));

  return (
    <div
      className={`border-b rule last:border-b-0 ${
        season.isCurrentSzn ? "bg-[color:var(--ink-2)]" : ""
      }`}
    >
      {/* main row */}
      <div className="grid grid-cols-12 gap-3 px-4 py-3 items-start">
        <div className="col-span-2 display text-3xl leading-none pt-1">
          {season.seasonNumber}
        </div>

        <div className="col-span-6 space-y-1 min-w-0">
          {editingLeague ? (
            <div className="flex gap-2">
              <input
                type="url"
                autoFocus
                value={leagueDraft}
                onChange={(e) => setLeagueDraft(e.target.value)}
                placeholder="https://www.dropbox.com/.../league.json.gz?…"
                className="flex-1 bg-transparent border rule px-2 py-1 outline-none font-mono text-[11px] focus:border-[var(--leather)] transition-colors"
              />
              <button
                onClick={handleSaveLeague}
                disabled={savingLeague || ingesting}
                title="Save dropbox link + auto-ingest"
                className="font-mono text-[10px] tracking-widest px-2 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] disabled:opacity-40 transition-colors min-w-[6rem] flex items-center justify-center gap-1.5"
              >
                {savingLeague || ingesting ? (
                  <>
                    <span className="spinner" />
                    <span>{ingesting ? "INGESTING" : "SAVING"}</span>
                  </>
                ) : (
                  "SAVE + INGEST"
                )}
              </button>
              <button
                onClick={() => {
                  setEditingLeague(false);
                  setLeagueDraft(season.leagueLink);
                }}
                className="font-mono text-[10px] tracking-widest px-2 py-1 border rule opacity-70 hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              className="font-mono text-[11px] truncate opacity-80 flex items-baseline gap-2"
              title={season.leagueLink}
            >
              <span className="opacity-50 shrink-0">json:</span>
              <span className="truncate">{season.leagueLink}</span>
              <button
                onClick={() => setEditingLeague(true)}
                className="font-mono text-[9px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)] shrink-0"
              >
                EDIT
              </button>
            </div>
          )}

          {editingSheets ? (
            <div className="flex gap-2">
              <input
                type="url"
                autoFocus
                value={sheetsDraft}
                onChange={(e) => setSheetsDraft(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 bg-transparent border rule px-2 py-1 outline-none font-mono text-[11px] focus:border-[var(--leather)] transition-colors"
              />
              <button
                onClick={handleSaveSheets}
                disabled={savingSheets || ingesting}
                title="Save link + auto-ingest"
                className="font-mono text-[10px] tracking-widest px-2 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] disabled:opacity-40 transition-colors min-w-[6rem] flex items-center justify-center gap-1.5"
              >
                {savingSheets || ingesting ? (
                  <>
                    <span className="spinner" />
                    <span>{ingesting ? "INGESTING" : "SAVING"}</span>
                  </>
                ) : (
                  "SAVE + INGEST"
                )}
              </button>
              <button
                onClick={() => {
                  setEditingSheets(false);
                  setSheetsDraft(season.sheetsLink ?? "");
                }}
                className="font-mono text-[10px] tracking-widest px-2 py-1 border rule opacity-70 hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ) : season.sheetsLink ? (
            <div className="font-mono text-[11px] truncate opacity-80 flex items-baseline gap-2" title={season.sheetsLink}>
              <span className="opacity-50 shrink-0">sheets:</span>
              <span className="truncate">{season.sheetsLink}</span>
              <button
                onClick={() => setEditingSheets(true)}
                className="font-mono text-[9px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)] shrink-0"
              >
                EDIT
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingSheets(true)}
              className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)] transition-colors"
            >
              + ADD SHEETS LINK
            </button>
          )}
        </div>

        <div className="col-span-2 font-mono text-[10px] tracking-widest pt-1">
          {season.isCurrentSzn ? (
            <span className="inline-flex items-center gap-2 text-[var(--leather)]">
              <span className="w-2 h-2 rounded-full bg-[var(--leather)] animate-pulse" />
              CURRENT
            </span>
          ) : (
            <span className="opacity-50">ARCHIVED</span>
          )}
        </div>

        <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 pt-1">
          <button
            onClick={handlePullJson}
            disabled={jsonState.loading}
            className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors min-w-[3.25rem] flex items-center justify-center gap-1.5"
            title="Pull league JSON"
          >
            {jsonState.loading ? (
              <>
                <span className="spinner" />
                <span>PULLING</span>
              </>
            ) : (
              "PULL"
            )}
          </button>
          <button
            onClick={handleParseSheets}
            disabled={sheetsState.loading}
            className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors min-w-[3.25rem] flex items-center justify-center gap-1.5"
            title="Parse Google Sheet"
          >
            {sheetsState.loading ? (
              <>
                <span className="spinner" />
                <span>PARSING</span>
              </>
            ) : (
              "PARSE"
            )}
          </button>
          <button
            onClick={handleIngest}
            disabled={ingesting}
            className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors min-w-[3.25rem] flex items-center justify-center gap-1.5"
            title="Merge sheets + BBGM ratings and save to DB"
          >
            {ingesting ? (
              <>
                <span className="spinner" />
                <span>INGESTING</span>
              </>
            ) : (
              "INGEST"
            )}
          </button>
          {!season.isCurrentSzn && (
            <button
              onClick={handleSetCurrent}
              className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--mustard)] hover:border-[var(--mustard)] hover:text-[var(--ink)] transition-colors"
              title="Mark as current"
            >
              MARK
            </button>
          )}
          <button
            onClick={handleFlipWave}
            disabled={wavingTo !== null}
            title={`Currently in wave ${season.currentWave} — click to flip`}
            className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {wavingTo !== null ? (
              <>
                <span className="spinner" />
                <span>W{wavingTo}…</span>
              </>
            ) : (
              `WAVE ${season.currentWave}`
            )}
          </button>
          <button
            onClick={handleReset}
            disabled={resetting}
            title="Wipe all offers + renouncements + signings for this season (2-step confirm)"
            className="font-mono text-[10px] tracking-widest px-2 py-1 border border-[var(--leather)] text-[var(--leather)] opacity-80 hover:opacity-100 hover:bg-[var(--leather)] hover:text-[var(--paper)] disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {resetting ? (
              <>
                <span className="spinner" />
                <span>RESET…</span>
              </>
            ) : (
              "RESET FA"
            )}
          </button>
          {confirmDel ? (
            <>
              <button
                onClick={handleDelete}
                className="font-mono text-[10px] tracking-widest px-2 py-1 bg-[var(--leather)] text-[var(--paper)] hover:bg-[var(--leather-2)] transition-colors"
              >
                CONFIRM
              </button>
              <button
                onClick={() => setConfirmDel(false)}
                className="font-mono text-[10px] tracking-widest px-2 py-1 border rule opacity-70 hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="font-mono text-[10px] tracking-widest px-2 py-1 border rule hover:border-[var(--leather)] hover:text-[var(--leather)] transition-colors"
              title="Delete season"
            >
              DEL
            </button>
          )}
        </div>
      </div>

      {ingestResult && (
        <div className="px-4 pb-3 border-t rule pt-2 font-mono text-[10px] tracking-widest flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[var(--leather)]">INGESTED</span>
          <span>{ingestResult.inserted} FAs</span>
          <span className="opacity-60">
            · {ingestResult.faUpdated} updated, {ingestResult.faInserted} new
          </span>
          <span className="opacity-60">
            · {ingestResult.ratingsAttached}/{ingestResult.inserted} with ratings
          </span>
          {ingestResult.snapshotId > 0 && (
            <span
              className="opacity-60"
              title={`Snapshot #${ingestResult.snapshotId} preserved ${ingestResult.snapshotFAs} FAs + ${ingestResult.snapshotOffers} offers from before this ingest.`}
            >
              · snapshot #{ingestResult.snapshotId} ({ingestResult.snapshotOffers} offers backed up)
            </span>
          )}
          {ingestResult.unmatchedFromValuesSheet.length > 0 && (
            <span
              className="opacity-60"
              title={ingestResult.unmatchedFromValuesSheet.join(", ")}
            >
              · {ingestResult.unmatchedFromValuesSheet.length} skipped (no values row)
            </span>
          )}
          {ingestResult.unmatchedFromTeamSheet.length > 0 && (
            <span
              className="opacity-60"
              title={ingestResult.unmatchedFromTeamSheet.join(", ")}
            >
              · {ingestResult.unmatchedFromTeamSheet.length} skipped (no team row)
            </span>
          )}
          <button
            onClick={() => setIngestResult(null)}
            className="ml-auto opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* expanded panel */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t rule pt-3 bg-[color:var(--ink)] space-y-4">
          {/* mode switcher */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1 font-mono text-[10px] tracking-widest">
              <button
                onClick={() => setMode("json")}
                className={`px-2 py-1 border rule transition-colors ${
                  mode === "json"
                    ? "bg-[var(--leather)] border-[var(--leather)] text-[var(--paper)]"
                    : "opacity-60 hover:opacity-100"
                }`}
                disabled={jsonState.data === undefined && jsonState.error === undefined}
              >
                JSON
              </button>
              <button
                onClick={() => setMode("sheets")}
                className={`px-2 py-1 border rule transition-colors ${
                  mode === "sheets"
                    ? "bg-[var(--leather)] border-[var(--leather)] text-[var(--paper)]"
                    : "opacity-60 hover:opacity-100"
                }`}
                disabled={sheetsState.data === undefined && sheetsState.error === undefined}
              >
                SHEETS
              </button>
            </div>
            <button
              onClick={() => setMode(null)}
              className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
            >
              ↑ COLLAPSE
            </button>
          </div>

          {mode === "json" && (
            <>
              {jsonState.loading && (
                <div className="font-mono text-xs opacity-60 py-4">
                  PULLING JSON<span className="caret ml-1" />
                </div>
              )}
              {jsonState.error && (
                <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
                  {jsonState.error}
                </div>
              )}
              {jsonState.data !== undefined && <JsonViewer value={jsonState.data} />}
            </>
          )}

          {mode === "sheets" && (
            <>
              {sheetsState.loading && (
                <div className="font-mono text-xs opacity-60 py-4">
                  PARSING SHEETS<span className="caret ml-1" />
                </div>
              )}
              {sheetsState.error && (
                <div className="border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
                  {sheetsState.error}
                </div>
              )}
              {sheetsState.data && (
                <div className="space-y-5">
                  <SheetTable
                    title="Free Agents by Team"
                    rows={sheetsState.data.freeAgentsByTeam}
                  />
                  <SheetTable
                    title="Free Agent Values"
                    rows={sheetsState.data.freeAgentValues}
                  />
                  <RanksTriptych ranks={sheetsState.data.ranks} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
