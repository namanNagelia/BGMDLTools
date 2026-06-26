"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { mod } from "@/lib/api";
import { LoginCard } from "@/components/mod/LoginCard";
import { SeasonManager } from "@/components/mod/SeasonManager";
import { OffersInbox } from "@/components/mod/OffersInbox";

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
