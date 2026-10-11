"use client";

import type { GlBoardTeam, GlProposal, GlStagedMove } from "@/lib/api";
import { isRosterRule, money, Rules, SlotBar } from "./bits";

/** Stable key for a staged move, so one action per player can be toggled. */
export const moveKey = (m: GlProposal) =>
  m.direction === "ASSIGN" ? `a${m.pid}` : m.direction === "RELEASE" ? `r${m.glPid}` : `c${m.glPid}`;

type Props = {
  team: GlBoardTeam;
  staged: GlProposal[];
  preview: GlStagedMove[];
  /** Stage the move, or unstage it if it is already in the batch. */
  onToggle: (move: GlProposal) => void;
};

/**
 * One club and its affiliate, side by side, with the staged batch drawn into
 * both rosters — a call-up appears on the parent side with its contract, a cut
 * is struck through, a send-down appears on the affiliate.
 */
export function TeamDesk({ team, staged, preview, onToggle }: Props) {
  const stagedKeys = new Set(staged.map(moveKey));
  const previewFor = (key: string) => preview[staged.findIndex((m) => moveKey(m) === key)];
  const forced = new Map(team.forced.map((f) => [f.pid, f]));

  const incomingDown = staged.filter(
    (m): m is Extract<GlProposal, { direction: "ASSIGN" }> =>
      m.direction === "ASSIGN" && team.candidates.some((c) => c.pid === m.pid),
  );
  const incomingUp = staged.filter(
    (m): m is Extract<GlProposal, { direction: "CALLUP" }> =>
      m.direction === "CALLUP" && team.players.some((p) => p.pid === m.glPid),
  );

  const button =
    "border rule px-2 py-0.5 font-mono text-[10px] tracking-widest transition-colors disabled:opacity-30";

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* affiliate ------------------------------------------------------ */}
      <div className="border rule p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow opacity-60">AFFILIATE</div>
            <div className="font-mono text-sm mt-1">{team.glName}</div>
          </div>
          <div className="font-mono text-[10px] tracking-widest opacity-60 text-right">
            {team.players.length}/7 · {team.assignedCount} ASSIGNED · {team.originalCount} ORIGINAL
            <br />
            GL PAYROLL {money(team.payrollM)}
          </div>
        </div>
        <Rules items={team.violations} />

        <div className="mt-4 space-y-1">
          {team.players.length === 0 && incomingDown.length === 0 && (
            <div className="font-mono text-xs opacity-50">Empty roster.</div>
          )}

          {team.players.map((p) => {
            const cut = stagedKeys.has(`r${p.pid}`);
            const up = stagedKeys.has(`c${p.pid}`);
            const f = forced.get(p.pid);
            return (
              <div
                key={p.pid}
                className={`flex items-center gap-3 border-b rule border-[color:var(--rule-soft)] py-1.5 ${
                  cut || up ? "opacity-60" : ""
                }`}
              >
                <SlotBar assigned={p.assigned} />
                <span
                  className={`flex-1 font-mono text-xs truncate ${
                    cut ? "line-through decoration-[var(--leather)] decoration-2" : ""
                  }`}
                >
                  {p.name}
                </span>
                {f && !up && (
                  <span
                    className="font-mono text-[9px] tracking-widest text-[var(--mustard)]"
                    title={`no longer meets the assign criteria: ${f.reasons.join(", ")}`}
                  >
                    MUST COME UP
                  </span>
                )}
                {cut && (
                  <span className="font-mono text-[9px] tracking-widest text-[var(--leather)]">
                    CUT
                  </span>
                )}
                {up && (
                  <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                    ↑ CALLED UP
                  </span>
                )}
                <span className="font-mono text-[10px] opacity-60 tabular-nums">
                  {p.ovr} · {p.age}yo · {money(p.salaryM)}
                </span>
                <button
                  disabled={up}
                  onClick={() =>
                    onToggle({ direction: "RELEASE", glPid: p.pid, mainAbbrev: team.mainAbbrev })
                  }
                  className={`${button} ${
                    cut
                      ? "bg-[var(--leather)] border-[var(--leather)] text-[var(--paper)]"
                      : "hover:bg-[var(--leather)] hover:border-[var(--leather)] hover:text-[var(--paper)]"
                  }`}
                  title={cut ? "undo" : "cut him to G-League free agency"}
                >
                  CUT
                </button>
                <button
                  disabled={cut}
                  onClick={() =>
                    onToggle({
                      direction: "CALLUP",
                      glPid: p.pid,
                      mainAbbrev: team.mainAbbrev,
                      years: 2,
                    })
                  }
                  className={`${button} ${
                    up
                      ? "bg-[var(--paper)] text-[var(--ink)]"
                      : "hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                  }`}
                  title={up ? "undo" : "call him up to the main roster"}
                >
                  CALL UP
                </button>
              </div>
            );
          })}

          {/* players this batch sends down */}
          {incomingDown.map((m) => {
            const c = team.candidates.find((x) => x.pid === m.pid)!;
            return (
              <div
                key={`in-${m.pid}`}
                className="flex items-center gap-3 border-b border-dashed rule border-[color:var(--rule-soft)] py-1.5"
              >
                <span className="inline-block w-1.5 h-4 shrink-0 bg-[var(--leather)] opacity-50" />
                <span className="flex-1 font-mono text-xs truncate text-[var(--mustard)]">
                  {c.name}
                </span>
                <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                  ↓ SENT DOWN
                </span>
                <span className="font-mono text-[10px] opacity-60 tabular-nums">
                  {c.ovr} · {c.age}yo
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* parent club ---------------------------------------------------- */}
      <div className="border rule p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow opacity-60">MAIN ROSTER</div>
            <div className="font-mono text-sm mt-1">{team.mainName}</div>
          </div>
          <div className="font-mono text-[10px] tracking-widest opacity-60 text-right">
            PAYROLL {money(team.mainPayrollM)}
            <br />
            <span className={team.hardCapRoomM < 0 ? "text-[var(--leather)]" : ""}>
              HARD-CAP ROOM {money(team.hardCapRoomM)}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-1 max-h-[32rem] overflow-y-auto">
          {/* players this batch calls up, with what they will be paid */}
          {incomingUp.map((m) => {
            const pv = previewFor(`c${m.glPid}`);
            const p = team.players.find((x) => x.pid === m.glPid)!;
            return (
              <div
                key={`up-${m.glPid}`}
                className="border-b border-dashed rule border-[color:var(--rule-soft)] py-1.5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex-1 font-mono text-xs truncate text-[var(--mustard)]">
                    {p.name}
                  </span>
                  <span className="font-mono text-[9px] tracking-widest text-[var(--mustard)]">
                    ↑ CALLED UP
                  </span>
                  <span className="font-mono text-[10px] opacity-60 tabular-nums">
                    {p.ovr} · {p.age}yo
                  </span>
                </div>
                <div className="font-mono text-[10px] mt-0.5 text-[var(--mustard)]">
                  {pv?.contract
                    ? `${money(pv.contract.amountM)} through ${pv.contract.exp} · ${pv.contract.source}`
                    : "pricing…"}
                </div>
              </div>
            );
          })}

          {team.candidates.map((c) => {
            const down = stagedKeys.has(`a${c.pid}`);
            return (
              <div
                key={c.pid}
                className={`border-b rule border-[color:var(--rule-soft)] py-1.5 ${
                  down ? "opacity-55" : c.eligible ? "" : "opacity-45"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex-1 font-mono text-xs truncate">
                    {c.name}
                    {down && (
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
                  <button
                    disabled={!c.eligible && !down}
                    onClick={() => onToggle({ direction: "ASSIGN", pid: c.pid, glAbbrev: team.glAbbrev })}
                    className={`${button} ${
                      down
                        ? "bg-[var(--paper)] text-[var(--ink)]"
                        : "hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                    }`}
                    title={down ? "undo" : "send him down to the affiliate"}
                  >
                    SEND DOWN
                  </button>
                </div>
                <Rules items={c.violations.filter((v) => !isRosterRule(v))} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
