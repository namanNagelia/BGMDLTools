"use client";

import { useEffect, useState } from "react";
import type { GlContractChoice, GlProposal, GlStagedMove, GlViolation } from "@/lib/api";
import { isRosterRule, money, Rules } from "./bits";

type CallUp = Extract<GlProposal, { direction: "CALLUP" }>;
const YEARS = [2, 3, 4, 5] as const;

/**
 * The mod's contract decision for one call-up.
 *
 * Running rookie deal: locked, nothing to choose. Any other running deal: keep
 * it or replace it. No running deal: set a new one. A new deal is years plus a
 * figure, with the pay scale shown as the floor — the server enforces it.
 */
function ContractControls({
  move,
  pv,
  onChange,
}: {
  move: CallUp;
  pv: GlStagedMove | undefined;
  onChange: (next: CallUp) => void;
}) {
  const opts = pv?.contractOptions;
  const mode: GlContractChoice["mode"] =
    move.contract?.mode ?? (opts?.current ? "KEEP" : "NEW");
  const years = move.contract?.mode === "NEW" ? move.contract.years : move.years;
  const amount =
    move.contract?.mode === "NEW" ? move.contract.amountM : (pv?.contract?.amountM ?? 0);

  // Typed text is kept locally so "4." or "" can be mid-edit without fighting
  // the number the server last priced.
  const [text, setText] = useState(amount ? String(amount) : "");
  useEffect(() => {
    if (mode === "NEW") setText(amount ? String(amount) : "");
  }, [mode, amount]);

  if (!opts) {
    return <div className="font-mono text-[10px] opacity-50 mt-1">pricing…</div>;
  }

  if (opts.rookieLocked && opts.current) {
    return (
      <div className="font-mono text-[10px] mt-1 text-[var(--mustard)]">
        ROOKIE DEAL · {money(opts.current.amountM)} through {opts.current.exp}
        <span className="opacity-60"> · locked — he returns on it</span>
      </div>
    );
  }

  const setNew = (y: number, amountM: number) =>
    onChange({ ...move, years: y, contract: { mode: "NEW", years: y, amountM } });

  const toggle = (on: boolean) =>
    `px-2 py-0.5 font-mono text-[10px] tracking-widest border rule transition-colors ${
      on ? "bg-[var(--paper)] text-[var(--ink)]" : "opacity-60 hover:opacity-100"
    }`;

  return (
    <div className="mt-1.5 space-y-1.5">
      {opts.current && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onChange({ ...move, contract: { mode: "KEEP" } })}
            className={toggle(mode === "KEEP")}
          >
            KEEP {money(opts.current.amountM)} THROUGH {opts.current.exp}
          </button>
          <button
            onClick={() => setNew(years, opts.floorByYears[years])}
            className={toggle(mode === "NEW")}
          >
            NEW DEAL
          </button>
        </div>
      )}

      {mode === "NEW" && (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={years}
            onChange={(e) => {
              const y = Number(e.target.value);
              // Carry a floor-priced deal to the new floor; keep a figure the mod typed.
              const atFloor = Math.abs(amount - opts.floorByYears[years]) < 0.001;
              setNew(y, atFloor || !amount ? opts.floorByYears[y] : amount);
            }}
            className="bg-transparent border rule font-mono text-[10px] px-1 py-0.5 outline-none"
          >
            {YEARS.map((y) => (
              <option key={y} value={y} className="bg-[var(--ink)]">
                {y} YEARS
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 font-mono text-[10px]">
            $
            <input
              value={text}
              inputMode="decimal"
              onChange={(e) => {
                setText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value.trim() && Number.isFinite(n) && n > 0) setNew(years, n);
              }}
              className="w-20 bg-transparent border rule px-1.5 py-0.5 font-mono text-[11px] tabular-nums outline-none focus:border-[var(--leather)]"
            />
            M
          </label>
          <span className="font-mono text-[10px] opacity-60">
            scale min {money(opts.floorByYears[years])} · max {money(opts.maxM)}
          </span>
        </div>
      )}

      {pv?.contract && (
        <div className="font-mono text-[10px] text-[var(--mustard)]">
          → {money(pv.contract.amountM)} through {pv.contract.exp}
          <span className="opacity-60"> · {pv.contract.source}</span>
          {pv.contract.rfaRightsLost && (
            <span className="text-[var(--leather)]"> · RFA RIGHTS LOST</span>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  staged: GlProposal[];
  preview: GlStagedMove[];
  /** True while the latest edit is still being priced. */
  pricing: boolean;
  teamOf: (m: GlProposal) => string;
  nameOf: (m: GlProposal) => string;
  onChange: (index: number, next: GlProposal) => void;
  onDrop: (index: number) => void;
  onClear: () => void;
  note: string;
  onNote: (note: string) => void;
  onCommit: () => void;
  committing: boolean;
};

/** The staged batch, grouped by club, with contract controls and commit. */
export function StagedBatch(props: Props) {
  const { staged, preview, pricing, teamOf, nameOf } = props;
  if (!staged.length) return null;

  const blocked = preview.some((p) => p.blocked);
  const teams = [...new Set(staged.map(teamOf))];

  return (
    <div className="border rule border-[var(--leather)] p-4">
      <div className="eyebrow opacity-70">
        STAGED · {staged.length} MOVE{staged.length === 1 ? "" : "S"} · {teams.length} CLUB
        {teams.length === 1 ? "" : "S"}
      </div>

      {teams.map((team) => {
        const rows = staged.map((m, i) => ({ m, i })).filter(({ m }) => teamOf(m) === team);
        // Roster shape, once per club.
        const seen = new Map<string, GlViolation>();
        for (const { i } of rows) {
          for (const v of preview[i]?.violations ?? []) if (isRosterRule(v)) seen.set(v.message, v);
        }
        return (
          <div key={team} className="mt-4">
            <div className="font-mono text-[11px] tracking-widest opacity-80">{team}</div>
            <div className="mt-1.5 space-y-1.5">
              {rows.map(({ m, i }) => {
                const pv = preview[i];
                const label =
                  m.direction === "ASSIGN" ? "SEND DOWN" : m.direction === "RELEASE" ? "CUT" : "CALL UP";
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 border-b rule border-[color:var(--rule-soft)] pb-1.5"
                  >
                    <span
                      className={`font-mono text-[10px] tracking-widest w-20 shrink-0 pt-0.5 ${
                        m.direction === "RELEASE" ? "text-[var(--leather)]" : "opacity-70"
                      }`}
                    >
                      {label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs">
                        {pv?.playerName ?? nameOf(m)}
                        {pv && (
                          <span className="opacity-50">
                            {" "}
                            · {pv.ovr} OVR · {pv.age}yo
                          </span>
                        )}
                      </div>
                      {m.direction === "CALLUP" && (
                        <ContractControls
                          move={m}
                          pv={pv}
                          onChange={(next) => props.onChange(i, next)}
                        />
                      )}
                      {m.direction === "RELEASE" && pv && (
                        <div className="font-mono text-[10px] opacity-60 mt-0.5">
                          {pv.wasAssigned
                            ? "cuts him from the organisation — off the affiliate and the main roster"
                            : "returns him to G-League free agency"}
                        </div>
                      )}
                      {pv && <Rules items={pv.violations.filter((v) => !isRosterRule(v))} />}
                    </div>
                    <button
                      onClick={() => props.onDrop(i)}
                      className="font-mono text-[10px] tracking-widest opacity-50 hover:opacity-100 hover:text-[var(--leather)]"
                    >
                      DROP
                    </button>
                  </div>
                );
              })}
            </div>
            {seen.size > 0 && (
              <div className="mt-2 border rule border-[color:var(--rule-soft)] p-2">
                <div className="font-mono text-[9px] tracking-widest opacity-50 mb-1">
                  {team} AFFILIATE AFTER THIS BATCH
                </div>
                <Rules items={[...seen.values()]} />
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-5 pt-4 border-t rule border-[color:var(--rule-soft)] flex flex-wrap items-center gap-3">
        <input
          value={props.note}
          onChange={(e) => props.onNote(e.target.value)}
          placeholder="MOD NOTE (optional) — e.g. per #assignees_and_call_ups"
          className="flex-1 min-w-[16rem] bg-transparent border rule px-3 py-2 font-mono text-[11px] outline-none focus:border-[var(--leather)]"
        />
        <button
          onClick={props.onCommit}
          disabled={props.committing || blocked || pricing}
          className="border rule px-4 py-2 font-mono text-xs tracking-widest hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
        >
          {props.committing ? <span className="spinner" /> : "COMMIT BATCH"}
        </button>
        <button
          onClick={props.onClear}
          className="font-mono text-[10px] tracking-widest opacity-60 hover:opacity-100"
        >
          CLEAR
        </button>
        {blocked ? (
          <span className="font-mono text-[10px] tracking-widest text-[var(--leather)]">
            A HARD RULE BLOCKS THIS BATCH
          </span>
        ) : pricing ? (
          <span className="font-mono text-[10px] tracking-widest opacity-60">CHECKING…</span>
        ) : null}
      </div>
    </div>
  );
}
