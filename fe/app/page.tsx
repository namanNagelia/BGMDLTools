import Link from "next/link";
import { RecruitmentBoard } from "@/components/recruitment/RecruitmentBoard";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* edition bar ------------------------------------------------------- */}
      <header className="relative z-10 border-b rule px-6 pt-6 pb-3 sm:px-12">
        <div className="flex items-baseline justify-between gap-4">
          <div className="eyebrow">
            VOL. I &nbsp;·&nbsp; NO. 001 &nbsp;·&nbsp; OFFSEASON EDITION
          </div>
          <Link
            href="/mod"
            className="eyebrow hidden sm:inline-flex items-baseline gap-2 underline decoration-[var(--leather)] decoration-2 underline-offset-4 hover:text-[var(--leather)] transition-colors"
          >
            MOD ENTRY →
          </Link>
        </div>
        <div className="seam mt-3" />
      </header>

      {/* masthead ---------------------------------------------------------- */}
      <section className="relative z-10 px-6 sm:px-12 pt-8 pb-4">
        <div className="display text-[10vw] sm:text-[7vw] leading-none rise flex flex-wrap items-baseline gap-x-[0.25em]">
          <span>THE</span>
          <span className="text-[var(--leather)]">FRONT</span>
          <span>OFFICE</span>
        </div>
      </section>

      <div className="relative z-10 px-6 sm:px-12">
        <div className="seam" />
      </div>

      {/* recruitment board ------------------------------------------------ */}
      <section className="relative z-10 px-3 sm:px-12 py-10">
        <RecruitmentBoard />
      </section>

      {/* footer ledger ----------------------------------------------------- */}
      <footer className="relative z-10 border-t rule px-6 sm:px-12 py-5 mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="eyebrow opacity-70">BGMDL League FA</div>
          <div className="font-mono text-xs opacity-70">
            Created by NamanDeep
          </div>
        </div>
      </footer>

      {/* gigantic faded number plate in the background */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-12 sm:-right-20 select-none display leading-none text-[40vw] sm:text-[28vw] opacity-[0.045]"
      >
        FA
      </div>
    </main>
  );
}
