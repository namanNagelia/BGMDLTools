import type { GlBoardTeam, GlViolation } from "@/lib/api";

export const money = (m: number) => `$${m.toFixed(2)}M`;

/**
 * Roster-shape rules describe an affiliate, not any one move, so the server
 * attaches them to every move for that team — dropping any one could fix it.
 * The UI shows them once per team instead of on every row.
 */
const ROSTER_CODES = new Set([
  "BELOW_MIN_ROSTER",
  "ABOVE_MAX_ROSTER",
  "HOARD_LIMIT",
  "TOO_MANY_ASSIGNED",
]);
export const isRosterRule = (v: GlViolation) => ROSTER_CODES.has(v.code);

export function Rules({ items }: { items: GlViolation[] }) {
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

const SWATCH = {
  assigned: "bg-[var(--leather)]",
  original: "bg-[color:rgba(243,237,225,0.55)]",
  empty: "bg-[color:rgba(243,237,225,0.15)]",
};

/**
 * Key for the roster pips. The assigned/original split drives the rule-7
 * limits — five assigned max, the last two slots for original G-Leaguers.
 */
export function Legend() {
  const items = [
    { className: SWATCH.assigned, label: "ASSIGNED", hint: "sent down from the main league" },
    { className: SWATCH.original, label: "ORIGINAL G-LEAGUER", hint: "belongs to the affiliate" },
    { className: SWATCH.empty, label: "EMPTY SLOT", hint: "roster spot open" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2" title={it.hint}>
          <span className={`inline-block w-1.5 h-3 shrink-0 ${it.className}`} />
          <span className="font-mono text-[10px] tracking-widest opacity-70">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Seven roster-slot pips for an affiliate. */
export function Pips({ team }: { team: GlBoardTeam }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 7 }).map((_, i) => {
        const p = team.players[i];
        return (
          <span
            key={i}
            className={`inline-block w-1.5 h-3 ${
              !p ? SWATCH.empty : p.assigned ? SWATCH.assigned : SWATCH.original
            }`}
          />
        );
      })}
    </div>
  );
}

/** The bar beside each affiliate player, matching the pip colours. */
export function SlotBar({ assigned }: { assigned: boolean }) {
  return (
    <span
      className={`inline-block w-1.5 h-4 shrink-0 ${assigned ? SWATCH.assigned : "bg-[color:rgba(243,237,225,0.45)]"}`}
      title={assigned ? "Assigned from the main league" : "Original G-Leaguer"}
    />
  );
}
