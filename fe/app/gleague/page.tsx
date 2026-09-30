import Link from "next/link";
import { GLeagueDesk } from "@/components/gleague/GLeagueDesk";

export const metadata = {
  title: "BGMDL · G-League",
  description: "Send players down and call them up for your BGMDL affiliate.",
};

export default function GLeaguePage() {
  return (
    <div className="ops min-h-screen relative">
      <header className="relative z-10 border-b rule px-6 sm:px-12 py-4 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-baseline gap-3 font-mono text-xs tracking-widest opacity-80 hover:opacity-100 transition-opacity"
        >
          <span aria-hidden>←</span> FRONT OFFICE
        </Link>
        <span className="font-mono text-[10px] tracking-widest opacity-60">GM ACCESS</span>
      </header>

      <div className="relative z-10 px-6 sm:px-12 pt-10 pb-6">
        <div className="eyebrow opacity-60">DESK / 04</div>
        <div className="display text-[20vw] sm:text-[11vw] leading-[0.8] mt-2">
          G <span className="text-[var(--leather)]">LEAGUE</span>
        </div>
        <div className="seam mt-6" />
      </div>

      <main className="relative z-10 px-6 sm:px-12 pb-20">
        <GLeagueDesk />
      </main>

      <footer className="relative z-10 border-t rule px-6 sm:px-12 py-4 flex items-center justify-end font-mono text-[10px] tracking-widest opacity-60">
        <span>BUILD 0.0.1</span>
      </footer>
    </div>
  );
}
