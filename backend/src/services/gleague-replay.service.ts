/**
 * Rebuilds both exports from the move ledger.
 *
 * Downloads are stateless: we re-fetch the two original BBGM files and replay
 * every committed move onto them. That keeps the main export and the G-League
 * export derived from one source of truth, so they can never disagree about
 * where a player is or what he is owed.
 */
import { applyMoves, type ApplyResult, type GLeagueMove } from "./gleague-transfer.service.js";
import { buildAffiliateMap, type AffiliateMap, type BbgmLeague } from "./gleague.service.js";
import type { LedgerEntry } from "./gleague-season.service.js";

/**
 * Translate ledger rows into transfer moves. Rows naming a team outside the
 * affiliate map are dropped — that means the export was swapped for one with a
 * different set of clubs, and guessing would corrupt the file.
 */
export function ledgerToMoves(rows: LedgerEntry[], map: AffiliateMap): GLeagueMove[] {
  const glTidByAbbrev = new Map(map.pairs.map((p) => [p.glAbbrev, p.glTid]));
  const mainTidByAbbrev = new Map(map.pairs.map((p) => [p.mainAbbrev, p.mainTid]));
  const out: GLeagueMove[] = [];

  for (const row of rows) {
    if (row.direction === "ASSIGN") {
      const glTid = glTidByAbbrev.get(row.glTeamAbbrev);
      if (glTid == null || row.mainPid == null) continue;
      out.push({ direction: "ASSIGN", pid: row.mainPid, glTid });
      continue;
    }

    const mainTid = mainTidByAbbrev.get(row.mainTeamAbbrev);
    if (mainTid == null || row.glPid == null) continue;
    out.push({
      direction: "CALLUP",
      glPid: row.glPid,
      mainTid,
      years: row.newContractYears ?? 2,
      snapshot:
        row.snapContractAmount != null && row.snapContractExp != null
          ? { amountM: Number(row.snapContractAmount), exp: row.snapContractExp }
          : null,
      wasRookieContract: row.snapWasRookie ?? false,
    });
  }

  return out;
}

/** Apply a ledger, oldest row first, to a fresh pair of exports. */
export function replayLedger(
  main: BbgmLeague,
  gl: BbgmLeague,
  rows: LedgerEntry[],
): ApplyResult {
  if (!rows.length) return { results: [], errors: [] };
  return applyMoves(main, gl, ledgerToMoves(rows, buildAffiliateMap(main, gl)));
}
