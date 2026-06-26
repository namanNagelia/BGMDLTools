"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { mod } from "@/lib/api";
import { LoginCard } from "@/components/mod/LoginCard";
import { SeasonManager } from "@/components/mod/SeasonManager";
import { OffersInbox } from "@/components/mod/OffersInbox";
import { HowToPanel } from "@/components/HowToPanel";

type AuthState = "checking" | "anon" | "mod";

export default function ModPage() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const { role } = await mod.me();
    setAuth(role === "mod" ? "mod" : "anon");
  }

  async function handleLogout() {
    await mod.logout();
    setAuth("anon");
  }

  return (
    <div className="ops min-h-screen relative">
      {/* command bar ------------------------------------------------------- */}
      <header className="relative z-10 border-b rule px-6 sm:px-12 py-4 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-baseline gap-3 font-mono text-xs tracking-widest opacity-80 hover:opacity-100 transition-opacity"
        >
          <span aria-hidden>←</span> FRONT OFFICE
        </Link>
        <div className="flex items-center gap-4 font-mono text-[10px] tracking-widest">
          <span className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                auth === "mod"
                  ? "bg-[var(--leather)] animate-pulse"
                  : "bg-[color:rgba(243,237,225,0.3)]"
              }`}
            />
            {auth === "mod" ? "AUTHED" : auth === "checking" ? "SYNCING" : "LOCKED"}
          </span>
          {auth === "mod" && (
            <button
              onClick={handleLogout}
              className="border rule px-3 py-1 hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors"
            >
              END SESSION
            </button>
          )}
        </div>
      </header>

      {/* slug ------------------------------------------------------------- */}
      <div className="relative z-10 px-6 sm:px-12 pt-10 pb-6">
        <div className="eyebrow opacity-60">DESK / 03</div>
        <div className="display text-[20vw] sm:text-[11vw] leading-[0.8] mt-2">
          MOD <span className="text-[var(--leather)]">CONSOLE</span>
        </div>
        <div className="seam mt-6" />
      </div>

      {/* body ------------------------------------------------------------- */}
      <main className="relative z-10 px-6 sm:px-12 pb-20">
        {auth === "checking" && (
          <div className="py-32 font-mono text-xs tracking-widest opacity-60">
            ESTABLISHING UPLINK
            <span className="caret ml-1" />
          </div>
        )}

        {auth === "anon" && <LoginCard onAuthed={() => setAuth("mod")} />}

        {auth === "mod" && (
          <div className="space-y-20">
            <HowToPanel
              storageKey="mod-howto-open"
              title="HOW TO RUN A FA CYCLE"
              steps={[
                {
                  num: 1,
                  title: "File the season",
                  body: (
                    <>
                      In <b>FILE A NEW SEASON</b>, paste the Dropbox link to the BBGM export + the Google Sheets URL with the FA tabs.
                      Click <b>PULL · FILE · INGEST</b>. The system fetches the league file, the sheets, and the ranks tab in one shot — players, ratings, market/legacy/winning ranks, team payrolls and rosters all loaded.
                    </>
                  ),
                },
                {
                  num: 2,
                  title: "Mark current + start in WAVE 1",
                  body: (
                    <>
                      The new season auto-marks current if you checked the box. The wave starts at <b>1</b>. GMs can now visit the home page, pick their team, browse FAs and submit offers.
                    </>
                  ),
                },
                {
                  num: 3,
                  title: "Reassign rights for trades (as needed)",
                  body: (
                    <>
                      If a Bird rights trade happens mid-FA, find the player in <b>INCOMING OFFERS</b> and pick the new team in the <b>RIGHTS</b> dropdown. Cap holds and Bird eligibility recompute instantly across all offers.
                    </>
                  ),
                },
                {
                  num: 4,
                  title: "Re-import with processed trades",
                  body: (
                    <>
                      Before you start resolving signings, make sure every trade that closed during the wave is in the BBGM file. Edit the season's <b>json:</b> link (inline EDIT) to the latest export and hit <b>SAVE + INGEST</b> — payrolls, rosters, cap holds and ratings all refresh, and every existing offer's warnings recompute live.
                    </>
                  ),
                },
                {
                  num: 5,
                  title: "Process offers — CALC & RESOLVE",
                  body: (
                    <>
                      On each player group in the inbox, click <b>CALC & RESOLVE</b>. See the per-value math (Market / Legacy / PT / Winning / Loyalty / Money / Length), 10M/20M filter kills, Hayato elimination rounds, and the auto-picked winner. Click <b>ACCEPT</b> on the winner — or <b>OVERRIDE</b> any other offer. Accepting signs the FA and auto-rejects all other offers on them.
                    </>
                  ),
                },
                {
                  num: 6,
                  title: "Flip to WAVE 2",
                  body: (
                    <>
                      When wave 1 is done, click the <b>WAVE 1</b> button on the season row. Unsigned RFAs with <i>no</i> pending offers auto-convert to UFA (per the rules). RFAs with pending offers stay RFA so match-rights still work.
                    </>
                  ),
                },
                {
                  num: 7,
                  title: "Repeat resolution for WAVE 2",
                  body: <>Same loop: re-import the export first, then resolve.</>,
                },
                {
                  num: 8,
                  title: "Download the signed export",
                  body: (
                    <>
                      Switch to the <b>SIGNED</b> tab in the offers inbox. Click <b>↓ DOWNLOAD SIGNED EXPORT</b>. The server fetches your league file, applies every accepted offer (player tids + contracts), gzips it and downloads. Drop it into BBGM and all the signings land at once.
                    </>
                  ),
                },
                {
                  num: 9,
                  title: "If something looks wrong",
                  body: (
                    <>
                      Edit the Dropbox link inline (or re-pull) to refresh from the latest export — every offer's warnings auto-recompute. Mods can <b>WITHDRAW</b> any pending offer. Renouncements + ingest are both safe to re-run.
                    </>
                  ),
                },
              ]}
            />
            <SeasonManager />
            <OffersInbox />
          </div>
        )}
      </main>

      {/* footer ----------------------------------------------------------- */}
      <footer className="relative z-10 border-t rule px-6 sm:px-12 py-4 flex items-center justify-end font-mono text-[10px] tracking-widest opacity-60">
        <span>BUILD 0.0.1</span>
      </footer>
    </div>
  );
}
